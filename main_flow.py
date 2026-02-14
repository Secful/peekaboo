"""
Live Visual REST API Discovery Crawler
=======================================
Opens a real-time dashboard in your browser that shows:
  - Pages being crawled (with screenshots)
  - API endpoints appearing live as they're discovered
  - Stats updating in real-time

Architecture:
  FastAPI server  ←WebSocket→  Browser Dashboard
       ↕
  Playwright crawler (runs in background)

Usage:
    pip install playwright fastapi uvicorn websockets jinja2
    playwright install chromium
    python api_crawler.py --domain example.com
"""

import argparse
import asyncio
import base64
import json
import os
import re
import webbrowser
from dataclasses import dataclass, asdict
from datetime import datetime
from urllib.parse import urlparse
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
import uvicorn
from playwright.async_api import async_playwright, Page, Response


# ─── Data Models ──────────────────────────────────────────────────────────────

@dataclass
class DiscoveredEndpoint:
    method: str
    path: str
    host: str
    full_url: str
    query_params: list[str]
    content_type: Optional[str]
    response_status: Optional[int] = None
    found_on_page: str = ""
    detection_reason: str = ""
    timestamp: str = ""
    resource_type: Optional[str] = None  # "xhr", "fetch", "document", etc.
    source_location: Optional[str] = None  # Line number or file info


# ─── Crawler ──────────────────────────────────────────────────────────────────

STATIC_EXTENSIONS = {
    ".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".eot", ".otf", ".mp4", ".webp", ".map",
    ".br", ".gz", ".webmanifest", ".xml", ".txt", ".pdf",
    ".webm", ".avi", ".mov", ".mp3", ".wav", ".ogg", ".flac",
    ".bmp", ".tiff", ".tif", ".avif", ".apng",
}

API_PATH_PATTERNS = [
    re.compile(r"/api/", re.I),
    re.compile(r"/v\d+/", re.I),
    re.compile(r"/graphql", re.I),
    re.compile(r"/rest/", re.I),
    re.compile(r"/rpc/", re.I),
    re.compile(r"/gateway/", re.I),
    re.compile(r"/service/", re.I),
    re.compile(r"/ajax/", re.I),
]

API_CONTENT_TYPES = ["application/json", "application/xml", "text/xml"]

ID_PATTERNS = [
    (re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I), "{uuid}"),
    (re.compile(r"[0-9a-f]{24}"), "{objectId}"),
    (re.compile(r"^\d+$"), "{id}"),
    (re.compile(r"^[A-Za-z0-9_-]{20,}$"), "{token}"),
]


class APICrawler:
    def __init__(self, domain: str, max_pages: int = 50, max_depth: int = 3,
                 timeout: int = 30000, include_subdomains: bool = True,
                 api_filter: str = "all", proxy_config: Optional[dict] = None):
        self.domain = domain.lower().replace("https://", "").replace("http://", "").rstrip("/")
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.timeout = timeout
        self.include_subdomains = include_subdomains
        self.api_filter = api_filter  # "all", "subdomain", or "external"
        self.proxy_config = proxy_config

        self.visited_pages: set[str] = set()
        self.endpoints: list[DiscoveredEndpoint] = []
        self.seen_signatures: set[str] = set()
        self.queue: list[tuple[str, int]] = []

        # Callback to push events to the dashboard
        self._on_event = None

    def on_event(self, callback):
        self._on_event = callback

    async def _emit(self, event_type: str, data: dict):
        if self._on_event:
            await self._on_event({"type": event_type, **data})

    async def crawl(self):
        await self._emit("status", {"message": f"Starting scan of {self.domain}..."})

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)

            context_options = {
                "user_agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
                ),
                "viewport": {"width": 1280, "height": 720},
                "ignore_https_errors": True,
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
            self.queue.append((start_url, 0))

            while self.queue and len(self.visited_pages) < self.max_pages:
                page_url, depth = self.queue.pop(0)
                if page_url in self.visited_pages or depth > self.max_depth:
                    continue
                await self._crawl_page(page_url, depth)

            await browser.close()

        await self._emit("done", {
            "total_endpoints": len(self.endpoints),
            "pages_visited": len(self.visited_pages),
        })
        return self.endpoints

    async def _crawl_page(self, page_url: str, depth: int):
        self.visited_pages.add(page_url)
        page = await self.context.new_page()

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
            await page.goto(page_url, wait_until="load", timeout=self.timeout)
            # Wait a bit for dynamic content to load
            await page.wait_for_timeout(2000)
            print(f"[DEBUG] Page loaded: {page_url}")

            # Take screenshot for the dashboard
            try:
                print(f"[DEBUG] Taking screenshot of: {page_url}")
                screenshot_bytes = await page.screenshot(type="jpeg", quality=60)
                screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
                print(f"[DEBUG] Screenshot captured, size: {len(screenshot_b64)} chars")
                await self._emit("screenshot", {
                    "url": page_url,
                    "image": screenshot_b64,
                })
                print(f"[DEBUG] Screenshot emitted for: {page_url}")
            except Exception as screenshot_error:
                print(f"[ERROR] Screenshot failed: {screenshot_error}")
                await self._emit("crawl_error", {"url": page_url, "error": f"Screenshot error: {str(screenshot_error)}"})

            await self._auto_scroll(page)
            await self._interact(page)
            await self._extract_api_hints_from_source(page, page_url)

            if depth < self.max_depth:
                links = await self._extract_links(page)
                for link in links:
                    if link not in self.visited_pages:
                        self.queue.append((link, depth + 1))

            await self._emit("crawl_end", {"url": page_url})

        except Exception as e:
            print(f"[ERROR] Crawl error for {page_url}: {e}")
            await self._emit("crawl_error", {"url": page_url, "error": str(e)})
        finally:
            await page.close()

    async def _on_response(self, response: Response, found_on_page: str):
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
            )
            self.endpoints.append(ep)
            await self._emit("endpoint", asdict(ep))
        except Exception:
            pass

    def _classify(self, req_url, method, resource_type, response) -> str:
        parsed = urlparse(req_url)
        path = parsed.path
        if method not in ("GET", "HEAD", "OPTIONS"):
            return f"{method} request"
        if resource_type in ("xhr", "fetch"):
            resp_ct = response.headers.get("content-type", "")
            if any(ct in resp_ct for ct in API_CONTENT_TYPES):
                return "XHR/fetch JSON response"
        for pattern in API_PATH_PATTERNS:
            if pattern.search(path):
                return f"API path pattern"
        if resource_type in ("xhr", "fetch"):
            return "XHR/fetch request"
        return ""

    def _is_static(self, req_url):
        # Parse URL and get path without query parameters
        parsed_path = urlparse(req_url).path.lower()
        # Check if it ends with any static extension
        return any(parsed_path.endswith(ext) for ext in STATIC_EXTENSIONS)

    def _templatize(self, path):
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

                # Calculate line number where the match was found
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
        try:
            host = urlparse(href).hostname or ""
            host = host.lower()
            return host == self.domain or (self.include_subdomains and host.endswith(f".{self.domain}"))
        except Exception:
            return False


