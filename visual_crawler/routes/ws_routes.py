"""WebSocket route for real-time crawler communication."""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from dataclasses import asdict
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..crawler import APICrawler
from ..email_notifier import send_scan_start_email
from ..scan_logger import save_scan

logger = logging.getLogger(__name__)


def _publish_git_search_job(domain: str, scan_id: str) -> None:
    """Publish a git-search job to SQS. Runs in a thread via asyncio.to_thread."""
    queue_name = "peekaboo-git-search-queue"
    try:
        import boto3
        sqs = boto3.client("sqs", region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"))
        queue_url = sqs.get_queue_url(QueueName=queue_name)["QueueUrl"]
        body = json.dumps({"domain": domain, "scan_id": scan_id})
        sqs.send_message(QueueUrl=queue_url, MessageBody=body)
        logger.info(f"SQS: sent git-search job to {queue_name}: {body}")
    except Exception as e:
        logger.warning(f"SQS: failed to publish git-search job to {queue_name}: {e}")

# Subdomain discovery Lambda URL (configurable via env var)
SUBDOMAIN_LAMBDA_URL = os.getenv(
    'SUBDOMAIN_LAMBDA_URL',
    'https://24g3gth3qwhguxrhkuomm3l67i0gdhyy.lambda-url.us-east-1.on.aws/'
)

router = APIRouter()

# Shared state for tracking active scans across WebSocket clients
_active_scans: dict[str, str] = {}          # scan_id -> domain
_connected_clients: dict[str, WebSocket] = {}  # scan_id -> ws
_subdomains_ready: dict[str, bool] = {}     # scan_id -> True once subdomains sent
_client_domains: dict[str, str] = {}        # scan_id -> domain (persists until WS disconnect)

# Composite end-of-scan tracking
_scan_activities: dict[str, dict[str, bool]] = {}   # scan_id -> {"crawl": bool, "subdomains": bool, "mobile"?: bool}
_crawl_results: dict[str, dict] = {}                 # scan_id -> crawl_complete payload
_mobile_expected: dict[str, set[str]] = {}            # scan_id -> set of expected package_names
_mobile_received: dict[str, set[str]] = {}            # scan_id -> set of received package_names
_scan_context: dict[str, dict] = {}                   # scan_id -> context needed for save (crawler, params, etc.)


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


async def _fetch_subdomains(domain: str, send_event, scan_id: str = "") -> None:
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


async def _save_final_scan(scan_id: str) -> None:
    """Persist the full scan to DynamoDB using stored context."""
    ctx = _scan_context.get(scan_id)
    if not ctx:
        logger.warning("No scan context for %s — cannot save", scan_id)
        return
    try:
        crawler = ctx["crawler"]
        scan_started_at = ctx["scan_started_at"]
        domain = ctx["domain"]
        params = ctx["params"]
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
            "params": params,
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
        from ..scanner_store import scanner_store as _ss
        scan_data["scanner"] = {
            "security_insights": _ss.get_security_insights(domain),
            "open_ports": _ss.get_open_ports(domain),
            "extracted_apis": _ss.get_extracted_apis(domain),
            "agentic": _ss.get_agentic(domain),
            "js_resources": _ss.get_js_resources(domain),
            "api_specs": _ss.get_api_specs(domain),
            "mobile_endpoints": _ss.get_mobile_endpoints(domain),
            "git_findings": _ss.get_git_findings(domain),
        }
        scan_data["subdomain_results"] = getattr(crawler, 'subdomain_results', {})
        asyncio.create_task(
            asyncio.to_thread(save_scan, scan_data)
        )
    except Exception as log_exc:
        logger.warning("Failed to save final scan for %s: %s", scan_id, log_exc)


async def _check_scan_complete(scan_id: str, send_fn) -> None:
    """Fire composite 'done' event when all activities for a scan are complete."""
    activities = _scan_activities.get(scan_id)
    if not activities or not all(activities.values()):
        return
    # All done — emit composite "done" with the crawl payload
    crawl_data = _crawl_results.pop(scan_id, {})
    await send_fn({"type": "done", **crawl_data})
    # Cleanup tracking state (but keep _scan_context alive for deferred save)
    _scan_activities.pop(scan_id, None)
    _mobile_expected.pop(scan_id, None)
    _mobile_received.pop(scan_id, None)
    _crawl_results.pop(scan_id, None)
    _active_scans.pop(scan_id, None)
    await _broadcast_active_scans()


async def _fetch_subdomains_tracked(domain: str, send_event, scan_id: str) -> None:
    """Wrapper around _fetch_subdomains that marks subdomains complete."""
    try:
        await _fetch_subdomains(domain, send_event, scan_id)
    finally:
        activities = _scan_activities.get(scan_id)
        if activities is not None:
            activities["subdomains"] = True
            await send_event({"type": "activity_complete", "activity": "subdomains"})
            await _check_scan_complete(scan_id, send_event)


async def _mobile_watchdog(scan_id: str, send_fn, timeout_secs: int = 900) -> None:
    """Force-complete mobile activity after a timeout."""
    await asyncio.sleep(timeout_secs)
    activities = _scan_activities.get(scan_id)
    if activities and activities.get("mobile") is False:
        logger.warning("Mobile watchdog fired for %s after %ds", scan_id, timeout_secs)
        activities["mobile"] = True
        await send_fn({"type": "activity_complete", "activity": "mobile", "timed_out": True})
        await _check_scan_complete(scan_id, send_fn)


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """WebSocket endpoint for real-time crawler communication.

    The connection stays open after a scan completes so the client
    continues to receive active-scan broadcasts from other users.
    A new scan can be started on the same connection.
    """
    await ws.accept()
    scan_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}"
    _connected_clients[scan_id] = ws

    # Let this client know about currently active scans
    await _broadcast_active_scans()

    async def send_event(event: dict):
        """Send event only to this connection's client."""
        try:
            await ws.send_json(event)
        except Exception:
            pass

    crawler = None  # last crawler instance — needed for post-crawl publish_apk

    try:
        # Loop: wait for scan params, run scan, wait again
        while True:
            try:
                params_msg = await ws.receive_text()
            except RuntimeError:
                # WebSocket already disconnected
                break
            params = json.loads(params_msg)

            # Keep-alive heartbeat — just ignore
            if params.get('action') == 'heartbeat':
                continue

            # Handle retry_subdomains outside of an active crawl
            if params.get('action') == 'retry_subdomains':
                retry_domain = params.get('domain', '').strip()
                if retry_domain:
                    asyncio.create_task(
                        _fetch_subdomains(retry_domain, send_event, scan_id)
                    )
                continue

            # Persist scan to history (triggered by frontend after inactivity timeout or stop)
            # Keep _scan_context alive so the finally block can re-save with late data (e.g. mobile endpoints)
            if params.get('action') == 'save_scan':
                await _save_final_scan(scan_id)
                continue

            # Handle publish_apk after crawl has finished (listener already canceled)
            if params.get('action') == 'publish_apk':
                selected = params.get('apps', [])
                if selected and crawler is not None:
                    activities = _scan_activities.get(scan_id)
                    if activities is not None:
                        activities["mobile"] = False
                    _mobile_expected[scan_id] = {
                        app["package_name"] for app in selected
                    }
                    _mobile_received[scan_id] = set()
                    asyncio.create_task(
                        crawler._publish_apk_jobs(selected)
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
            _scan_activities[scan_id] = {"crawl": False, "subdomains": False}
            _crawl_results.pop(scan_id, None)
            _mobile_expected.pop(scan_id, None)
            _mobile_received.pop(scan_id, None)
            await _broadcast_active_scans()

            # Resolve client IP (X-Forwarded-For behind ALB, fallback to ws.client)
            _xff = dict(ws.headers).get("x-forwarded-for", "")
            _client_ip = _xff.split(",")[0].strip() if _xff else (ws.client.host if ws.client else "unknown")

            # Fire-and-forget scan-start email notification
            asyncio.create_task(asyncio.to_thread(
                send_scan_start_email, domain, scan_id, scan_started_at,
                {"max_pages": max_pages, "max_depth": max_depth,
                 "fast_mode": fast_mode, "use_proxy": use_proxy},
                _client_ip,
            ))

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
            # Store context for _save_final_scan
            _scan_context[scan_id] = {
                "crawler": crawler,
                "scan_started_at": scan_started_at,
                "domain": domain,
                "params": {
                    "max_pages": max_pages,
                    "max_depth": max_depth,
                    "fast_mode": fast_mode,
                    "include_subdomains": include_subdomains,
                    "api_filter": api_filter,
                    "use_proxy": use_proxy,
                },
            }

            # Fire-and-forget git-search SQS job
            asyncio.create_task(asyncio.to_thread(
                _publish_git_search_job, domain, scan_id
            ))

            # Wrap send_event to intercept crawl_complete / apk_publish_failed
            async def _raw_send(event: dict):
                """Bypass interception — used for the final composite done."""
                try:
                    await ws.send_json(event)
                except Exception:
                    pass

            async def send_scan_event(event: dict):
                """Intercept lifecycle events; forward everything else."""
                etype = event.get("type")
                if etype == "crawl_complete":
                    # Store payload, mark crawl done, notify frontend
                    _crawl_results[scan_id] = {
                        k: v for k, v in event.items() if k != "type"
                    }
                    activities = _scan_activities.get(scan_id)
                    if activities is not None:
                        activities["crawl"] = True
                    await _raw_send({"type": "activity_complete", "activity": "crawl", **{k: v for k, v in event.items() if k != "type"}})
                    await _check_scan_complete(scan_id, _raw_send)
                elif etype == "apk_publish_failed":
                    # Mobile won't deliver — remove from tracking
                    await _raw_send(event)
                    activities = _scan_activities.get(scan_id)
                    if activities and "mobile" in activities:
                        del activities["mobile"]
                        await _check_scan_complete(scan_id, _raw_send)
                else:
                    await _raw_send(event)

            crawler.on_event(send_scan_event)

            async def _listen_for_client():
                """Listen for client messages while crawl runs."""
                try:
                    while True:
                        msg = await ws.receive_text()
                        data = json.loads(msg)
                        if data.get('action') == 'heartbeat':
                            continue
                        elif data.get('action') == 'stop':
                            crawler.stop()
                            return
                        elif data.get('action') == 'retry_subdomains':
                            asyncio.create_task(
                                _fetch_subdomains(domain, send_event, scan_id)
                            )
                        elif data.get('action') == 'save_scan':
                            await _save_final_scan(scan_id)
                        elif data.get('action') == 'publish_apk':
                            selected = data.get('apps', [])
                            if selected:
                                # Register mobile activity tracking
                                activities = _scan_activities.get(scan_id)
                                if activities is not None:
                                    activities["mobile"] = False
                                _mobile_expected[scan_id] = {
                                    app["package_name"] for app in selected
                                }
                                _mobile_received[scan_id] = set()
                                asyncio.create_task(
                                    crawler._publish_apk_jobs(selected)
                                )
                except WebSocketDisconnect:
                    crawler.stop()
                    raise

            crawl_task = asyncio.create_task(crawler.crawl())
            listen_task = asyncio.create_task(_listen_for_client())
            subdomain_task = asyncio.create_task(
                _fetch_subdomains_tracked(domain, send_scan_event, scan_id)
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

                # Safety: if crawl errored out before emitting crawl_complete,
                # mark crawl as done so _check_scan_complete can still fire.
                activities = _scan_activities.get(scan_id)
                if activities and not activities.get("crawl"):
                    activities["crawl"] = True
                    _crawl_results.setdefault(scan_id, {
                        "total_endpoints": len(crawler.endpoints),
                        "pages_visited": len(crawler.visited_pages),
                        "pages_skipped": len(crawler.queue),
                    })
                    await _raw_send({"type": "activity_complete", "activity": "crawl"})
                    await _check_scan_complete(scan_id, _raw_send)

                # Let subdomain discovery finish even after crawl ends
                if not subdomain_task.done():
                    try:
                        await subdomain_task
                    except Exception:
                        pass

                # If mobile is still pending, start watchdog
                activities = _scan_activities.get(scan_id)
                if activities and activities.get("mobile") is False:
                    asyncio.create_task(
                        _mobile_watchdog(scan_id, _raw_send, 900)
                    )

    except WebSocketDisconnect:
        pass
    finally:
        # Persist scan on disconnect if not already saved
        if scan_id in _scan_context:
            await _save_final_scan(scan_id)
        _active_scans.pop(scan_id, None)
        _connected_clients.pop(scan_id, None)
        _subdomains_ready.pop(scan_id, None)
        _client_domains.pop(scan_id, None)
        _scan_activities.pop(scan_id, None)
        _crawl_results.pop(scan_id, None)
        _mobile_expected.pop(scan_id, None)
        _mobile_received.pop(scan_id, None)
        _scan_context.pop(scan_id, None)
        await _broadcast_active_scans()
