"""Core crawler logic for the Visual API Crawler."""

# Standard library
import asyncio
import base64
import logging
import random
import re
from dataclasses import asdict
from datetime import datetime
from typing import Optional, Callable, Awaitable
from urllib.parse import urlparse

# Set up logger
logger = logging.getLogger(__name__)

# Third-party
from playwright.async_api import async_playwright, Page, Response

# Local imports
from .models import DiscoveredEndpoint
from .sitemap_parser import fetch_sitemap_urls
from .technology_detector import analyze_technologies
from .constants import (
    STATIC_EXTENSIONS,
    API_SCRIPT_EXTENSIONS,
    API_PATH_PATTERNS,
    API_CONTENT_TYPES,
    DEFINITE_API_CONTENT_TYPES,
    MAYBE_API_CONTENT_TYPES,
    ID_PATTERNS,
    USER_AGENTS,
    VIEWPORTS,
    CAPTCHA_INDICATORS,
    CLOUDFLARE_INDICATORS,
    ACCESS_DENIED_INDICATORS,
)


class ProxyPool:
    """Manages a pool of BrightData proxies for rotation."""

    def __init__(self, proxies: list[dict], enable_dynamic_sessions: bool = True) -> None:
        """Initialize proxy pool.

        Args:
            proxies: List of proxy dicts with keys: server, username, password
            enable_dynamic_sessions: If True, generate new session IDs for each rotation (fresh IPs)
        """
        self.proxies = proxies if proxies else []
        self.current_idx = 0
        self.failed_proxies: set[int] = set()
        self.request_count = 0
        self.enable_dynamic_sessions = enable_dynamic_sessions

        # Store base usernames (without session IDs) for dynamic generation
        self.base_usernames = []
        if self.enable_dynamic_sessions and self.proxies:
            for proxy in self.proxies:
                username = proxy.get('username', '')
                # Remove existing session ID if present
                if '-session-' in username:
                    base_username = username.rsplit('-session-', 1)[0]
                else:
                    base_username = username
                self.base_usernames.append(base_username)

    def get_next_proxy(self) -> Optional[dict]:
        """Get next proxy in rotation.

        If dynamic_sessions is enabled, generates a NEW session ID for each call,
        ensuring each rotation gets a fresh residential IP from BrightData.
        """
        if not self.proxies:
            return None

        if len(self.failed_proxies) >= len(self.proxies):
            logger.warning("All proxies have failed")
            return None

        # Try to find a working proxy
        attempts = 0
        while attempts < len(self.proxies):
            proxy = self.proxies[self.current_idx]
            proxy_idx = self.current_idx
            self.current_idx = (self.current_idx + 1) % len(self.proxies)
            attempts += 1

            if proxy_idx not in self.failed_proxies:
                self.request_count += 1

                # Generate new session ID for fresh IP (if enabled)
                if self.enable_dynamic_sessions and self.base_usernames:
                    import random
                    new_session_id = random.randint(100000, 999999)
                    base_username = self.base_usernames[proxy_idx]
                    new_username = f"{base_username}-session-{new_session_id}"

                    logger.info(f"🔄 Generated fresh residential IP session: {new_session_id}")

                    # Return proxy with new session ID
                    return {
                        "server": proxy["server"],
                        "username": new_username,
                        "password": proxy["password"]
                    }

                return proxy

        return None

    def mark_failed(self, proxy: dict) -> None:
        """Mark a proxy as failed."""
        try:
            idx = self.proxies.index(proxy)
            self.failed_proxies.add(idx)
            logger.warning(f"Marked proxy as failed: {proxy.get('server', 'unknown')}")
        except ValueError:
            pass

    def reset_failures(self) -> None:
        """Reset failed proxies (give them another chance)."""
        self.failed_proxies.clear()
        logger.info("Reset all proxy failures")


def _templatize(path: str) -> str:
    """Replace ID-like path segments with placeholders."""
    parts = path.strip("/").split("/")
    result = []
    for part in parts:
        replaced = False
        for pattern, placeholder in ID_PATTERNS:
            if pattern.fullmatch(part):
                result.append(placeholder)
                replaced = True
                break
        if not replaced:
            result.append(part)
    return "/" + "/".join(result) if result else "/"


def _is_static(req_url: str) -> bool:
    """Check if a URL points to a static file."""
    # Parse URL and get path without query parameters
    parsed_path = urlparse(req_url).path.lower()
    # Strip trailing slashes/backslashes before checking extension
    parsed_path = parsed_path.rstrip('/\\')
    # Check if it ends with any static extension
    return any(parsed_path.endswith(ext) for ext in STATIC_EXTENSIONS)


async def _auto_scroll(page: Page):
    """Automatically scroll the page to trigger lazy loading."""
    try:
        await page.evaluate("""async () => {
            await new Promise(r => {
                let t = 0; const s = 400;
                const i = setInterval(() => {
                    window.scrollBy(0, s); t += s;
                    if (t >= document.body.scrollHeight || t > 6000) { clearInterval(i); r(); }
                }, 150);
            });
        }""")
        await page.wait_for_timeout(800)
    except Exception:
        pass


async def _interact(page: Page):
    """Click on interactive elements to trigger API calls."""
    for sel in ["button:visible", "[role='tab']:visible"]:
        try:
            elements = await page.query_selector_all(sel)
            for el in elements[:3]:
                try:
                    await el.click(timeout=2000)
                    await page.wait_for_timeout(600)
                except Exception:
                    pass
        except Exception:
            pass


