"""Core crawler logic for the Visual API Crawler."""

# Standard library
import asyncio
import base64
import re
from dataclasses import asdict
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

# Third-party
from playwright.async_api import async_playwright, Page, Response

# Local imports
from .models import DiscoveredEndpoint
from .constants import (
    STATIC_EXTENSIONS,
    API_PATH_PATTERNS,
    API_CONTENT_TYPES,
    DEFINITE_API_CONTENT_TYPES,
    MAYBE_API_CONTENT_TYPES,
    ID_PATTERNS,
)


class APICrawler:
    """Crawler that discovers API endpoints by monitoring network traffic."""

    def __init__(self, domain: str, max_pages: int = 50, max_depth: int = 3,
                 timeout: int = 30000, include_subdomains: bool = True,
                 api_filter: str = "all", proxy_config: Optional[dict] = None,
                 concurrent_pages: int = 5, fast_mode: bool = False):
        self.domain = domain.lower().replace("https://", "").replace("http://", "").rstrip("/")
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.timeout = timeout
        self.include_subdomains = include_subdomains
        self.api_filter = api_filter  # "all", "subdomain", or "external"
        self.proxy_config = proxy_config
        self.concurrent_pages = concurrent_pages  # Number of pages to crawl in parallel
        self.fast_mode = fast_mode  # Skip screenshots and interactions for speed

        self.visited_pages: set[str] = set()
        self.endpoints: list[DiscoveredEndpoint] = []
        self.seen_signatures: set[str] = set()
        self.queue: list[tuple[str, int]] = []

        # Track if we've tried www fallback for the initial URL
        self._tried_www_fallback = False
        self._start_url = None

        # Callback to push events to the dashboard
        self._on_event = None

    def on_event(self, callback):
        """Register a callback for crawler events."""
        self._on_event = callback

    async def _emit(self, event_type: str, data: dict):
        """Emit an event to the registered callback."""
        if self._on_event:
            await self._on_event({"type": event_type, **data})

    async def crawl(self):
        """Start the crawling process."""
        await self._emit("status", {"message": f"Starting scan of {self.domain}..."})

        async with async_playwright() as p:
            # Use new headless mode (harder to detect) with stealth args
            browser = await p.chromium.launch(
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

            context_options = {
                "user_agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
                "viewport": {"width": 1920, "height": 1080},
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

            # Add proxy configuration if provided
            if self.proxy_config:
                try:
                    context_options["proxy"] = self.proxy_config
                    print(f"[DEBUG] Proxy configured: {self.proxy_config.get('server', 'unknown')}")
                except Exception as e:
                    print(f"[WARNING] Failed to configure proxy: {e}")
                    await self._emit("status", {"message": f"Proxy configuration failed: {str(e)}"})

            self.context = await browser.new_context(**context_options)

            start_url = f"https://{self.domain}"
            self._start_url = start_url
            self.queue.append((start_url, 0))

            # Process pages with controlled concurrency
            # Always process full queue, but only discover new pages during first max_pages
            while self.queue:
                # Get batch of pages to crawl
                batch = []
                while self.queue and len(batch) < self.concurrent_pages:
                    page_url, depth = self.queue.pop(0)
                    if page_url not in self.visited_pages and depth <= self.max_depth:
                        batch.append((page_url, depth))

                if batch:
                    # Crawl batch in parallel with per-page timeout (2x page timeout)
                    max_time_per_page = (self.timeout * 2) // 1000  # Convert ms to seconds, double it
                    await asyncio.gather(
                        *[asyncio.wait_for(self._crawl_page(url, depth), timeout=max_time_per_page) for url, depth in batch],
                        return_exceptions=True
                    )

            await browser.close()

        # Clear queue if stopped early
        remaining_in_queue = len(self.queue)
        self.queue.clear()

        await self._emit("done", {
            "total_endpoints": len(self.endpoints),
            "pages_visited": len(self.visited_pages),
            "pages_skipped": remaining_in_queue,
        })
        return self.endpoints

    async def _crawl_page(self, page_url: str, depth: int):
        """Crawl a single page."""
        self.visited_pages.add(page_url)
        page = await self.context.new_page()

        # Mask automation signals to avoid bot detection
        await page.add_init_script("""
            // Remove webdriver flag
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});

            // Mock plugins and languages
            Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
            Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});

            // Mock chrome property
            window.chrome = {runtime: {}};

            // Mock permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({state: Notification.permission}) :
                    originalQuery(parameters)
            );
        """)

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

            print(f"[DEBUG] Navigating to: {page_url}")

            # Try to navigate with timeout handling
            try:
                response = await page.goto(page_url, wait_until="load", timeout=self.timeout)
            except Exception as nav_error:
                # Page navigation failed (timeout, DNS error, connection refused, etc.)
                error_type = type(nav_error).__name__
                error_msg = str(nav_error)

                print(f"[WARNING] Navigation failed for {page_url}: {error_type} - {error_msg}")

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
                    print(f"[INFO] Retrying with www prefix due to {failure_reason}: {www_url}")

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
                        print(f"[SUCCESS] Connected to {www_url}, updating domain to {www_domain}")

                        # Continue with normal page processing (don't return)
                    except Exception as www_error:
                        # www prefix also failed
                        print(f"[ERROR] www prefix also failed: {www_error}")
                        await self._emit("crawl_error", {"url": www_url, "error": f"Both {self.domain} and {www_domain} failed"})
                        await self._emit("status", {"message": f"❌ Could not connect to {self.domain} or {www_domain}"})
                        return
                else:
                    # Not the start URL or already tried www, just skip this page
                    await self._emit("crawl_error", {"url": page_url, "error": f"{error_type}: {error_msg}"})
                    await self._emit("status", {"message": f"⚠️ Skipped {page_url} (navigation failed). Continuing scan..."})
                    return

            # Check for HTTP error status codes
            if response and response.status >= 400:
                error_msg = f"HTTP {response.status} error"
                print(f"[ERROR] {error_msg} for {page_url}")
                await self._emit("crawl_error", {"url": page_url, "error": error_msg})
                # Still try to extract any API hints from error page
                if response.status == 403:
                    await self._emit("status", {"message": f"⚠️ Access denied (403) for {page_url}. Site may be blocking crawlers."})

            # Wait for dynamic content (shorter in fast mode)
            wait_time = 500 if self.fast_mode else 2000
            await page.wait_for_timeout(wait_time)
            print(f"[DEBUG] Page loaded: {page_url}")

            # Take screenshot (skip in fast mode for speed)
            if not self.fast_mode:
                try:
                    print(f"[DEBUG] Taking screenshot of: {page_url}")
                    screenshot_bytes = await page.screenshot(type="jpeg", quality=60, timeout=5000)
                    screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
                    print(f"[DEBUG] Screenshot captured, size: {len(screenshot_b64)} chars")
                    await self._emit("screenshot", {
                        "url": page_url,
                        "image": screenshot_b64,
                    })
                    print(f"[DEBUG] Screenshot emitted for: {page_url}")
                except Exception as screenshot_error:
                    print(f"[ERROR] Screenshot failed: {screenshot_error}")
                    # Don't emit error for screenshot failures, just skip it

            # Skip auto-scroll and interactions in fast mode
            if not self.fast_mode:
                await self._auto_scroll(page)
                await self._interact(page)

            await self._extract_api_hints_from_source(page, page_url)

            # Only discover new pages during the first max_pages visits
            # After max_pages, continue processing queue but don't add more pages
            if depth < self.max_depth and len(self.visited_pages) <= self.max_pages:
                links = await self._extract_links(page)
                print(f"[DEBUG] Found {len(links)} links on {page_url}, depth={depth}, visited={len(self.visited_pages)}")
                await self._emit("status", {"message": f"Found {len(links)} links on page (depth {depth})"})
                added = 0
                for link in links:
                    if link not in self.visited_pages:
                        self.queue.append((link, depth + 1))
                        added += 1
                print(f"[DEBUG] Added {added} new links to queue, queue size now: {len(self.queue)}")
                await self._emit("status", {"message": f"Added {added} links to queue (total: {len(self.queue)})"})
            else:
                print(f"[DEBUG] Skipping link extraction: depth={depth}, max_depth={self.max_depth}, visited={len(self.visited_pages)}, max={self.max_pages}")

            await self._emit("crawl_end", {"url": page_url})

        except Exception as e:
            print(f"[ERROR] Crawl error for {page_url}: {e}")
            await self._emit("crawl_error", {"url": page_url, "error": str(e)})
        finally:
            await page.close()

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
            if self._is_static(req_url):
                return

            # Check response content-type for images/media
            content_type = response.headers.get("content-type", "").lower()
            if any(ct in content_type for ct in ["image/", "font/", "video/", "audio/"]):
                return

            reason = self._classify(req_url, method, resource_type, response)
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

            template_path = self._templatize(parsed.path)
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
                    print(f"[WARNING] Failed to capture payloads: {e}")

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

    def _classify(self, req_url, method, resource_type, response) -> str:
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

        # Check API path patterns
        for pattern in API_PATH_PATTERNS:
            if pattern.search(path):
                return f"API path pattern"

        # XHR/fetch without JSON is still likely an API
        if resource_type in ("xhr", "fetch"):
            return "XHR/fetch request"

        return ""

    def _is_static(self, req_url):
        """Check if a URL points to a static file."""
        # Parse URL and get path without query parameters
        parsed_path = urlparse(req_url).path.lower()
        # Check if it ends with any static extension
        return any(parsed_path.endswith(ext) for ext in STATIC_EXTENSIONS)

    def _templatize(self, path):
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

    async def _auto_scroll(self, page: Page):
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

    async def _interact(self, page: Page):
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
                if self._is_static(raw):
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

                template_path = self._templatize(parsed.path)
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

    def _is_in_scope(self, href):
        """Check if a link is within crawling scope."""
        try:
            host = urlparse(href).hostname or ""
            host = host.lower()
            return host == self.domain or (self.include_subdomains and host.endswith(f".{self.domain}"))
        except Exception:
            return False
