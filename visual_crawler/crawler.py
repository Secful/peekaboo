"""Core crawler logic for the Visual API Crawler."""

# Standard library
import asyncio
import base64
import json
import logging
import os
import random
import re
from dataclasses import asdict
from datetime import datetime
from typing import Optional, Callable, Awaitable
from urllib.parse import urlparse

# Set up logger
logger = logging.getLogger(__name__)

# Third-party
import httpx
from playwright.async_api import async_playwright, Page, Response

# Local imports
from .models import DiscoveredEndpoint
from .sitemap_parser import fetch_sitemap_urls
from .technology_detector import analyze_technologies
from .proxy_pool import ProxyPool
from .crawler_utils import (
    _templatize, _is_static, _auto_scroll, _interact, _deep_interact,
    _dismiss_floating_dialogs, _classify, _looks_like_js_payload,
)
from .constants import (
    DEFINITE_API_CONTENT_TYPES,
    MAYBE_API_CONTENT_TYPES,
    USER_AGENTS,
    VIEWPORTS,
    CAPTCHA_INDICATORS,
    CLOUDFLARE_INDICATORS,
    ACCESS_DENIED_INDICATORS,
)


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
                 scraping_browser_url: Optional[str] = None,
                 interaction_level: str = "standard") -> None:
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
        # Remote browsers need longer timeouts (CDP hop + anti-bot solving)
        # BrightData recommends 120s; default UI timeout is 30s, so 4x = 120s
        self._remote_timeout_multiplier = 4

        # Interaction level for deep interactions
        self.interaction_level = interaction_level

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

        # Alias domains discovered via cross-domain redirects (e.g. .com → .nl)
        self._alias_domains: set[str] = set()

        # Callback to push events to the dashboard
        self._on_event = None

        # Screenshot synchronization lock (prevent page close during screenshot)
        self._screenshot_lock = asyncio.Lock()

        # Android app detection (populated by background task)
        self.android_apps: list[dict] = []

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
            "message": f"Blocking detected: {blocking_str}"
        })

        if blocking_indicators['captcha']:
            # CAPTCHA requires human interaction - skip this page immediately
            await self._emit("status", {
                "message": f"CAPTCHA detected on {page_url} - skipping page"
            })
            raise Exception(f"CAPTCHA detected - page requires human verification")

        elif blocking_indicators['status_code']:
            # Rate limit or forbidden - exponential backoff
            backoff = min(10 * (2 ** (self.blocking_detected_count - 1)), 120)
            await self._emit("status", {
                "message": f"Rate limited - backing off {backoff}s..."
            })
            await self._sleep_with_heartbeat(backoff)

        # Try rotating identity after blocking
        if self.rotate_identity and self.blocking_detected_count >= 2:
            await self._rotate_browser_identity()

    _CHROMIUM_ARGS = [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
    ]

    @property
    def _nav_timeout(self) -> int:
        """Navigation timeout — longer for remote browsers (CDP hop + anti-bot)."""
        if self.using_remote_browser:
            return self.timeout * self._remote_timeout_multiplier
        return self.timeout

    async def _launch_local_browser(self, p):
        """Launch a local Chromium browser with standard args."""
        return await p.chromium.launch(headless=True, args=self._CHROMIUM_ARGS)

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
            "viewport": self.current_viewport,
            "ignore_https_errors": True,
        }

        # Remote browsers (e.g. BrightData Scraping Browser) manage their
        # own fingerprint and headers — don't override user_agent or headers.
        if not self.using_remote_browser:
            context_options["user_agent"] = self.current_user_agent
            context_options["extra_http_headers"] = {
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

        # Remote browser manages its own identity — skip rotation
        if self.using_remote_browser:
            logger.debug("Remote browser: skipping identity rotation")
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
                "message": "Rotated browser identity"
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
            self._playwright = p

            # Check if BrightData Scraping Browser URL is configured
            if self.scraping_browser_url:
                # Verify connectivity with a test connection
                try:
                    logger.info("🌐 Testing BrightData Scraping Browser connectivity...")
                    await self._emit("status", {"message": "Connecting to remote browser..."})
                    test_browser = await p.chromium.connect_over_cdp(self.scraping_browser_url)
                    await test_browser.close()
                    self.using_remote_browser = True
                    logger.info("✅ BrightData Scraping Browser available")
                    await self._emit("status", {"message": "Remote browser ready (parallel sessions)"})
                except Exception as e:
                    err_str = str(e)
                    logger.error(f"❌ Failed to connect to remote browser: {e}")
                    # Provide actionable diagnostics for common BrightData errors
                    if "403" in err_str and "wrong_customer_name" in err_str:
                        detail = "BrightData rejected credentials: customer name not recognized. Check peekaboo/proxy secret username."
                    elif "403" in err_str and "Auth Failed" in err_str:
                        detail = "BrightData authentication failed. Verify username and password in peekaboo/proxy secret."
                    elif "401" in err_str:
                        detail = "BrightData returned 401 Unauthorized. Password may be expired."
                    elif "timeout" in err_str.lower() or "ETIMEDOUT" in err_str:
                        detail = "Connection timed out reaching brd.superproxy.io:9222. Check network/firewall."
                    else:
                        detail = f"Error: {err_str[:200]}"
                    logger.error(f"❌ Remote browser diagnostic: {detail}")
                    await self._emit("status", {"message": f"Remote browser failed: {detail}"})
                    logger.info("🔄 Falling back to local browser...")
                    self.using_remote_browser = False

            if not self.using_remote_browser:
                # Local browser: launch once, create context with custom options
                self.browser = await self._launch_local_browser(p)
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

            # Fire-and-forget: detect Android app in background (never blocks the scan)
            android_task = asyncio.create_task(self._detect_android_app())

            # Process pages with controlled concurrency
            # Always process full queue, but only discover new pages during first max_pages
            while self.queue and not self._stopped:
                # Check if we need to rotate identity (based on pages crawled)
                if (self.rotate_identity and self.proxy_pool and
                    self.pages_since_rotation >= self.proxy_rotation_threshold):
                    await self._rotate_browser_identity()

                # Get batch of pages to crawl
                # Remote browser: limit concurrency (each page = separate CDP session)
                batch_size = min(3, self.concurrent_pages) if self.using_remote_browser else self.concurrent_pages
                batch = []
                while self.queue and len(batch) < batch_size:
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

                    # Crawl batch in parallel with per-page timeout
                    max_time_per_page = (self._nav_timeout * 2) // 1000  # Convert ms to seconds, double it
                    tasks = [asyncio.create_task(self._crawl_page_with_retry(url, depth)) for url, depth in batch]
                    done, pending = await asyncio.wait(tasks, timeout=max_time_per_page)
                    for task in pending:
                        task.cancel()
                    if pending:
                        await asyncio.gather(*pending, return_exceptions=True)

            # Close local browser (remote browser sessions are closed per-page)
            if self.browser:
                await self.browser.close()

            # Ensure background android detection finishes before we leave
            if not android_task.done():
                await asyncio.wait([android_task], timeout=15)

        # Clear queue if stopped early
        remaining_in_queue = len(self.queue)
        self.queue.clear()

        # Analyze technologies detected during scan
        logger.info("Analyzing detected technologies...")
        endpoint_dicts = [asdict(ep) for ep in self.endpoints]
        tech_analysis = analyze_technologies(endpoint_dicts, self.domain)

        await self._emit("crawl_complete", {
            "total_endpoints": len(self.endpoints),
            "pages_visited": len(self.visited_pages),
            "pages_skipped": remaining_in_queue,
            "technologies": tech_analysis,
        })
        return self.endpoints

    async def _crawl_page_with_retry(self, page_url: str, depth: int) -> None:
        """Crawl a page with retry logic and exponential backoff."""
        # Remote browser: no retries — BrightData handles retries internally
        max_retries = 1 if self.using_remote_browser else self.max_retries
        for attempt in range(max_retries):
            try:
                await self._crawl_page(page_url, depth)
                return  # Success
            except Exception as e:
                if attempt < max_retries - 1:
                    # Exponential backoff: 2^attempt seconds
                    backoff = 2 ** attempt
                    logger.warning(f"Retry {attempt + 1}/{max_retries} for {page_url} after {backoff}s: {e}")
                    await self._emit("status", {
                        "message": f"Retry {attempt + 1}/{max_retries} for {page_url}"
                    })
                    await self._sleep_with_heartbeat(backoff)

                    # Try rotating proxy on failure if available
                    if self.proxy_pool and attempt > 0:
                        await self._rotate_browser_identity()
                else:
                    logger.error(f"Failed for {page_url}: {e}")
                    await self._emit("crawl_error", {"url": page_url, "error": str(e)[:100]})

    async def _crawl_page(self, page_url: str, depth: int):
        """Crawl a single page."""
        self.visited_pages.add(page_url)

        # Remote browser: each page gets its own CDP session
        # (BrightData allows only one navigation per session)
        remote_browser = None
        if self.using_remote_browser and self.scraping_browser_url:
            try:
                remote_browser = await self._playwright.chromium.connect_over_cdp(
                    self.scraping_browser_url
                )
                context = remote_browser.contexts[0]
                page = await context.new_page()
            except Exception as e:
                logger.error(f"Failed to connect remote browser for {page_url}: {e}")
                await self._emit("crawl_error", {"url": page_url, "error": f"Remote browser connection failed"})
                return
        else:
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

            # Remote browsers: use domcontentloaded (BrightData handles the rest)
            wait_event = "domcontentloaded" if self.using_remote_browser else "load"

            # Try to navigate with timeout handling
            try:
                response = await page.goto(page_url, wait_until=wait_event, timeout=self._nav_timeout)
            except Exception as nav_error:
                # Page navigation failed (timeout, DNS error, connection refused, etc.)
                error_type = type(nav_error).__name__
                error_msg = str(nav_error)

                logger.warning(f"Navigation failed for {page_url}: {error_type} - {error_msg}")
                await self._emit("crawl_error", {"url": page_url, "error": error_msg})

                # On start URL failure, always try www. prefix
                # (covers timeouts, proxy 502s, DNS errors, protocol errors, etc.)
                if (not self._tried_www_fallback and
                    page_url == self._start_url and
                    not self.domain.startswith("www.")):

                    self._tried_www_fallback = True
                    www_domain = f"www.{self.domain}"
                    www_url = f"https://{www_domain}"

                    await self._emit("status", {"message": f"{self.domain} failed, trying {www_domain}..."})
                    logger.info(f"Retrying with www prefix: {www_url}")

                    try:
                        # Try with www prefix
                        response = await page.goto(www_url, wait_until=wait_event, timeout=self._nav_timeout)

                        # Success! Update domain for future requests
                        self.domain = www_domain
                        self._start_url = www_url
                        page_url = www_url

                        # Mark www URL as visited to avoid duplicate crawls
                        self.visited_pages.add(www_url)

                        await self._emit("status", {"message": f"Successfully connected to {www_domain}"})
                        logger.info(f"Connected to {www_url}, updating domain to {www_domain}")

                        # Continue with normal page processing (don't return)
                    except Exception as www_error:
                        # www prefix also failed - try sitemap fallback
                        logger.error(f"www prefix also failed: {www_error}")
                        await self._emit("crawl_error", {"url": www_url, "error": str(www_error)})
                        await self._emit("status", {"message": f"Could not connect to {self.domain} or {www_domain}"})

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
                    await self._emit("status", {"message": f"Skipped {page_url} (navigation failed). Continuing scan..."})
                    return

            # Detect cross-domain redirect on start URL (e.g. .com → .nl)
            if page_url == self._start_url and not self._alias_domains:
                try:
                    final_host = urlparse(page.url).hostname.lower()
                    if final_host != self.domain and not final_host.endswith(f".{self.domain}"):
                        base = final_host.removeprefix("www.")
                        self._alias_domains.add(base)
                        await self._emit("status", {"message": f"🔀 Redirect detected → {base} (added to scope)"})
                except Exception:
                    pass

            # Check for HTTP error status codes
            if response and response.status >= 400:
                error_msg = f"HTTP {response.status} error"
                logger.error(f"{error_msg} for {page_url}")
                await self._emit("crawl_error", {"url": page_url, "error": error_msg})
                # Still try to extract any API hints from error page
                if response.status == 403:
                    await self._emit("status", {"message": f"Access denied (403) for {page_url}. Site may be blocking crawlers."})

            # Wait for dynamic content
            # Remote browsers need more time for CAPTCHA solving / JS rendering
            if self.using_remote_browser:
                wait_time = 5000
            elif self.fast_mode:
                wait_time = 500
            else:
                wait_time = 2000
            await page.wait_for_timeout(wait_time)

            # Wait for SPA rendering — network idle signals JS frameworks have
            # finished fetching data and rendering the page content / nav links.
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass  # Timeout is fine — some pages never go fully idle

            logger.debug(f"Page loaded: {page_url}")

            # Detect blocking (if stealth mode is enabled)
            # Skip blocking detection for remote browsers — BrightData handles
            # CAPTCHAs and anti-bot challenges automatically.
            if self.stealth_mode and not self.using_remote_browser:
                blocking_indicators = await self._detect_blocking(page, response)
                if any(blocking_indicators.values()):
                    # If CAPTCHA detected on start URL, try sitemap fallback first
                    if blocking_indicators['captcha'] and page_url == self._start_url:
                        blocking_str = ', '.join([k for k, v in blocking_indicators.items() if v])
                        logger.warning(f"Blocking detected on start URL {page_url}: {blocking_str}")
                        await self._emit("status", {
                            "message": f"CAPTCHA detected on homepage - trying sitemap fallback"
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
                if self.using_remote_browser:
                    await _deep_interact(page, level=self.interaction_level)
                else:
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
            # Close per-page remote browser session
            if remote_browser:
                try:
                    await remote_browser.close()
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

            # Skip JavaScript payloads (content-type check)
            if _looks_like_js_payload(content_type):
                return

            reason = _classify(req_url, method, resource_type, response)
            if not reason:
                return

            parsed = urlparse(req_url)
            host = parsed.hostname or ""
            host_lower = host.lower()

            # Determine if this is a subdomain/target domain API
            is_target_domain = self._host_in_scope(host_lower)

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

            # Capture headers only for confirmed API calls on the target domain/subdomain
            if is_target_domain and api_confidence == "API":
                try:
                    request_headers_dict = await request.all_headers()
                    response_headers_dict = await response.all_headers()
                except Exception:
                    pass

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

                except Exception as e:
                    logger.warning(f"Failed to capture payloads: {e}")

            # Skip if response body looks like obfuscated JavaScript
            body_sample = response_body
            if not body_sample:
                try:
                    peek = await response.body()
                    if peek:
                        body_sample = peek[:2048].decode('utf-8', errors='ignore')
                except Exception:
                    pass
            if _looks_like_js_payload(content_type, body_sample):
                return

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
        except Exception as e:
            logger.warning(f"Link extraction failed: {e}")
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
                is_target_domain = self._host_in_scope(host_lower)

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

    def _host_in_scope(self, host: str) -> bool:
        """Check if a hostname matches the target domain or any alias domain."""
        h = host.lower()
        for d in [self.domain] + list(self._alias_domains):
            if h == d or (self.include_subdomains and h.endswith(f".{d}")):
                return True
        return False

    def _is_in_scope(self, href: str) -> bool:
        """Check if a link is within crawling scope."""
        try:
            host = urlparse(href).hostname or ""
            return self._host_in_scope(host)
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
            include_subdomains=self.include_subdomains,
            timeout=self._nav_timeout,
        )

        if not urls_found:
            # No sitemap URLs found
            logger.info("Sitemap fallback failed: no sitemaps found or no valid URLs extracted")
            await self._emit("status", {
                "message": "No sitemap found - scan will end"
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
                "message": f"Found {added_count} URLs in sitemap - continuing scan"
            })
            return True
        else:
            logger.info("All sitemap URLs were already visited")
            await self._emit("status", {
                "message": "All sitemap URLs already visited - scan will end"
            })
            return False

    async def _detect_android_app(self) -> None:
        """Detect Android apps via assetlinks.json, falling back to Play Store search.

        Runs as a background task — never raises; failures are logged and ignored.
        """
        _PLAY_HEADERS = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        }
        try:
            logger.info(f"📱 Android app detection started for {self.domain}")
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                # ── Strategy 1: assetlinks.json ──────────────────────────
                packages = await self._packages_from_assetlinks(client)

                # ── Strategy 2: Play Store search (fallback) ─────────────
                if not packages:
                    await self._emit("status", {
                        "message": f"No assetlinks.json — searching Play Store for {self.domain}"
                    })
                    packages = await self._packages_from_play_search(client, _PLAY_HEADERS)

                if not packages:
                    await self._emit("status", {
                        "message": f"No Android app found for {self.domain}"
                    })
                    await self._emit("android_not_found", {"domain": self.domain})
                    return

                # ── Verify each package on Google Play ───────────────────
                logger.info(f"Verifying {len(packages)} package(s) on Google Play: {packages}")
                verified: list[dict] = []
                for pkg in packages:
                    try:
                        play_url = f"https://play.google.com/store/apps/details?id={pkg}&hl=en"
                        play_resp = await client.get(play_url, headers=_PLAY_HEADERS)
                        logger.info(f"Play Store check {pkg}: HTTP {play_resp.status_code}")
                        if play_resp.status_code == 200:
                            app_name = pkg  # fallback
                            # og:title is server-rendered (unlike <title> which needs JS)
                            og_match = re.search(
                                r'<meta\s+property="og:title"\s+content="([^"]+)"', play_resp.text
                            )
                            if og_match:
                                app_name = og_match.group(1).split(" - Apps on")[0].strip() or pkg
                            else:
                                title_match = re.search(r"<title>([^<]+)</title>", play_resp.text)
                                if title_match:
                                    app_name = title_match.group(1).split(" - ")[0].strip() or pkg
                            verified.append({
                                "package_name": pkg,
                                "app_name": app_name,
                                "play_url": f"https://play.google.com/store/apps/details?id={pkg}",
                            })
                    except Exception as verify_err:
                        logger.warning(f"Play Store verification failed for {pkg}: {verify_err}")

                # ── Emit results and store ─
                if verified:
                    self.android_apps = verified
                    for app in verified:
                        await self._emit("status", {
                            "message": f"Android app: {app['app_name']} ({app['package_name']})"
                        })
                    await self._emit("android_apps", {"apps": verified})
                else:
                    await self._emit("status", {
                        "message": f"No downloadable Android app found for {self.domain}"
                    })
                    await self._emit("android_not_found", {"domain": self.domain})

        except Exception as e:
            logger.warning(f"Android app detection failed: {e}")
            await self._emit("status", {
                "message": f"Android app detection failed for {self.domain}"
            })

    # ── helpers for _detect_android_app ──────────────────────────────────────

    async def _packages_from_assetlinks(self, client: httpx.AsyncClient) -> set[str]:
        """Try to extract Android package names from assetlinks.json."""
        candidates = [self.domain]
        if not self.domain.startswith("www."):
            candidates.append(f"www.{self.domain}")
        else:
            candidates.append(self.domain.removeprefix("www."))

        allowed = {self.domain, f"www.{self.domain}",
                   self.domain.removeprefix("www.")}

        for candidate in candidates:
            url = f"https://{candidate}/.well-known/assetlinks.json"
            try:
                resp = await client.get(url)
            except Exception:
                continue
            final_host = resp.url.host.lower() if resp.url else ""
            if final_host and final_host.rstrip(".") not in allowed:
                continue
            if resp.status_code != 200:
                continue
            try:
                data = resp.json()
            except Exception:
                continue

            packages: set[str] = set()
            if isinstance(data, list):
                for entry in data:
                    target = entry.get("target", {}) if isinstance(entry, dict) else {}
                    if target.get("namespace") == "android_app":
                        pkg = target.get("package_name")
                        if pkg:
                            packages.add(pkg)
            if packages:
                return packages
        return set()

    async def _packages_from_play_search(
        self, client: httpx.AsyncClient, headers: dict
    ) -> set[str]:
        """Search Google Play for apps matching the domain brand and filter by relevance."""
        # Use the first segment of the domain as the search term
        brand = self.domain.removeprefix("www.").split(".")[0].lower()
        if len(brand) < 3:
            return set()

        search_url = f"https://play.google.com/store/search?q={brand}&c=apps&hl=en"
        try:
            resp = await client.get(search_url, headers=headers)
        except Exception:
            return set()
        if resp.status_code != 200:
            return set()

        # Extract unique package names from search results
        raw = re.findall(r"/store/apps/details\?id=([a-zA-Z0-9_.]+)", resp.text)
        candidates = list(dict.fromkeys(raw))[:10]  # dedupe, cap at 10

        # Filter: only keep apps whose Play Store page mentions the brand
        verified: set[str] = set()
        for pkg in candidates:
            try:
                app_url = f"https://play.google.com/store/apps/details?id={pkg}&hl=en"
                app_resp = await client.get(app_url, headers=headers)
                if app_resp.status_code == 200 and brand in app_resp.text.lower():
                    verified.add(pkg)
            except Exception:
                continue
        return verified

    async def _publish_apk_jobs(self, apps: list[dict]) -> None:
        """Publish one SQS message per Android app for APK download processing."""
        queue_name = "peekaboo-apk-analyzer"
        try:
            import boto3
            sqs = boto3.client("sqs", region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"))
            queue_url = sqs.get_queue_url(QueueName=queue_name)["QueueUrl"]
            logger.info(f"📱 SQS: resolved queue {queue_name} -> {queue_url}")
            sent = 0
            for app in apps:
                message = {
                    "package_name": app["package_name"],
                    "app_name": app["app_name"],
                    "play_url": app["play_url"],
                    "domain": self.domain,
                    "scan_id": self.scan_id,
                }
                body = json.dumps(message)
                sqs.send_message(QueueUrl=queue_url, MessageBody=body)
                sent += 1
                logger.info(f"📱 SQS: sent to {queue_name}: {body}")
            logger.info(f"📱 SQS: success — {sent}/{len(apps)} messages sent to {queue_name}")
            await self._emit("status", {
                "message": f"Published {sent} APK download job(s) to SQS"
            })
        except Exception as e:
            logger.error(f"📱 SQS: FAILED to publish to {queue_name}: {e}")
            await self._emit("status", {
                "message": f"Failed to publish APK jobs to SQS: {e}"
            })
            await self._emit("apk_publish_failed", {"error": str(e)})