async def _dismiss_floating_dialogs(page: Page):
    """Attempt to dismiss any floating dialogs, modals, overlays, and popups."""
    try:
        # Generic dismiss button text patterns (case-insensitive, multiple languages)
        dismiss_patterns = [
            # English
            "OK", "ok", "Close", "close", "Accept", "accept", "Agree", "agree",
            "Continue", "continue", "Got it", "got it", "I understand", "Dismiss",
            "dismiss", "Allow", "allow", "Yes", "yes", "Confirm", "confirm",
            "No thanks", "no thanks", "Maybe later", "maybe later", "Not now", "not now",
            # French
            "Accepter", "accepter", "D'accord", "d'accord", "Fermer", "fermer",
            "Continuer", "continuer", "Oui", "oui", "Compris", "compris",
            # Spanish
            "Aceptar", "aceptar", "Cerrar", "cerrar", "Continuar", "continuar",
            "Entendido", "entendido", "Sí", "sí", "De acuerdo", "de acuerdo",
            # German
            "Akzeptieren", "akzeptieren", "Schließen", "schließen", "Weiter", "weiter",
            "Verstanden", "verstanden", "Ja", "ja", "Einverstanden", "einverstanden",
            # Italian
            "Accetta", "accetta", "Chiudi", "chiudi", "Continua", "continua",
            "Ho capito", "ho capito", "Sì", "sì", "D'accordo", "d'accordo",
        ]

        # Strategy 1: Try text-based button matching
        for pattern in dismiss_patterns:
            try:
                selectors = [
                    f"button:has-text('{pattern}')",
                    f"a:has-text('{pattern}')",
                    f"[role='button']:has-text('{pattern}')",
                    f"div[onclick]:has-text('{pattern}')",
                    f"span[onclick]:has-text('{pattern}')",
                ]

                for selector in selectors:
                    try:
                        element = page.locator(selector).first
                        if await element.is_visible(timeout=300):
                            await element.click(timeout=800)
                            await page.wait_for_timeout(400)
                            logger.debug(f"Dismissed dialog with text pattern: {pattern}")
                            return
                    except Exception:
                        continue
            except Exception:
                continue

        # Strategy 2: Try common close button symbols and classes
        close_selectors = [
            # Close button symbols
            "button:has-text('×')",
            "button:has-text('✕')",
            "a:has-text('×')",
            "[aria-label*='close' i]",
            "[aria-label*='dismiss' i]",
            "[title*='close' i]",
            # Common modal/dialog close buttons
            ".modal button.close",
            ".modal .close-button",
            ".modal-close",
            ".dialog-close",
            ".popup-close",
            ".overlay-close",
            "[class*='close'][class*='button']",
            "[class*='dismiss'][class*='button']",
            # Cookie-specific
            ".cookie-consent button",
            ".cookie-banner button",
            "[class*='cookie'] button[class*='accept']",
            "#cookie-accept",
            "#accept-cookies",
            # Modal/dialog role-based
            "[role='dialog'] button",
            "[role='alertdialog'] button",
            # Generic modal classes
            ".modal-footer button",
            ".dialog-footer button",
            "[class*='modal'] button[class*='primary']",
            "[class*='modal'] button[class*='accept']",
        ]

        for selector in close_selectors:
            try:
                element = page.locator(selector).first
                if await element.is_visible(timeout=300):
                    await element.click(timeout=800)
                    await page.wait_for_timeout(400)
                    logger.debug(f"Dismissed dialog using selector: {selector}")
                    return
            except Exception:
                continue

        # Strategy 3: Try pressing Escape key to close modals
        try:
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(300)
            logger.debug("Attempted to dismiss dialog with Escape key")
        except Exception:
            pass

    except Exception:
        # Silently fail - not all pages have dialogs
        pass


def _classify(req_url: str, method: str, resource_type: str, response: Response) -> str:
    """Classify whether a URL is an API endpoint."""
    parsed = urlparse(req_url)
    path = parsed.path

    # Non-GET methods are always APIs
    if method not in ("GET", "HEAD", "OPTIONS"):
        return f"{method} request"

    # Check Content-Type for JSON/XML responses (regardless of resource type)
    resp_ct = response.headers.get("content-type", "").lower()
    if any(ct in resp_ct for ct in API_CONTENT_TYPES):
        if resource_type in ("xhr", "fetch"):
            return "XHR/fetch JSON/XML response"
        return "JSON/XML response"

    # Check for server-side script extensions (PHP, ASP, JSP, etc.)
    path_lower = path.lower()
    for ext in API_SCRIPT_EXTENSIONS:
        if path_lower.endswith(ext):
            return f"Server-side script ({ext})"

    # Check API path patterns
    for pattern in API_PATH_PATTERNS:
        if pattern.search(path):
            return f"API path pattern"

    # XHR/fetch without JSON is still likely an API
    if resource_type in ("xhr", "fetch"):
        return "XHR/fetch request"

    return ""


