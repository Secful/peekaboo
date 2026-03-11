"""WebSocket route for real-time crawler communication."""

import asyncio
import itertools
import json
import logging
import os
from datetime import datetime, timezone

import httpx
from dataclasses import asdict
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..crawler import APICrawler
from ..scan_logger import save_scan

logger = logging.getLogger(__name__)

# Subdomain discovery Lambda URL (configurable via env var)
SUBDOMAIN_LAMBDA_URL = os.getenv(
    'SUBDOMAIN_LAMBDA_URL',
    'https://24g3gth3qwhguxrhkuomm3l67i0gdhyy.lambda-url.us-east-1.on.aws/'
)

router = APIRouter()

# Shared state for tracking active scans across WebSocket clients
_scan_id_counter = itertools.count(1)
_active_scans: dict[int, str] = {}          # scan_id -> domain
_connected_clients: dict[int, WebSocket] = {}  # scan_id -> ws
_subdomains_ready: dict[int, bool] = {}     # scan_id -> True once subdomains sent
_client_domains: dict[int, str] = {}        # scan_id -> domain (persists until WS disconnect)


async def _broadcast_active_scans() -> None:
    """Send the current active-scans list to every connected client."""
    scans = [{"scan_id": sid, "domain": dom} for sid, dom in _active_scans.items()]
    for sid, client_ws in list(_connected_clients.items()):
        try:
            await client_ws.send_json({
                "type": "active_scans",
                "scans": scans,
                "your_scan_id": sid,
            })
        except Exception:
            pass