# ─── Dashboard HTML ───────────────────────────────────────────────────────────

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>API Discovery – Live Scan</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
  :root {
    --bg: #0a0b10; --surface: #12141d; --surface2: #1a1d2a;
    --border: #252836; --text: #e1e4ed; --muted: #6b7089;
    --accent: #6c5ce7; --accent2: #a29bfe;
    --get: #00cec9; --post: #0984e3; --put: #fdcb6e;
    --patch: #e17055; --delete: #d63031; --green: #00b894;
    --glow: rgba(108,92,231,0.3);
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',sans-serif; background:var(--bg); color:var(--text); overflow-x:hidden; }

  /* Start Form Overlay */
  .start-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(10, 11, 16, 0.95); backdrop-filter: blur(10px);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .start-overlay.hidden { display: none; }
  .start-form-container {
    background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
    padding: 2rem; max-width: 500px; width: 90%;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  .start-form-container h2 {
    font-size: 1.5rem; margin-bottom: 0.5rem;
    background: linear-gradient(135deg, var(--accent2), var(--accent));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .start-form-container .subtitle {
    color: var(--muted); font-size: 0.9rem; margin-bottom: 1.5rem;
  }
  .form-group {
    margin-bottom: 1.25rem;
  }
  .form-group label {
    display: block; font-size: 0.85rem; font-weight: 600;
    color: var(--text); margin-bottom: 0.5rem;
  }
  .form-group input[type="text"],
  .form-group input[type="number"] {
    width: 100%; padding: 0.65rem 0.85rem; background: var(--surface2);
    border: 1px solid var(--border); border-radius: 8px; color: var(--text);
    font-size: 0.9rem; font-family: 'Inter', sans-serif;
  }
  .form-group input:focus {
    outline: none; border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.1);
  }
  .form-group .hint {
    font-size: 0.75rem; color: var(--muted); margin-top: 0.35rem;
  }
  .form-group-inline {
    display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
  }
  .checkbox-group {
    display: flex; align-items: center; gap: 0.5rem;
  }
  .checkbox-group input[type="checkbox"] {
    width: 18px; height: 18px; cursor: pointer;
  }
  .radio-group {
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .radio-option {
    display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem;
    border-radius: 6px; cursor: pointer; transition: background 0.2s;
  }
  .radio-option:hover {
    background: var(--surface2);
  }
  .radio-option input[type="radio"] {
    width: 16px; height: 16px; cursor: pointer;
  }
  .radio-option label {
    margin: 0 !important; cursor: pointer; flex: 1;
  }
  .start-btn {
    width: 100%; padding: 0.85rem; background: linear-gradient(135deg, var(--accent), var(--accent2));
    border: none; border-radius: 8px; color: white; font-size: 1rem;
    font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;
  }
  .start-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 25px rgba(108, 92, 231, 0.3);
  }
  .start-btn:active { transform: translateY(0); }
  .start-btn:disabled {
    opacity: 0.5; cursor: not-allowed; transform: none;
  }

  /* Layout */
  .app { display:grid; grid-template-columns:340px 1fr; grid-template-rows:auto 1fr; height:100vh; }
  .top-bar {
    grid-column:1/-1; padding:0.75rem 1.5rem;
    background:var(--surface); border-bottom:1px solid var(--border);
    display:flex; align-items:center; justify-content:space-between;
  }
  .top-bar h1 {
    font-size:1.1rem; font-weight:700;
    background:linear-gradient(135deg,var(--accent2),var(--accent));
    -webkit-background-clip:text; -webkit-text-fill-color:transparent;
  }
  .top-bar .domain-label { color:var(--muted); font-size:0.85rem; }
  .scan-controls {
    display:flex; gap:0.5rem; align-items:center;
  }
  .control-btn {
    padding:0.4rem 0.8rem; border-radius:6px; border:1px solid var(--border);
    background:var(--surface2); color:var(--text); cursor:pointer;
    font-size:0.8rem; font-weight:600; transition:all 0.2s;
    display:flex; align-items:center; gap:0.35rem;
  }
  .control-btn:hover { border-color:var(--accent); background:var(--accent); color:#fff; }
  .control-btn.stop { border-color:var(--delete); color:var(--delete); }
  .control-btn.stop:hover { background:var(--delete); color:#fff; }
  .control-btn.hidden { display:none; }

  /* Left panel */
  .left-panel {
    background:var(--surface); border-right:1px solid var(--border);
    display:flex; flex-direction:column; overflow:hidden;
  }
  .stats-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; padding:1rem; }
  .stat-box {
    background:var(--surface2); border:1px solid var(--border); border-radius:10px;
    padding:0.75rem; text-align:center;
  }
  .stat-box .num { font-size:1.5rem; font-weight:700; color:var(--accent2); }
  .stat-box .lbl { font-size:0.7rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; }

  /* Activity log */
  .activity-header { padding:0.75rem 1rem; font-size:0.75rem; font-weight:600;
    color:var(--muted); text-transform:uppercase; letter-spacing:0.05em;
    border-top:1px solid var(--border); border-bottom:1px solid var(--border);
    background:var(--surface2);
  }
  .activity-log { flex:1; overflow-y:auto; padding:0.5rem; }
  .log-entry {
    padding:0.5rem 0.6rem; border-radius:6px; margin-bottom:0.3rem;
    font-size:0.78rem; color:var(--muted); transition:background 0.2s;
    display:flex; align-items:center; gap:0.5rem;
  }
  .log-entry:hover { background:var(--surface2); }
  .log-entry .icon { flex-shrink:0; font-size:0.85rem; }
  .log-entry .msg { word-break:break-all; }
  .log-entry.endpoint { color:var(--green); }
  .log-entry.error { color:var(--patch); }
  .log-entry.page { color:var(--accent2); }

  /* Screenshot */
  .screenshot-section { padding:0.75rem 1rem; border-top:1px solid var(--border); }
  .screenshot-section .label { font-size:0.7rem; color:var(--muted); text-transform:uppercase;
    letter-spacing:0.05em; margin-bottom:0.5rem; }
  .screenshot-box {
    width:100%; aspect-ratio:16/9; border-radius:8px; overflow:hidden;
    background: linear-gradient(135deg, #1a1d2a 0%, #2a2d3a 100%);
    border:1px solid var(--border);
    display:flex; align-items:center; justify-content:center;
    position: relative;
  }
  .screenshot-box img { width:100%; height:100%; object-fit:cover; }
  .screenshot-box .placeholder {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 2rem; text-align: center;
  }
  .placeholder-logo {
    font-size: 3rem; font-weight: 700;
    background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    margin-bottom: 1rem; letter-spacing: -0.02em;
  }
  .placeholder-subtitle {
    color: var(--muted); font-size: 0.85rem; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.1em;
  }
  .current-url {
    margin-top:0.4rem; font-size:0.7rem; color:var(--muted);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }

  /* Right panel – endpoint table */
  .right-panel { display:flex; flex-direction:column; overflow:hidden; }
  .table-controls {
    padding:0.75rem 1rem; display:flex; gap:0.5rem; align-items:center;
    border-bottom:1px solid var(--border); background:var(--surface);
  }
  .search-input {
    flex:1; padding:0.45rem 0.75rem; background:var(--surface2);
    border:1px solid var(--border); border-radius:6px; color:var(--text);
    font-size:0.85rem; outline:none;
  }
  .search-input:focus { border-color:var(--accent); }
  .filter-btn {
    padding:0.3rem 0.6rem; border-radius:5px; border:1px solid var(--border);
    background:var(--surface2); color:var(--muted); cursor:pointer;
    font-size:0.72rem; font-weight:600; transition:all 0.2s;
  }
  .filter-btn:hover { border-color:var(--accent); color:var(--text); }
  .filter-btn.active { background:var(--accent); color:#fff; border-color:var(--accent); }
  .filter-section {
    display:flex; align-items:center; gap:0.5rem; padding:0.25rem 0;
  }
  .filter-label {
    font-size:0.7rem; color:var(--muted); text-transform:uppercase;
    letter-spacing:0.05em; font-weight:600; white-space:nowrap;
  }
  .filter-divider {
    width:1px; height:20px; background:var(--border); margin:0 0.25rem;
  }

  .table-scroll { flex:1; overflow-y:auto; }
  table { width:100%; border-collapse:collapse; }
  thead th {
    position:sticky; top:0; z-index:2;
    padding:0.6rem 0.75rem; text-align:left; font-size:0.72rem; font-weight:600;
    text-transform:uppercase; letter-spacing:0.04em; color:var(--muted);
    background:var(--surface); border-bottom:1px solid var(--border); cursor:pointer;
  }
  thead th:hover { color:var(--accent2); }
  tbody tr { border-bottom:1px solid var(--border); transition:background 0.15s; }
  tbody tr:hover { background:rgba(108,92,231,0.04); }
  td { padding:0.55rem 0.75rem; font-size:0.85rem; }

  .badge {
    display:inline-block; padding:0.15rem 0.5rem; border-radius:4px;
    font-size:0.72rem; font-weight:700; font-family:'JetBrains Mono',monospace;
    text-align:center; min-width:52px;
  }
  .badge-GET   { background:rgba(0,206,201,0.12); color:var(--get); }
  .badge-GET\\* { background:rgba(0,206,201,0.06); color:var(--get); border:1px dashed var(--get); }
  .badge-POST  { background:rgba(9,132,227,0.12); color:var(--post); }
  .badge-PUT   { background:rgba(253,203,110,0.12); color:var(--put); }
  .badge-PATCH { background:rgba(225,112,85,0.12); color:var(--patch); }
  .badge-DELETE{ background:rgba(214,48,49,0.12); color:var(--delete); }
  .badge-OPTIONS{ background:rgba(107,112,137,0.12); color:var(--muted); }

  .path-cell { font-family:'JetBrains Mono',monospace; font-size:0.8rem; word-break:break-all; }
  .host-cell { color:var(--muted); font-size:0.8rem; }
  .status-2xx { color:var(--green); } .status-3xx { color:var(--put); }
  .status-4xx { color:var(--patch); } .status-5xx { color:var(--delete); }
  .reason-cell { color:var(--muted); font-size:0.75rem; }

  /* Pulse animation for live indicator */
  .live-dot {
    width:8px; height:8px; border-radius:50%; background:var(--green);
    display:inline-block; margin-right:0.4rem;
    animation:pulse 1.5s ease infinite;
  }
  .live-dot.done { background:var(--muted); animation:none; }
  @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }

  .status-badge { display:flex; align-items:center; font-size:0.8rem; font-weight:600; }

  /* New endpoint flash */
  @keyframes flashIn {
    0% { background:rgba(0,206,201,0.15); }
    100% { background:transparent; }
  }
  .flash { animation: flashIn 1.2s ease-out; }

  .empty-state { text-align:center; padding:4rem 2rem; color:var(--muted); }
  .empty-state .icon { font-size:3rem; margin-bottom:1rem; }

  /* Detail Drawer */
  .detail-drawer {
    position: fixed; top: 0; right: -500px; bottom: 0; width: 500px;
    background: var(--surface); border-left: 1px solid var(--border);
    box-shadow: -5px 0 20px rgba(0,0,0,0.3); z-index: 2000;
    transition: right 0.3s ease; overflow-y: auto;
  }
  .detail-drawer.open { right: 0; }
  .drawer-header {
    padding: 1.5rem; border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
    background: var(--surface2);
  }
  .drawer-header h3 {
    font-size: 1.1rem; color: var(--accent2); margin: 0;
  }
  .drawer-close {
    background: none; border: none; color: var(--muted);
    font-size: 1.5rem; cursor: pointer; padding: 0.25rem 0.5rem;
    transition: color 0.2s;
  }
  .drawer-close:hover { color: var(--text); }
  .drawer-content { padding: 1.5rem; }
  .detail-section {
    margin-bottom: 1.5rem; padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }
  .detail-section:last-child { border-bottom: none; }
  .detail-label {
    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--muted); margin-bottom: 0.5rem; font-weight: 600;
  }
  .detail-value {
    font-size: 0.9rem; color: var(--text); word-break: break-all;
    font-family: 'JetBrains Mono', monospace;
  }
  .detail-value.large { font-size: 1.1rem; font-weight: 600; }
  .query-param {
    background: var(--surface2); padding: 0.3rem 0.6rem;
    border-radius: 4px; display: inline-block; margin: 0.2rem;
    font-size: 0.8rem;
  }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: rgba(108,92,231,0.08); }
</style>
</head>
<body>
<!-- Start Form Overlay -->
<div class="start-overlay" id="startOverlay">
  <div class="start-form-container">
    <h2>🔍 API Discovery Scanner</h2>
    <p class="subtitle">Configure your scan parameters and start discovering APIs</p>
    <form id="startForm" onsubmit="startScan(event)">
      <div class="form-group">
        <label>Domain Name <span style="color:var(--patch)">*</span></label>
        <input type="text" id="domain" name="domain" placeholder="example.com" required>
        <div class="hint">Enter the target domain without http:// or https://</div>
      </div>

      <div class="form-group-inline">
        <div class="form-group">
          <label>Max Pages</label>
          <input type="number" id="maxPages" name="maxPages" value="50" min="1" max="500">
          <div class="hint">Default: 50</div>
        </div>

        <div class="form-group">
          <label>Max Depth</label>
          <input type="number" id="maxDepth" name="maxDepth" value="3" min="1" max="10">
          <div class="hint">Default: 3</div>
        </div>
      </div>

      <div class="form-group">
        <label>Timeout (ms)</label>
        <input type="number" id="timeout" name="timeout" value="30000" min="5000" max="120000" step="1000">
        <div class="hint">Page load timeout in milliseconds (default: 30000)</div>
      </div>

      <div class="form-group">
        <div class="checkbox-group">
          <input type="checkbox" id="includeSubdomains" name="includeSubdomains" checked>
          <label for="includeSubdomains" style="margin:0">Follow Subdomain Links</label>
        </div>
        <div class="hint">Visit pages on subdomains (e.g., api.example.com, app.example.com)</div>
      </div>

      <div class="form-group">
        <label>Scan-Time API Filter</label>
        <div class="radio-group">
          <div class="radio-option">
            <input type="radio" id="filterAll" name="apiFilter" value="all" checked>
            <label for="filterAll">Collect All APIs</label>
          </div>
          <div class="radio-option">
            <input type="radio" id="filterSubdomain" name="apiFilter" value="subdomain">
            <label for="filterSubdomain">Only Target Domain APIs</label>
          </div>
          <div class="radio-option">
            <input type="radio" id="filterExternal" name="apiFilter" value="external">
            <label for="filterExternal">Only External APIs</label>
          </div>
        </div>
        <div class="hint">Which APIs to collect during scan (you can also filter in the table after scanning)</div>
      </div>

      <button type="submit" class="start-btn" id="startBtn">
        🚀 Start Scan
      </button>
    </form>
  </div>
</div>

<div class="app">
  <!-- Top bar -->
  <div class="top-bar">
    <h1>🔍 API Discovery Scanner</h1>
    <div style="display:flex;align-items:center;gap:1rem;">
      <div class="scan-controls">
        <button class="control-btn hidden" id="stopBtn" onclick="stopScan()">
          ⏹ Stop Scan
        </button>
        <button class="control-btn hidden" id="newScanBtn" onclick="newScan()">
          🔄 New Scan
        </button>
      </div>
      <div class="status-badge">
        <span class="live-dot" id="liveDot"></span>
        <span id="statusText">Ready</span>
      </div>
    </div>
  </div>

  <!-- Left panel -->
  <div class="left-panel">
    <div class="stats-grid">
      <div class="stat-box"><div class="num" id="statEndpoints">0</div><div class="lbl">Endpoints</div></div>
      <div class="stat-box"><div class="num" id="statPages">0</div><div class="lbl">Pages</div></div>
      <div class="stat-box"><div class="num" id="statHosts">0</div><div class="lbl">Hosts</div></div>
      <div class="stat-box"><div class="num" id="statQueue">0</div><div class="lbl">In Queue</div></div>
    </div>

    <div class="screenshot-section">
      <div class="label">Live Preview</div>
      <div class="screenshot-box" id="screenshotBox">
        <div class="placeholder">
          <div class="placeholder-logo">SALT SECURITY</div>
          <div class="placeholder-subtitle">API Discovery Scanner</div>
        </div>
      </div>
      <div class="current-url" id="currentUrl">&nbsp;</div>
    </div>

    <div class="activity-header">Activity Log</div>
    <div class="activity-log" id="activityLog"></div>
  </div>

  <!-- Right panel -->
  <div class="right-panel">
    <div class="table-controls">
      <input class="search-input" id="searchInput" placeholder="Filter endpoints..." oninput="applyFilters()">
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
        <div class="filter-section">
          <span class="filter-label">Domain:</span>
          <span class="filter-btn active" id="domainAll" onclick="setDomainFilter('all')">All</span>
          <span class="filter-btn" id="domainSubdomain" onclick="setDomainFilter('subdomain')">Subdomain</span>
          <span class="filter-btn" id="domainExternal" onclick="setDomainFilter('external')">External</span>
        </div>
        <div class="filter-divider"></div>
        <div class="filter-section">
          <span class="filter-label">Method:</span>
          <div id="methodFilters" style="display:flex;gap:0.3rem;flex-wrap:wrap;"></div>
        </div>
      </div>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th style="width:75px" onclick="sortBy('method')">Method</th>
            <th onclick="sortBy('path')">Path</th>
            <th onclick="sortBy('host')">Host</th>
            <th style="width:60px" onclick="sortBy('status')">Status</th>
            <th onclick="sortBy('reason')">Detected Via</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
      <div class="empty-state" id="emptyState">
        <div class="icon">📡</div>
        <div>Waiting for API endpoints to appear...</div>
      </div>
    </div>
  </div>
</div>

<!-- Detail Drawer -->
<div class="detail-drawer" id="detailDrawer">
  <div class="drawer-header">
    <h3>Endpoint Details</h3>
    <button class="drawer-close" onclick="closeDrawer()">×</button>
  </div>
  <div class="drawer-content" id="drawerContent">
    <!-- Content populated by JavaScript -->
  </div>
</div>

<script>
const endpoints = [];
const hosts = new Set();
const activeFilters = new Set();
let sortCol = null, sortAsc = true;
let ws = null;
let targetDomain = '';
let includeSubdomains = true;
let domainFilter = 'all'; // 'all', 'subdomain', or 'external'

function startScan(event) {
  event.preventDefault();

  const domain = document.getElementById('domain').value.trim();
  if (!domain) {
    alert('Please enter a domain name');
    return;
  }

  const apiFilter = document.querySelector('input[name="apiFilter"]:checked').value;

  const params = {
    domain: domain,
    max_pages: parseInt(document.getElementById('maxPages').value) || 50,
    max_depth: parseInt(document.getElementById('maxDepth').value) || 3,
    timeout: parseInt(document.getElementById('timeout').value) || 30000,
    include_subdomains: document.getElementById('includeSubdomains').checked,
    api_filter: apiFilter
  };

  // Store target domain and settings for UI filtering
  targetDomain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  includeSubdomains = params.include_subdomains;

  // Hide the overlay and show controls
  document.getElementById('startOverlay').classList.add('hidden');
  document.getElementById('statusText').textContent = 'Connecting...';
  document.getElementById('stopBtn').classList.remove('hidden');
  document.getElementById('newScanBtn').classList.add('hidden');

  // Connect WebSocket and send params
  ws = new WebSocket(`ws://${location.host}/ws`);

  ws.onopen = () => {
    document.getElementById('statusText').textContent = 'Starting scan...';
    addLog('🚀', `Connected. Starting scan of ${params.domain}...`, 'page');
    ws.send(JSON.stringify(params));
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleEvent(msg);
  };

  ws.onclose = () => {
    document.getElementById('liveDot').classList.add('done');
    document.getElementById('statusText').textContent = 'Disconnected';
    document.getElementById('stopBtn').classList.add('hidden');
    document.getElementById('newScanBtn').classList.remove('hidden');
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    addLog('⚠️', 'Connection error', 'error');
  };
}

function stopScan() {
  if (ws) {
    ws.close();
    ws = null;
  }
  document.getElementById('liveDot').classList.add('done');
  document.getElementById('statusText').textContent = 'Stopped';
  document.getElementById('stopBtn').classList.add('hidden');
  document.getElementById('newScanBtn').classList.remove('hidden');
  addLog('⏹', 'Scan stopped by user', '');
}

function newScan() {
  // Clear current data
  endpoints.length = 0;
  hosts.clear();
  activeFilters.clear();
  domainFilter = 'all';
  targetDomain = '';

  // Reset UI
  document.getElementById('tbody').innerHTML = '';
  document.getElementById('activityLog').innerHTML = '';
  document.getElementById('emptyState').style.display = 'block';
  document.getElementById('statEndpoints').textContent = '0';
  document.getElementById('statPages').textContent = '0';
  document.getElementById('statHosts').textContent = '0';
  document.getElementById('statQueue').textContent = '0';
  document.getElementById('screenshotBox').innerHTML = `
    <div class="placeholder">
      <div class="placeholder-logo">SALT SECURITY</div>
      <div class="placeholder-subtitle">API Discovery Scanner</div>
    </div>
  `;
  document.getElementById('currentUrl').textContent = '\u00A0';
  document.getElementById('methodFilters').innerHTML = '';
  document.getElementById('liveDot').classList.remove('done');
  document.getElementById('statusText').textContent = 'Ready';
  document.getElementById('newScanBtn').classList.add('hidden');

  // Reset domain filter buttons
  ['All', 'Subdomain', 'External'].forEach(f => {
    const btn = document.getElementById(`domain${f}`);
    if (btn) {
      btn.classList.toggle('active', f === 'All');
    }
  });

  // Show the start form
  document.getElementById('startOverlay').classList.remove('hidden');
}

function handleEvent(msg) {
  switch(msg.type) {
    case 'status':
      addLog('ℹ️', msg.message, '');
      break;

    case 'error':
      addLog('⚠️', msg.message, 'error');
      document.getElementById('statusText').textContent = 'Error';
      break;

    case 'crawl_start':
      document.getElementById('statPages').textContent = msg.pages_visited;
      document.getElementById('statQueue').textContent = msg.pages_remaining;
      document.getElementById('statEndpoints').textContent = msg.total_endpoints;
      document.getElementById('currentUrl').textContent = msg.url;
      addLog('📄', `Crawling: ${shortenUrl(msg.url)}`, 'page');
      break;

    case 'screenshot':
      const box = document.getElementById('screenshotBox');
      box.innerHTML = `<img src="data:image/jpeg;base64,${msg.image}" alt="screenshot">`;
      document.getElementById('currentUrl').textContent = msg.url;
      break;

    case 'endpoint':
      endpoints.push(msg);
      hosts.add(msg.host);
      document.getElementById('statEndpoints').textContent = endpoints.length;
      document.getElementById('statHosts').textContent = hosts.size;
      document.getElementById('emptyState').style.display = 'none';
      addEndpointRow(msg, true);
      updateMethodFilters();
      addLog('🎯', `${msg.method} ${msg.host}${msg.path}`, 'endpoint');
      break;

    case 'crawl_error':
      addLog('⚠️', `Error: ${shortenUrl(msg.url)}`, 'error');
      break;

    case 'crawl_end':
      break;

    case 'done':
      document.getElementById('liveDot').classList.add('done');
      document.getElementById('statusText').textContent =
        `Done — ${msg.total_endpoints} endpoints found`;
      document.getElementById('stopBtn').classList.add('hidden');
      document.getElementById('newScanBtn').classList.remove('hidden');
      addLog('✅', `Scan complete. ${msg.total_endpoints} endpoints across ${msg.pages_visited} pages.`, '');
      break;
  }
}

function addEndpointRow(ep, flash=false) {
  const tbody = document.getElementById('tbody');
  const tr = document.createElement('tr');
  if (flash) tr.classList.add('flash');
  tr.dataset.method = ep.method;
  tr.dataset.path = ep.path;
  tr.dataset.host = ep.host;
  tr.dataset.endpoint = JSON.stringify(ep); // Store full endpoint data
  tr.onclick = () => openDrawer(ep);

  const statusClass = ep.response_status ? `status-${Math.floor(ep.response_status/100)}xx` : '';
  const badgeClass = `badge-${ep.method.replace('*','\\\\*')}`;

  tr.innerHTML = `
    <td><span class="badge ${badgeClass}">${ep.method}</span></td>
    <td class="path-cell">${escHtml(ep.path)}</td>
    <td class="host-cell">${escHtml(ep.host)}</td>
    <td class="${statusClass}" style="font-weight:600;font-size:0.8rem">${ep.response_status||'—'}</td>
    <td class="reason-cell">${escHtml(ep.detection_reason)}</td>
  `;

  // Check if this row should be visible based on current filters
  const searchQuery = document.getElementById('searchInput').value.toLowerCase();
  const text = `${ep.method} ${ep.path} ${ep.host}`.toLowerCase();
  const matchQ = !searchQuery || text.includes(searchQuery);
  const matchM = activeFilters.size === 0 || activeFilters.has(ep.method);

  // Domain filter check
  let matchD = true;
  if (domainFilter !== 'all' && targetDomain) {
    const isSubdomain = isSubdomainEndpoint(ep.host);
    matchD = (domainFilter === 'subdomain' && isSubdomain) ||
             (domainFilter === 'external' && !isSubdomain);
  }

  // Hide row if it doesn't match current filters
  if (!(matchQ && matchM && matchD)) {
    tr.style.display = 'none';
  }

  // Insert at top for most recent
  tbody.insertBefore(tr, tbody.firstChild);
}

function addLog(icon, message, cls) {
  const log = document.getElementById('activityLog');
  const div = document.createElement('div');
  div.className = `log-entry ${cls}`;
  div.innerHTML = `<span class="icon">${icon}</span><span class="msg">${escHtml(message)}</span>`;
  log.insertBefore(div, log.firstChild);
  // Keep log manageable
  while (log.children.length > 200) log.removeChild(log.lastChild);
}

function updateMethodFilters() {
  const methods = [...new Set(endpoints.map(e => e.method))].sort();
  const container = document.getElementById('methodFilters');
  container.innerHTML = '';
  methods.forEach(m => {
    const btn = document.createElement('span');
    btn.className = 'filter-btn' + (activeFilters.has(m) ? ' active' : '');
    btn.textContent = m;
    btn.onclick = () => {
      activeFilters.has(m) ? activeFilters.delete(m) : activeFilters.add(m);
      applyFilters();
      updateMethodFilters();
    };
    container.appendChild(btn);
  });
}

function isSubdomainEndpoint(host) {
  if (!host || !targetDomain) return false;
  const hostLower = host.toLowerCase();
  const target = targetDomain.toLowerCase();
  // Check if host matches target domain or is a subdomain
  // Must match exactly OR end with ".{domain}"
  const result = hostLower === target || hostLower.endsWith(`.${target}`);
  console.log(`[DEBUG] isSubdomain: ${host} vs ${target} = ${result}`);
  return result;
}

function setDomainFilter(filter) {
  domainFilter = filter;
  // Update button states
  ['All', 'Subdomain', 'External'].forEach(f => {
    const btn = document.getElementById(`domain${f}`);
    if (btn) {
      btn.classList.toggle('active', f.toLowerCase() === filter);
    }
  });
  applyFilters();
}

function applyFilters() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  console.log(`[DEBUG] Applying filters: domainFilter=${domainFilter}, targetDomain=${targetDomain}`);

  document.querySelectorAll('#tbody tr').forEach(tr => {
    const text = `${tr.dataset.method} ${tr.dataset.path} ${tr.dataset.host}`.toLowerCase();
    const matchQ = !q || text.includes(q);
    const matchM = activeFilters.size === 0 || activeFilters.has(tr.dataset.method);

    // Domain filter
    let matchD = true;
    if (domainFilter !== 'all' && targetDomain) {
      const isSubdomain = isSubdomainEndpoint(tr.dataset.host);
      matchD = (domainFilter === 'subdomain' && isSubdomain) ||
               (domainFilter === 'external' && !isSubdomain);
      console.log(`[DEBUG] Host: ${tr.dataset.host}, isSubdomain: ${isSubdomain}, matchD: ${matchD}`);
    }

    tr.style.display = (matchQ && matchM && matchD) ? '' : 'none';
  });
}

function sortBy(col) {
  if (sortCol === col) sortAsc = !sortAsc;
  else { sortCol = col; sortAsc = true; }
  const colIdx = {method:0,path:1,host:2,status:3,reason:4}[col];
  const tbody = document.getElementById('tbody');
  const rows = [...tbody.querySelectorAll('tr')];
  rows.sort((a,b) => {
    const av = a.children[colIdx].textContent.trim();
    const bv = b.children[colIdx].textContent.trim();
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  rows.forEach(r => tbody.appendChild(r));
}

function shortenUrl(u) {
  try { return new URL(u).pathname; } catch { return u; }
}
function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function openDrawer(ep) {
  const drawer = document.getElementById('detailDrawer');
  const content = document.getElementById('drawerContent');

  // Format timestamp
  const timestamp = ep.timestamp ? new Date(ep.timestamp).toLocaleString() : 'N/A';

  // Determine detection method
  const detectionMethod = ep.method.endsWith('*') ? 'Source Code (HTML)' : 'Network Traffic (JavaScript)';

  content.innerHTML = `
    <div class="detail-section">
      <div class="detail-label">HTTP Method</div>
      <div class="detail-value large">
        <span class="badge badge-${ep.method.replace('*','\\\\*')}">${ep.method.replace('*', '')}</span>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-label">Full URL</div>
      <div class="detail-value">${escHtml(ep.full_url)}</div>
    </div>

    <div class="detail-section">
      <div class="detail-label">Host</div>
      <div class="detail-value">${escHtml(ep.host)}</div>
    </div>

    <div class="detail-section">
      <div class="detail-label">Path</div>
      <div class="detail-value">${escHtml(ep.path)}</div>
    </div>

    ${ep.query_params && ep.query_params.length > 0 ? `
    <div class="detail-section">
      <div class="detail-label">Query Parameters</div>
      <div class="detail-value">
        ${ep.query_params.map(p => `<span class="query-param">${escHtml(p)}</span>`).join('')}
      </div>
    </div>
    ` : ''}

    ${ep.response_status ? `
    <div class="detail-section">
      <div class="detail-label">Response Status</div>
      <div class="detail-value large status-${Math.floor(ep.response_status/100)}xx">${ep.response_status}</div>
    </div>
    ` : ''}

    ${ep.content_type ? `
    <div class="detail-section">
      <div class="detail-label">Content-Type</div>
      <div class="detail-value">${escHtml(ep.content_type)}</div>
    </div>
    ` : ''}

    <div class="detail-section">
      <div class="detail-label">Detection Method</div>
      <div class="detail-value">${detectionMethod}</div>
    </div>

    ${ep.source_location ? `
    <div class="detail-section">
      <div class="detail-label">Source Location</div>
      <div class="detail-value">${escHtml(ep.source_location)}</div>
    </div>
    ` : ''}

    ${ep.resource_type ? `
    <div class="detail-section">
      <div class="detail-label">Resource Type</div>
      <div class="detail-value">${escHtml(ep.resource_type)}</div>
    </div>
    ` : ''}

    <div class="detail-section">
      <div class="detail-label">Detection Reason</div>
      <div class="detail-value">${escHtml(ep.detection_reason)}</div>
    </div>

    <div class="detail-section">
      <div class="detail-label">Found On Page</div>
      <div class="detail-value">${escHtml(ep.found_on_page)}</div>
    </div>

    <div class="detail-section">
      <div class="detail-label">Discovered At</div>
      <div class="detail-value">${timestamp}</div>
    </div>
  `;

  drawer.classList.add('open');
}

function closeDrawer() {
  document.getElementById('detailDrawer').classList.remove('open');
}
</script>
</body>
</html>"""


# ─── FastAPI Server ───────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI()
    clients: list[WebSocket] = []

    @app.get("/", response_class=HTMLResponse)
    async def index():
        return DASHBOARD_HTML

    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket):
        await ws.accept()
        clients.append(ws)

        async def broadcast(event: dict):
            dead = []
            for client in clients:
                try:
                    await client.send_json(event)
                except Exception:
                    dead.append(client)
            for d in dead:
                clients.remove(d)

        try:
            # Wait for scan parameters from client
            params_msg = await ws.receive_text()
            params = json.loads(params_msg)

            domain = params.get('domain', '').strip()
            if not domain:
                await ws.send_json({
                    "type": "error",
                    "message": "Domain is required"
                })
                return

            max_pages = params.get('max_pages', 50)
            max_depth = params.get('max_depth', 3)
            timeout = params.get('timeout', 30000)
            include_subdomains = params.get('include_subdomains', True)
            api_filter = params.get('api_filter', 'all')

            # Configure proxy automatically from environment variables
            proxy_config = None
            try:
                proxy_host = os.getenv('PROXY_HOST')
                proxy_port = os.getenv('PROXY_PORT')
                proxy_user = os.getenv('PROXY_USER')
                proxy_pass = os.getenv('PROXY_PASS')

                # Use proxy only if all required env vars are set
                if proxy_host and proxy_port and proxy_user and proxy_pass:
                    proxy_server = f"http://{proxy_host}:{proxy_port}"
                    proxy_config = {
                        "server": proxy_server,
                        "username": proxy_user,
                        "password": proxy_pass
                    }
                    print(f"[INFO] Using proxy: {proxy_host}:{proxy_port}")
                    await ws.send_json({
                        "type": "status",
                        "message": f"Using proxy: {proxy_host}:{proxy_port}"
                    })
                else:
                    print("[INFO] Proxy not configured (env vars not set)")
            except Exception as e:
                print(f"[WARNING] Error configuring proxy: {e}")
                # Continue without proxy

            crawler = APICrawler(
                domain=domain,
                max_pages=max_pages,
                max_depth=max_depth,
                timeout=timeout,
                include_subdomains=include_subdomains,
                api_filter=api_filter,
                proxy_config=proxy_config,
            )
            crawler.on_event(broadcast)
            await crawler.crawl()
        except WebSocketDisconnect:
            pass
        except Exception as e:
            try:
                await ws.send_json({
                    "type": "error",
                    "message": f"Error: {str(e)}"
                })
            except:
                pass
        finally:
            if ws in clients:
                clients.remove(ws)

    return app


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Live Visual API Discovery Crawler")
    parser.add_argument("--port", type=int, default=8187, help="Port to run the dashboard on (default: 8187)")
    args = parser.parse_args()

    app = create_app()

    print(f"\n🚀  API Discovery Scanner")
    print(f"    Dashboard: http://localhost:{args.port}")
    print(f"    Open the URL above in your browser and enter your scan parameters\n")

    webbrowser.open(f"http://localhost:{args.port}")
    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()