class APICrawler:
    """Crawler that discovers API endpoints by monitoring network traffic."""

    def __init__(self, domain: str, max_pages: int = 50, max_depth: int = 3,
                 timeout: int = 30000, include_subdomains: bool = True,
                 api_filter: str = "all", proxy_config: Optional[dict] = None,
                 concurrent_pages: int = 5, fast_mode: bool = False,
                 scan_id: Optional[int] = None,
                 stealth_mode: bool = True,
                 min_delay: float = 2.0,
                 max_delay: float = 5.0,
                 proxy_pool: Optional[ProxyPool] = None,
                 max_retries: int = 3,
                 rotate_identity: bool = True,
                 scraping_browser_url: Optional[str] = None) -> None:
        self.context = None
        self.browser = None
        self.domain = domain.lower().replace("https://", "").replace("http://", "").rstrip("/")
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.timeout = timeout
        self.include_subdomains = include_subdomains
        self.api_filter = api_filter  # "all", "subdomain", or "external"
        self.proxy_config = proxy_config
        self.concurrent_pages = concurrent_pages  # Number of pages to crawl in parallel
        self.fast_mode = fast_mode  # Skip screenshots and interactions for speed
        self.scan_id = scan_id  # Identifier for this scan (for multi-scan environments)

        # Stealth and anti-detection settings
        self.stealth_mode = stealth_mode
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.proxy_pool = proxy_pool
        self.max_retries = max_retries
        self.rotate_identity = rotate_identity

        # BrightData Scraping Browser (remote browser)
        self.scraping_browser_url = scraping_browser_url
        self.using_remote_browser = False

        # State tracking
        self.pages_since_rotation = 0
        self.proxy_rotation_threshold = 10  # Rotate proxy every N pages
        self.blocking_detected_count = 0
        self.current_user_agent: Optional[str] = None
        self.current_viewport: Optional[dict] = None

        self.visited_pages: set[str] = set()
        self.endpoints: list[DiscoveredEndpoint] = []
        self.seen_signatures: set[str] = set()
        self.queue: list[tuple[str, int]] = []

        # Track if we've tried www fallback for the initial URL
        self._tried_www_fallback = False
        self._start_url = None

        # Callback to push events to the dashboard
        self._on_event = None

        # Screenshot synchronization lock (prevent page close during screenshot)
        self._screenshot_lock = asyncio.Lock()

    def on_event(self, callback: Callable[[dict], Awaitable[None]]) -> None:
        """Register a callback for crawler events."""
        self._on_event = callback

    async def _emit(self, event_type: str, data: dict):
        """Emit an event to the registered callback."""
        if self._on_event:
            await self._on_event({"type": event_type, **data})

    def stop(self) -> None:
        """Signal the crawler to stop after the current batch finishes."""
        self.queue.clear()
        self._stopped = True

    async def _sleep_with_heartbeat(self, duration: float) -> None:
        """Sleep for a duration while sending periodic heartbeats to keep WebSocket alive.

        Args:
            duration: Total sleep duration in seconds
        """
        HEARTBEAT_INTERVAL = 30  # Send heartbeat every 30 seconds
        elapsed = 0
        last_heartbeat = 0

        while elapsed < duration and not self._stopped:
            sleep_chunk = min(1.0, duration - elapsed)  # Sleep in 1-second chunks
            await asyncio.sleep(sleep_chunk)
            elapsed += sleep_chunk

            # Send heartbeat every 30 seconds
            if elapsed - last_heartbeat >= HEARTBEAT_INTERVAL:
                await self._emit("heartbeat", {
                    "queue_size": len(self.queue),
                    "pages_visited": len(self.visited_pages),
                    "scan_id": self.scan_id,
                })
                last_heartbeat = elapsed

    def _get_random_user_agent(self) -> str:
        """Get a random user agent for anti-detection."""
        return random.choice(USER_AGENTS)

    def _get_random_viewport(self) -> dict:
        """Get a random viewport size for anti-detection."""
        return random.choice(VIEWPORTS)

    async def _detect_blocking(self, page: Page, response: Optional[Response]) -> dict:
        """Detect if the crawler is being blocked.

        Returns:
            Dict with blocking indicators: {status_code, captcha, cloudflare, access_denied}
        """
        blocking_indicators = {
            'status_code': response and response.status in [403, 429, 503],
            'captcha': False,
            'cloudflare': False,
            'access_denied': False,
        }

        try:
            content = await page.content()
            content_lower = content.lower()

            # Check for CAPTCHA
            if any(term in content_lower for term in CAPTCHA_INDICATORS):
                blocking_indicators['captcha'] = True

            # Check for Cloudflare
            if any(term in content_lower for term in CLOUDFLARE_INDICATORS):
                blocking_indicators['cloudflare'] = True

            # Check for access denied messages
            if any(term in content_lower for term in ACCESS_DENIED_INDICATORS):
                blocking_indicators['access_denied'] = True

        except Exception as e:
            logger.debug(f"Error detecting blocking: {e}")

        return blocking_indicators

    async def _handle_blocking(self, blocking_indicators: dict, page_url: str) -> None:
        """Handle detected blocking."""
        blocking_types = [k for k, v in blocking_indicators.items() if v]

        if not blocking_types:
            return

        self.blocking_detected_count += 1
        blocking_str = ', '.join(blocking_types)
        logger.warning(f"Blocking detected on {page_url}: {blocking_str}")

        await self._emit("status", {
            "message": f"⚠️ Blocking detected: {blocking_str}"
        })

        if blocking_indicators['captcha']:
            # CAPTCHA requires human interaction - skip this page immediately
            await self._emit("status", {
                "message": f"🤖 CAPTCHA detected on {page_url} - skipping page"
            })
            raise Exception(f"CAPTCHA detected - page requires human verification")

        elif blocking_indicators['status_code']:
            # Rate limit or forbidden - exponential backoff
            backoff = min(10 * (2 ** (self.blocking_detected_count - 1)), 120)
            await self._emit("status", {
                "message": f"⏸️ Rate limited - backing off {backoff}s..."
            })
            await self._sleep_with_heartbeat(backoff)

        # Try rotating identity after blocking
        if self.rotate_identity and self.blocking_detected_count >= 2:
            await self._rotate_browser_identity()

    def _get_context_options(self) -> dict:
        """Get browser context options with current settings."""
        # Use stored user agent and viewport if available, otherwise randomize
        if self.stealth_mode and self.rotate_identity:
            if not self.current_user_agent:
                self.current_user_agent = self._get_random_user_agent()
            if not self.current_viewport:
                self.current_viewport = self._get_random_viewport()
        else:
            # Default fixed values
            if not self.current_user_agent:
                self.current_user_agent = USER_AGENTS[1]  # macOS Chrome
            if not self.current_viewport:
                self.current_viewport = VIEWPORTS[0]  # 1920x1080

        context_options = {
            "user_agent": self.current_user_agent,
            "viewport": self.current_viewport,
            "ignore_https_errors": True,
            "extra_http_headers": {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Cache-Control": "max-age=0",
            },
        }

        # Add proxy if configured (only for local browser)
        # Remote browser already includes IP management
        if not self.using_remote_browser and self.proxy_config:
            context_options["proxy"] = self.proxy_config

        return context_options

    async def _rotate_browser_identity(self) -> None:
        """Rotate browser identity (user agent, viewport, proxy)."""
        if not self.browser:
            return

        try:
            # Get new identity
            self.current_user_agent = self._get_random_user_agent()
            self.current_viewport = self._get_random_viewport()

            # Try to get new proxy if pool is available
            if self.proxy_pool:
                new_proxy = self.proxy_pool.get_next_proxy()
                if new_proxy:
                    self.proxy_config = new_proxy
                    logger.info(f"Rotated to proxy: {new_proxy.get('server', 'unknown')}")

            # Close old context
            if self.context:
                await self.context.close()

            # Create new context with new identity
            context_options = self._get_context_options()
            self.context = await self.browser.new_context(**context_options)

            logger.info(f"Rotated identity: UA={self.current_user_agent[:50]}..., "
                       f"Viewport={self.current_viewport['width']}x{self.current_viewport['height']}")

            await self._emit("status", {
                "message": "🔄 Rotated browser identity"
            })

            # Reset counters
            self.pages_since_rotation = 0
            self.blocking_detected_count = 0

        except Exception as e:
            logger.error(f"Failed to rotate identity: {e}")

    async def _add_stealth_scripts(self, page: Page) -> None:
        """Add enhanced stealth scripts to mask automation."""
        if not self.stealth_mode:
            return

        # BrightData Scraping Browser has built-in stealth, skip custom scripts
        if self.using_remote_browser:
            logger.debug("Remote browser: skipping custom stealth scripts")
            return

        await page.add_init_script("""
            // Remove webdriver flag
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});

            // Mock plugins and languages
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5].map(() => ({
                    name: 'Chrome PDF Plugin',
                    description: 'Portable Document Format',
                    filename: 'internal-pdf-viewer'
                }))
            });
            Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});

            // Mock chrome property
            window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {}
            };

            // Mock permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({state: Notification.permission}) :
                    originalQuery(parameters)
            );

            // Randomize canvas fingerprint
            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function(type) {
                const shift = Math.floor(Math.random() * 5) - 2;
                const context = this.getContext('2d');
                if (context) {
                    const imageData = context.getImageData(0, 0, this.width, this.height);
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        imageData.data[i] = Math.min(255, Math.max(0, imageData.data[i] + shift));
                    }
                    context.putImageData(imageData, 0, 0);
                }
                return originalToDataURL.apply(this, arguments);
            };

            // Mock WebGL vendor and renderer
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                // UNMASKED_VENDOR_WEBGL
                if (parameter === 37445) {
                    return 'Intel Inc.';
                }
                // UNMASKED_RENDERER_WEBGL
                if (parameter === 37446) {
                    return 'Intel Iris OpenGL Engine';
                }
                return getParameter.apply(this, arguments);
            };

            // Mock battery API to appear more realistic
            if (navigator.getBattery) {
                navigator.getBattery = () => Promise.resolve({
                    charging: true,
                    chargingTime: 0,
                    dischargingTime: Infinity,
                    level: 1.0,
                    addEventListener: () => {},
                    removeEventListener: () => {}
                });
            }

            // Override toString to hide proxy behavior
            HTMLIFrameElement.prototype.contentWindow;
            const originalToString = Function.prototype.toString;
            Function.prototype.toString = function() {
                if (this === navigator.permissions.query) {
                    return 'function query() { [native code] }';
                }
                return originalToString.apply(this, arguments);
            };
        """)

    async def crawl(self):
        """Start the crawling process."""
        self._stopped = False

        # Emit initial status
        status_msg = f"Starting scan of {self.domain}..."
        if self.stealth_mode:
            status_msg += " (stealth mode enabled)"
        if self.proxy_pool:
            status_msg += f" with {len(self.proxy_pool.proxies)} proxies"
        await self._emit("status", {"message": status_msg})

        async with async_playwright() as p:
            # Check if BrightData Scraping Browser URL is configured
            if self.scraping_browser_url:
                # Try to connect to BrightData remote browser
                try:
                    logger.info("🌐 Connecting to BrightData Scraping Browser...")
                    await self._emit("status", {"message": "🌐 Connecting to remote browser..."})
                    self.browser = await p.chromium.connect_over_cdp(self.scraping_browser_url)
                    self.using_remote_browser = True
                    logger.info("✅ Connected to BrightData Scraping Browser")
                    await self._emit("status", {"message": "✅ Connected to remote browser with anti-bot protection"})
                except Exception as e:
                    logger.error(f"❌ Failed to connect to remote browser: {e}")
                    await self._emit("status", {"message": f"⚠️  Remote browser failed, using local browser"})
                    logger.info("🔄 Falling back to local browser...")
                    # Fallback to local browser
                    self.browser = await p.chromium.launch(
                        headless=True,
                        args=[
                            '--disable-blink-features=AutomationControlled',
                            '--disable-dev-shm-usage',
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-web-security',
                            '--disable-features=IsolateOrigins,site-per-process',
                        ]
                    )
                    self.using_remote_browser = False
            else:
                # Use local browser (backward compatibility)
                logger.info("🖥️  Using local Playwright browser...")
                self.browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        '--disable-blink-features=AutomationControlled',
                        '--disable-dev-shm-usage',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-web-security',
                        '--disable-features=IsolateOrigins,site-per-process',
                    ]
                )
                self.using_remote_browser = False

            # Get context options with randomization if stealth mode is enabled
            context_options = self._get_context_options()

            # Log proxy usage
            if self.proxy_config:
                logger.warning(f"Playwright using proxy: {self.proxy_config.get('server', 'unknown')}")
                await self._emit("status", {
                    "message": f"🔒 Using proxy: {self.proxy_config.get('server', 'unknown')}"
                })

            self.context = await self.browser.new_context(**context_options)

            # Log identity info
            if self.stealth_mode:
                logger.info(f"Browser identity: UA={self.current_user_agent[:50]}..., "
                           f"Viewport={self.current_viewport['width']}x{self.current_viewport['height']}")
                await self._emit("status", {
                    "message": f"🎭 Identity: {self.current_viewport['width']}x{self.current_viewport['height']}"
                })

            start_url = f"https://{self.domain}"
            self._start_url = start_url
            self.queue.append((start_url, 0))

            # Process pages with controlled concurrency
            # Always process full queue, but only discover new pages during first max_pages
            while self.queue and not self._stopped:
                # Check if we need to rotate identity (based on pages crawled)
                if (self.rotate_identity and self.proxy_pool and
                    self.pages_since_rotation >= self.proxy_rotation_threshold):
                    await self._rotate_browser_identity()

                # Get batch of pages to crawl
                batch = []
                while self.queue and len(batch) < self.concurrent_pages:
                    page_url, depth = self.queue.pop(0)
                    if page_url not in self.visited_pages and depth <= self.max_depth:
                        batch.append((page_url, depth))

                logger.debug(f"Queue size: {len(self.queue)}, Visited: {len(self.visited_pages)}, Batch: {len(batch)}")

                if batch:
                    # Add delay between batches if stealth mode is enabled
                    if self.stealth_mode and len(self.visited_pages) > 0:
                        delay = random.uniform(self.min_delay, self.max_delay)
                        logger.debug(f"Stealth delay: {delay:.2f}s before next batch")
                        # Sleep in chunks and send heartbeat to keep WebSocket alive
                        await self._sleep_with_heartbeat(delay)

                    # Crawl batch in parallel with per-page timeout (2x page timeout)
                    max_time_per_page = (self.timeout * 2) // 1000  # Convert ms to seconds, double it
                    tasks = [asyncio.create_task(self._crawl_page_with_retry(url, depth)) for url, depth in batch]
                    done, pending = await asyncio.wait(tasks, timeout=max_time_per_page)
                    for task in pending:
                        task.cancel()
                    if pending:
                        await asyncio.gather(*pending, return_exceptions=True)

            await self.browser.close()

        # Clear queue if stopped early
        remaining_in_queue = len(self.queue)
        self.queue.clear()

        # Analyze technologies detected during scan
        logger.info("Analyzing detected technologies...")
        endpoint_dicts = [asdict(ep) for ep in self.endpoints]
        tech_analysis = analyze_technologies(endpoint_dicts, self.domain)

        await self._emit("done", {
            "total_endpoints": len(self.endpoints),
            "pages_visited": len(self.visited_pages),
            "pages_skipped": remaining_in_queue,
            "technologies": tech_analysis,
        })
        return self.endpoints

    async def _crawl_page_with_retry(self, page_url: str, depth: int) -> None:
        """Crawl a page with retry logic and exponential backoff."""
        for attempt in range(self.max_retries):
            try:
                await self._crawl_page(page_url, depth)
                return  # Success
            except Exception as e:
                if attempt < self.max_retries - 1:
                    # Exponential backoff: 2^attempt seconds
                    backoff = 2 ** attempt
                    logger.warning(f"Retry {attempt + 1}/{self.max_retries} for {page_url} after {backoff}s: {e}")
                    await self._emit("status", {
                        "message": f"⚠️ Retry {attempt + 1}/{self.max_retries} for {page_url}"
                    })
                    await self._sleep_with_heartbeat(backoff)

                    # Try rotating proxy on failure if available
                    if self.proxy_pool and attempt > 0:
                        await self._rotate_browser_identity()
                else:
                    logger.error(f"Failed after {self.max_retries} attempts: {page_url} - {e}")
                    await self._emit("crawl_error", {"url": page_url, "error": f"Failed after {self.max_retries} retries"})

    async def _crawl_page(self, page_url: str, depth: int):
        """Crawl a single page."""
        self.visited_pages.add(page_url)
        page = await self.context.new_page()

        # Add stealth scripts to mask automation
        await self._add_stealth_scripts(page)

        await self._emit("crawl_start", {
            "url": page_url,
            "depth": depth,
            "pages_visited": len(self.visited_pages),
            "pages_remaining": len(self.queue),
            "total_endpoints": len(self.endpoints),
        })

        try:
            page.on("response", lambda res: asyncio.ensure_future(
                self._on_response(res, page_url)
            ))

            logger.debug(f"Navigating to: {page_url}")

            # Try to navigate with timeout handling
            try:
                response = await page.goto(page_url, wait_until="load", timeout=self.timeout)
            except Exception as nav_error:
                # Page navigation failed (timeout, DNS error, connection refused, etc.)
                error_type = type(nav_error).__name__
                error_msg = str(nav_error)

                logger.warning(f"Navigation failed for {page_url}: {error_type} - {error_msg}")

                # Check if this is a connection error or timeout on the start URL
                # If so, try with www prefix
                if (not self._tried_www_fallback and
                    page_url == self._start_url and
                    ("ERR_CONNECTION_REFUSED" in error_msg or "TimeoutError" in error_type or "Timeout" in error_msg) and
                    not self.domain.startswith("www.")):

                    self._tried_www_fallback = True
                    www_domain = f"www.{self.domain}"
                    www_url = f"https://{www_domain}"

                    failure_reason = "Connection refused" if "ERR_CONNECTION_REFUSED" in error_msg else "Timeout/Connection failed"
                    await self._emit("status", {"message": f"⚠️ {failure_reason} for {self.domain}, trying {www_domain}..."})
                    logger.info(f"Retrying with www prefix due to {failure_reason}: {www_url}")

                    try:
                        # Try with www prefix
                        response = await page.goto(www_url, wait_until="load", timeout=self.timeout)

                        # Success! Update domain for future requests
                        self.domain = www_domain
                        self._start_url = www_url
                        page_url = www_url

                        # Mark www URL as visited to avoid duplicate crawls
                        self.visited_pages.add(www_url)

                        await self._emit("status", {"message": f"✅ Successfully connected to {www_domain}"})
                        logger.info(f"Connected to {www_url}, updating domain to {www_domain}")

                        # Continue with normal page processing (don't return)
                    except Exception as www_error:
                        # www prefix also failed - try sitemap fallback
                        logger.error(f"www prefix also failed: {www_error}")
                        await self._emit("crawl_error", {"url": www_url, "error": f"Both {self.domain} and {www_domain} failed"})
                        await self._emit("status", {"message": f"❌ Could not connect to {self.domain} or {www_domain}"})

                        # Try sitemap.xml as last resort
                        sitemap_success = await self._try_sitemap_fallback(page)
                        if not sitemap_success:
                            # Sitemap also failed, give up
                            return
                        else:
                            # Sitemap succeeded, return to skip this page but continue with queue
                            return
                else:
                    # Not the start URL or already tried www, just skip this page
                    await self._emit("crawl_error", {"url": page_url, "error": f"{error_type}: {error_msg}"})
                    await self._emit("status", {"message": f"⚠️ Skipped {page_url} (navigation failed). Continuing scan..."})
                    return

            # Check for HTTP error status codes
            if response and response.status >= 400:
                error_msg = f"HTTP {response.status} error"
                logger.error(f"{error_msg} for {page_url}")
                await self._emit("crawl_error", {"url": page_url, "error": error_msg})
                # Still try to extract any API hints from error page
                if response.status == 403:
                    await self._emit("status", {"message": f"⚠️ Access denied (403) for {page_url}. Site may be blocking crawlers."})

            # Wait for dynamic content (shorter in fast mode)
            wait_time = 500 if self.fast_mode else 2000
            await page.wait_for_timeout(wait_time)
            logger.debug(f"Page loaded: {page_url}")

            # Detect blocking (if stealth mode is enabled)
            if self.stealth_mode:
                blocking_indicators = await self._detect_blocking(page, response)
                if any(blocking_indicators.values()):
                    # If CAPTCHA detected on start URL, try sitemap fallback first
                    if blocking_indicators['captcha'] and page_url == self._start_url:
                        blocking_str = ', '.join([k for k, v in blocking_indicators.items() if v])
                        logger.warning(f"Blocking detected on start URL {page_url}: {blocking_str}")
                        await self._emit("status", {
                            "message": f"⚠️ CAPTCHA detected on homepage - trying sitemap fallback"
                        })

                        # Try sitemap fallback
                        sitemap_success = await self._try_sitemap_fallback(page)
                        if sitemap_success:
                            # Sitemap worked, return to continue with queue
                            return
                        else:
                            # Sitemap failed too, raise exception
                            raise Exception(f"CAPTCHA detected and sitemap fallback failed")

                    # For other pages or non-CAPTCHA blocking, use normal handling
                    await self._handle_blocking(blocking_indicators, page_url)

            # Increment pages since last rotation
            self.pages_since_rotation += 1

            # Try to dismiss any floating dialogs, modals, or popups
            await _dismiss_floating_dialogs(page)

            # Take screenshot (skip in fast mode for speed)
            if not self.fast_mode:
                try:
                    logger.debug(f"Taking screenshot of: {page_url}")
                    # Use lock to prevent page close during screenshot capture
                    async with self._screenshot_lock:
                        screenshot_bytes = await page.screenshot(type="jpeg", quality=60, timeout=15000)
                        screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
                        logger.debug(f"Screenshot captured, size: {len(screenshot_b64)} chars")
                        await self._emit("screenshot", {
                            "url": page_url,
                            "image": screenshot_b64,
                            "scan_id": self.scan_id,
                        })
                    logger.debug(f"Screenshot emitted for: {page_url}")
                except Exception as screenshot_error:
                    logger.error(f"Screenshot failed: {screenshot_error}")
                    # Don't emit error for screenshot failures, just skip it

            # Skip auto-scroll and interactions in fast mode
            if not self.fast_mode:
                await _auto_scroll(page)
                await _interact(page)

            await self._extract_api_hints_from_source(page, page_url)

            # Only discover new pages during the first max_pages visits
            # After max_pages, continue processing queue but don't add more pages
            if depth < self.max_depth and len(self.visited_pages) <= self.max_pages:
                links = await self._extract_links(page)
                logger.debug(f"Found {len(links)} links on {page_url}, depth={depth}, visited={len(self.visited_pages)}")
                await self._emit("status", {"message": f"Found {len(links)} links on page (depth {depth})"})
                added = 0
                for link in links:
                    if link not in self.visited_pages:
                        self.queue.append((link, depth + 1))
                        added += 1
                logger.debug(f"Added {added} new links to queue, queue size now: {len(self.queue)}")
                await self._emit("status", {"message": f"Added {added} links to queue (total: {len(self.queue)})"})
            else:
                logger.debug(f"Skipping link extraction: depth={depth}, max_depth={self.max_depth}, visited={len(self.visited_pages)}, max={self.max_pages}")

            await self._emit("crawl_end", {"url": page_url})

        except asyncio.CancelledError:
            logger.debug(f"Page crawl cancelled (timeout) for {page_url}")
            await self._emit("crawl_error", {"url": page_url, "error": "Page timeout exceeded"})
        except Exception as e:
            logger.error(f"Crawl error for {page_url}: {e}")
            await self._emit("crawl_error", {"url": page_url, "error": str(e)})
        finally:
            try:
                # Wait for any in-progress screenshot to complete before closing page
                async with self._screenshot_lock:
                    await page.close()
            except Exception:
                pass

    async def _on_response(self, response: Response, found_on_page: str):
        """Handle network response events."""
        try:
            request = response.request
            req_url = request.url
            method = request.method
            resource_type = request.resource_type

            # Filter out static resources by type
            if resource_type in ("image", "stylesheet", "font", "media", "manifest"):
                return

            # Filter out static files by extension (even if in /api/ paths)
            if _is_static(req_url):
                return

            # Check response content-type for images/media
            content_type = response.headers.get("content-type", "").lower()
            if any(ct in content_type for ct in ["image/", "font/", "video/", "audio/"]):
                return

            reason = _classify(req_url, method, resource_type, response)
            if not reason:
                return

            parsed = urlparse(req_url)
            host = parsed.hostname or ""
            host_lower = host.lower()

            # Determine if this is a subdomain/target domain API
            is_target_domain = (host_lower == self.domain or
                               (self.include_subdomains and host_lower.endswith(f".{self.domain}")))

            # Apply API filter
            if self.api_filter == "subdomain" and not is_target_domain:
                return  # Skip external APIs
            elif self.api_filter == "external" and is_target_domain:
                return  # Skip target domain APIs

            template_path = _templatize(parsed.path)
            sig = f"{method}|{host}|{template_path}"
            if sig in self.seen_signatures:
                return
            self.seen_signatures.add(sig)

            query_params = [p.split("=")[0] for p in (parsed.query or "").split("&") if p]

            # Classify API confidence based on response Content-Type
            api_confidence = None
            response_ct = response.headers.get("content-type", "").lower()
            if response_ct:
                # Check for definite API content types
                if any(ct in response_ct for ct in DEFINITE_API_CONTENT_TYPES):
                    api_confidence = "API"
                # Check for maybe API content types
                elif any(ct in response_ct for ct in MAYBE_API_CONTENT_TYPES):
                    api_confidence = "Maybe API"

            # Capture request/response payloads for API endpoints (for LLM analysis)
            request_body = None
            response_body = None
            request_headers_dict = None
            response_headers_dict = None

            if api_confidence == "API":
                try:
                    # Capture request body (for POST/PUT/PATCH)
                    if method in ("POST", "PUT", "PATCH"):
                        req_body = request.post_data
                        if req_body:
                            # Limit to 10KB
                            request_body = req_body[:10240]
                            if len(req_body) > 10240:
                                request_body += " [Truncated]"

                    # Capture response body (limit to 100KB)
                    try:
                        resp_body_bytes = await response.body()
                        if resp_body_bytes:
                            resp_body_str = resp_body_bytes[:102400].decode('utf-8', errors='ignore')
                            response_body = resp_body_str
                            if len(resp_body_bytes) > 102400:
                                response_body += " [Truncated]"
                    except Exception:
                        pass  # Some responses can't be read

                    # Capture headers (convert to dict)
                    request_headers_dict = await request.all_headers()
                    response_headers_dict = await response.all_headers()

                except Exception as e:
                    logger.warning(f"Failed to capture payloads: {e}")

            ep = DiscoveredEndpoint(
                method=method, path=template_path, host=host, full_url=req_url,
                query_params=query_params,
                content_type=request.headers.get("content-type"),
                response_status=response.status,
                found_on_page=found_on_page,
                detection_reason=reason,
                timestamp=datetime.utcnow().isoformat(),
                resource_type=resource_type,  # xhr, fetch, document, etc.
                source_location=f"Network: {resource_type}",
                api_confidence=api_confidence,
                request_body=request_body,
                response_body=response_body,
                request_headers=request_headers_dict,
                response_headers=response_headers_dict,
            )
            self.endpoints.append(ep)
            await self._emit("endpoint", asdict(ep))
        except Exception:
            pass

    async def _extract_links(self, page: Page) -> list[str]:
        """Extract links from the page for further crawling."""
        links = set()
        try:
            hrefs = await page.eval_on_selector_all("a[href]", "els => els.map(e => e.href)")
            for href in hrefs:
                if self._is_in_scope(href):
                    links.add(href.split("#")[0].split("?")[0])
        except Exception:
            pass
        return list(links)

    async def _extract_api_hints_from_source(self, page: Page, found_on_page: str):
        """Extract API endpoint hints from HTML source code."""
        try:
            html = await page.content()
            url_pattern = re.compile(
                r"""(?:["'`])((?:https?://[^\s"'`]+)?/(?:api|v\d+|graphql|rest|rpc)/[^\s"'`]*)(?:["'`])""", re.I
            )
            for match in url_pattern.finditer(html):
                raw = match.group(1)
                if raw.startswith("/"):
                    raw = f"https://{self.domain}{raw}"

                # Skip static files (images, fonts, etc.)
                if _is_static(raw):
                    continue

                parsed = urlparse(raw)
                host = parsed.hostname or self.domain
                host_lower = host.lower()

                # Determine if this is a subdomain/target domain API
                is_target_domain = (host_lower == self.domain or
                                   (self.include_subdomains and host_lower.endswith(f".{self.domain}")))

                # Apply API filter
                if self.api_filter == "subdomain" and not is_target_domain:
                    continue  # Skip external APIs
                elif self.api_filter == "external" and is_target_domain:
                    continue  # Skip target domain APIs

                # Calculate the line number where the match was found
                line_number = html[:match.start()].count('\n') + 1
                char_position = match.start() - html[:match.start()].rfind('\n')

                template_path = _templatize(parsed.path)
                sig = f"GET*|{host}|{template_path}"
                if sig not in self.seen_signatures:
                    self.seen_signatures.add(sig)

                    ep = DiscoveredEndpoint(
                        method="GET*", path=template_path, host=host, full_url=raw,
                        query_params=[], content_type=None, found_on_page=found_on_page,
                        detection_reason="Hardcoded in source", timestamp=datetime.utcnow().isoformat(),
                        resource_type="html",
                        source_location=f"HTML line {line_number}, char {char_position}",
                    )
                    self.endpoints.append(ep)
                    await self._emit("endpoint", asdict(ep))
        except Exception:
            pass

    def _is_in_scope(self, href: str) -> bool:
        """Check if a link is within crawling scope."""
        try:
            host = urlparse(href).hostname or ""
            host = host.lower()
            return host == self.domain or (self.include_subdomains and host.endswith(f".{self.domain}"))
        except Exception:
            return False

    async def _try_sitemap_fallback(self, page: Page) -> bool:
        """Try to fetch and parse sitemap.xml as a fallback when homepage fails.

        Returns:
            True if sitemap was successfully parsed and URLs were added to queue
        """
        await self._emit("status", {
            "message": f"📄 Trying sitemap fallback for {self.domain}"
        })

        # Use the sitemap parser module to fetch and parse sitemap
        urls_found = await fetch_sitemap_urls(
            domain=self.domain,
            page=page,
            include_subdomains=self.include_subdomains
        )

        if not urls_found:
            # No sitemap URLs found
            logger.info("Sitemap fallback failed: no sitemaps found or no valid URLs extracted")
            await self._emit("status", {
                "message": "⚠️ No sitemap found - scan will end"
            })
            return False

        # Add URLs to queue (skip already visited ones)
        added_count = 0
        for url in urls_found:
            if url not in self.visited_pages:
                # Add to queue with depth 0 (treat as if discovered from homepage)
                self.queue.append((url, 0))
                added_count += 1

        if added_count > 0:
            logger.info(f"✅ Sitemap fallback successful: added {added_count} URLs from {len(urls_found)} total")
            await self._emit("status", {
                "message": f"✅ Found {added_count} URLs in sitemap - continuing scan"
            })
            return True
        else:
            logger.info("All sitemap URLs were already visited")
            await self._emit("status", {
                "message": "⚠️ All sitemap URLs already visited - scan will end"
            })
            return False