async def _fetch_subdomains(domain: str, send_event, scan_id: int = 0) -> None:
    """Call the subdomain-discovery Lambda and push results via WebSocket."""
    await send_event({"type": "subdomains_loading"})
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await asyncio.wait_for(
                client.get(SUBDOMAIN_LAMBDA_URL, params={"domain": domain}),
                timeout=180,
            )
            resp.raise_for_status()
            await send_event({"type": "subdomains", "data": resp.json()})
            # Mark subdomains as rendered and push any stored scanner results
            if scan_id:
                _subdomains_ready[scan_id] = True
                domain_for_store = _client_domains.get(scan_id)
                if domain_for_store:
                    from ..scanner_store import scanner_store
                    stored = scanner_store.get_all_for_domain(domain_for_store)
                    logger.warning(f"Flushing {len(stored)} stored scanner results for {domain_for_store}")
                    for payload in stored:
                        try:
                            await send_event(payload)
                        except Exception:
                            pass
    except asyncio.TimeoutError:
        logger.warning(f"Subdomain discovery timed out for {domain}")
        await send_event({
            "type": "subdomains_error",
            "message": "Subdomain discovery timed out (3 min). Click Retry to try again.",
        })
    except Exception as exc:
        logger.warning(f"Subdomain discovery failed for {domain}: {exc}")
        await send_event({
            "type": "subdomains_error",
            "message": f"Subdomain discovery failed: {exc}",
        })


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """WebSocket endpoint for real-time crawler communication.

    The connection stays open after a scan completes so the client
    continues to receive active-scan broadcasts from other users.
    A new scan can be started on the same connection.
    """
    await ws.accept()
    scan_id = next(_scan_id_counter)
    _connected_clients[scan_id] = ws

    # Let this client know about currently active scans
    await _broadcast_active_scans()

    async def send_event(event: dict):
        """Send event only to this connection's client."""
        try:
            await ws.send_json(event)
        except Exception:
            pass

    try:
        # Loop: wait for scan params, run scan, wait again
        while True:
            try:
                params_msg = await ws.receive_text()
            except RuntimeError:
                # WebSocket already disconnected
                break
            params = json.loads(params_msg)

            # Handle retry_subdomains outside of an active crawl
            if params.get('action') == 'retry_subdomains':
                retry_domain = params.get('domain', '').strip()
                if retry_domain:
                    asyncio.create_task(
                        _fetch_subdomains(retry_domain, send_event, scan_id)
                    )
                continue

            domain = params.get('domain', '').strip()
            if not domain:
                await ws.send_json({
                    "type": "error",
                    "message": "Domain is required"
                })
                continue

            max_pages = params.get('max_pages', 50)
            max_depth = params.get('max_depth', 3)
            timeout = params.get('timeout', 30000)
            include_subdomains = params.get('include_subdomains', True)
            api_filter = params.get('api_filter', 'all')
            concurrent_pages = params.get('concurrent_pages', 5)
            fast_mode = params.get('fast_mode', False)
            use_proxy = params.get('use_proxy', True)

            # Stealth mode parameters
            stealth_mode = params.get('stealth_mode', True)
            min_delay = params.get('min_delay', 2.0)
            max_delay = params.get('max_delay', 5.0)
            max_retries = params.get('max_retries', 3)
            rotate_identity = params.get('rotate_identity', True)

            # Determine proxy configuration
            proxy_config = None
            proxy_pool = None

            # Access app state via ws.app
            app = ws.app

            if use_proxy:
                if app.state.proxy_pool:
                    # Use proxy pool for rotation
                    proxy_pool = app.state.proxy_pool
                    # Get first proxy for initial connection
                    proxy_config = proxy_pool.get_next_proxy()
                    await ws.send_json({
                        "type": "status",
                        "message": f"Using proxy pool with {len(proxy_pool.proxies)} proxies"
                    })
                elif app.state.proxy_config:
                    # Use single proxy
                    proxy_config = app.state.proxy_config
                    await ws.send_json({
                        "type": "status",
                        "message": f"Using proxy: {proxy_config['server']}"
                    })

            # Record scan start time for logging
            scan_started_at = datetime.now(timezone.utc)

            # Register this scan as active and notify all clients
            _subdomains_ready[scan_id] = False
            _active_scans[scan_id] = domain
            _client_domains[scan_id] = domain
            await _broadcast_active_scans()

            try:
                crawler = APICrawler(
                    domain=domain,
                    max_pages=max_pages,
                    max_depth=max_depth,
                    timeout=timeout,
                    include_subdomains=include_subdomains,
                    api_filter=api_filter,
                    proxy_config=proxy_config,
                    concurrent_pages=concurrent_pages,
                    fast_mode=fast_mode,
                    scan_id=scan_id,
                    stealth_mode=stealth_mode,
                    min_delay=min_delay,
                    max_delay=max_delay,
                    proxy_pool=proxy_pool,
                    max_retries=max_retries,
                    rotate_identity=rotate_identity,
                    scraping_browser_url=app.state.scraping_browser_url,
                )
            except Exception as e:
                await ws.send_json({
                    "type": "error",
                    "message": f"Failed to create crawler: {str(e)}"
                })
                continue
            crawler.on_event(send_event)

            async def _listen_for_client():
                """Listen for client messages while crawl runs."""
                try:
                    while True:
                        msg = await ws.receive_text()
                        data = json.loads(msg)
                        if data.get('action') == 'stop':
                            crawler.stop()
                            return
                        elif data.get('action') == 'retry_subdomains':
                            asyncio.create_task(
                                _fetch_subdomains(domain, send_event, scan_id)
                            )
                except WebSocketDisconnect:
                    crawler.stop()
                    raise

            crawl_task = asyncio.create_task(crawler.crawl())
            listen_task = asyncio.create_task(_listen_for_client())
            subdomain_task = asyncio.create_task(
                _fetch_subdomains(domain, send_event, scan_id)
            )
            try:
                # Wait for crawl to finish; listener runs alongside
                await crawl_task
            except Exception as e:
                try:
                    await ws.send_json({
                        "type": "error",
                        "message": f"Error: {str(e)}"
                    })
                except:
                    pass
            finally:
                listen_task.cancel()
                try:
                    await listen_task
                except (asyncio.CancelledError, WebSocketDisconnect):
                    pass
                # Let subdomain discovery finish even after crawl ends
                if not subdomain_task.done():
                    try:
                        await subdomain_task
                    except Exception:
                        pass
                # Save scan results to S3 (fire-and-forget)
                try:
                    finished_at = datetime.now(timezone.utc)
                    duration = (finished_at - scan_started_at).total_seconds()
                    endpoints_for_log = []
                    for ep in crawler.endpoints:
                        ep_dict = asdict(ep)
                        ep_dict.pop("request_body", None)
                        ep_dict.pop("response_body", None)
                        endpoints_for_log.append(ep_dict)
                    scan_data = {
                        "scan_id": scan_id,
                        "domain": domain,
                        "started_at": scan_started_at.isoformat(),
                        "finished_at": finished_at.isoformat(),
                        "duration_seconds": round(duration),
                        "params": {
                            "max_pages": max_pages,
                            "max_depth": max_depth,
                            "fast_mode": fast_mode,
                            "include_subdomains": include_subdomains,
                            "api_filter": api_filter,
                            "use_proxy": use_proxy,
                        },
                        "results": {
                            "total_endpoints": len(crawler.endpoints),
                            "confirmed_apis": sum(
                                1 for ep in crawler.endpoints
                                if ep.api_confidence == "API"
                            ),
                            "pages_visited": len(crawler.visited_pages),
                            "pages_skipped": len(crawler.queue),
                        },
                        "endpoints": endpoints_for_log,
                    }
                    asyncio.create_task(
                        asyncio.to_thread(save_scan, scan_data)
                    )
                except Exception as log_exc:
                    logger.warning("Failed to prepare scan log: %s", log_exc)

                # Scan finished — remove from active, but keep client connected
                _active_scans.pop(scan_id, None)
                await _broadcast_active_scans()

    except WebSocketDisconnect:
        pass
    finally:
        _active_scans.pop(scan_id, None)
        _connected_clients.pop(scan_id, None)
        _subdomains_ready.pop(scan_id, None)
        _client_domains.pop(scan_id, None)
        await _broadcast_active_scans()
