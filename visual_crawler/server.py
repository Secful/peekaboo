"""FastAPI server for the Visual API Crawler."""

# Standard library
import asyncio
import itertools
import json
import logging
import os
from typing import Optional

# Set up logger
logger = logging.getLogger(__name__)

# Standard library
import os
from pathlib import Path

# Third-party
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Local imports
from .crawler import APICrawler, ProxyPool
from .bedrock_analyzer import BedrockAPIAnalyzer

# Shared state for tracking active scans across WebSocket clients
_scan_id_counter = itertools.count(1)
_active_scans: dict[int, str] = {}          # scan_id → domain
_connected_clients: dict[int, WebSocket] = {}  # scan_id → ws


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


# Request model for API description generation
class GenerateDescriptionRequest(BaseModel):
    """Request body for generating API description."""
    method: str
    path: str
    host: str
    request_body: Optional[str] = None
    response_body: Optional[str] = None
    response_status: Optional[int] = None
    query_params: Optional[list[str]] = None


def _load_proxy_config() -> Optional[dict]:
    """Load proxy credentials from AWS Secrets Manager.

    Returns Playwright-compatible proxy dict, or None if unavailable.
    """
    try:
        import boto3
        client = boto3.client('secretsmanager', region_name=os.getenv('AWS_DEFAULT_REGION', 'us-east-1'))
        resp = client.get_secret_value(SecretId='peekaboo/proxy')
        secret = json.loads(resp['SecretString'])
        proxy_config = {
            "server": f"http://{secret['host']}:{secret['port']}",
            "username": secret['username'],
            "password": secret['password'],
        }
        print(f"✅ Single proxy loaded from Secrets Manager: {secret['host']}:{secret['port']}", flush=True)
        logger.info(f"Proxy loaded from Secrets Manager: {secret['host']}:{secret['port']}")
        return proxy_config
    except Exception as e:
        print(f"⚠️ No single proxy configured: {e}", flush=True)
        logger.info(f"No proxy configured: {e}")
        return None


def _load_brightdata_proxy_pool() -> Optional[ProxyPool]:
    """Load BrightData proxy pool from AWS Secrets Manager.

    Expected secret format for proxy pool:
    {
        "host": "brd.superproxy.io",
        "port": "22225",
        "username": "brd-customer-{id}-zone-{zone}",
        "password": "{password}",
        "pool_size": 5  # Optional, number of proxy sessions to create
    }

    Or for multiple proxies:
    {
        "proxies": [
            {"host": "...", "port": "...", "username": "...", "password": "..."},
            {"host": "...", "port": "...", "username": "...", "password": "..."}
        ]
    }

    Returns ProxyPool or None if unavailable.
    """
    try:
        import boto3
        client = boto3.client('secretsmanager', region_name=os.getenv('AWS_DEFAULT_REGION', 'us-east-1'))
        resp = client.get_secret_value(SecretId='peekaboo/proxy')
        secret = json.loads(resp['SecretString'])

        proxies = []

        # Check if it's a multi-proxy configuration
        if 'proxies' in secret:
            for proxy_config in secret['proxies']:
                proxies.append({
                    "server": f"http://{proxy_config['host']}:{proxy_config['port']}",
                    "username": proxy_config['username'],
                    "password": proxy_config['password'],
                })
        else:
            # Single proxy with session pool
            pool_size = secret.get('pool_size', 5)
            base_username = secret['username']

            # Extract zone type from username for debugging
            zone_info = "unknown"
            if '-zone-' in base_username:
                zone_part = base_username.split('-zone-')[1].split('-')[0]
                zone_info = zone_part
            print(f"🔍 Proxy zone: {zone_info}", flush=True)

            # BrightData: Add session ID to username for sticky sessions
            # Format: brd-customer-{id}-zone-{zone}-session-{random}
            for i in range(pool_size):
                # Generate unique session IDs
                import random
                session_id = random.randint(100000, 999999)
                username_with_session = f"{base_username}-session-{session_id}"

                proxies.append({
                    "server": f"http://{secret['host']}:{secret['port']}",
                    "username": username_with_session,
                    "password": secret['password'],
                })

        if proxies:
            print(f"✅ Loaded BrightData proxy pool with {len(proxies)} proxies", flush=True)
            logger.info(f"Loaded BrightData proxy pool with {len(proxies)} proxies")
            return ProxyPool(proxies)
        else:
            print("⚠️ No proxies found in configuration", flush=True)
            return None

    except Exception as e:
        print(f"⚠️ No BrightData proxy pool configured: {e}", flush=True)
        logger.info(f"No BrightData proxy pool configured: {e}")
        return None


def _load_scraping_browser_url() -> Optional[str]:
    """Construct BrightData Scraping Browser URL from existing proxy credentials.

    Checks the peekaboo/proxy secret for enable_scraping_browser flag.
    If enabled, extracts customer ID and password to construct WebSocket URL.

    Returns:
        WebSocket URL for Chrome DevTools Protocol connection, or None if disabled
    """
    try:
        import boto3
        client = boto3.client('secretsmanager', region_name=os.getenv('AWS_DEFAULT_REGION', 'us-east-1'))
        resp = client.get_secret_value(SecretId='peekaboo/proxy')
        secret = json.loads(resp['SecretString'])

        # Check if Scraping Browser is enabled
        if not secret.get('enable_scraping_browser', False):
            logger.info("Scraping Browser not enabled in secret config")
            return None

        # Extract customer ID from username
        # Format: brd-customer-{id}-zone-{zone}
        username = secret['username']
        if 'brd-customer-' not in username:
            logger.warning("Invalid BrightData username format")
            return None

        customer_id = username.split('brd-customer-')[1].split('-zone-')[0]
        password = secret['password']
        zone = secret.get('scraping_browser_zone', 'scraping_browser1')

        # Construct WebSocket URL for Chrome DevTools Protocol
        url = f"wss://brd-customer-{customer_id}-zone-{zone}:{password}@brd.superproxy.io:9222"

        print(f"🌐 BrightData Scraping Browser enabled (zone: {zone})", flush=True)
        logger.info(f"BrightData Scraping Browser enabled with zone: {zone}")
        return url

    except Exception as e:
        logger.warning(f"Could not load scraping browser config: {e}")
        return None


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI()

    auth_user = os.getenv('BASIC_AUTH_USER')
    auth_pass = os.getenv('BASIC_AUTH_PASS')
    if auth_user and auth_pass:
        from .auth import BasicAuthMiddleware
        app.add_middleware(BasicAuthMiddleware, username=auth_user, password=auth_pass)

    # Load proxy config from Secrets Manager (if available)
    app.state.proxy_config = _load_proxy_config()
    app.state.proxy_pool = _load_brightdata_proxy_pool()
    app.state.scraping_browser_url = _load_scraping_browser_url()

    # Get the path to the static directory
    static_dir = Path(__file__).parent / "static"

    # Mount static files
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/", response_class=HTMLResponse)
    async def index():
        """Serve the dashboard HTML."""
        index_file = static_dir / "index.html"
        return FileResponse(index_file)

    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy"}

    @app.get("/api/version")
    async def get_version():
        """Get version and deployment information."""
        from .version import __version__
        return {
            "version": __version__,
            "deploy_time": os.getenv("DEPLOY_TIME", "Unknown"),
            "deploy_date": os.getenv("DEPLOY_DATE", "Unknown")
        }

    @app.post("/api/generate-description")
    async def generate_description(request: GenerateDescriptionRequest):
        """
        Generate API description using AWS Bedrock with Claude.

        Args:
            request: Endpoint information including method, path, payloads

        Returns:
            JSON with AI-generated API description
        """
        try:
            # Initialize Bedrock analyzer
            analyzer = BedrockAPIAnalyzer()

            # Generate description
            result = await analyzer.generate_api_description(
                method=request.method,
                path=request.path,
                host=request.host,
                request_body=request.request_body,
                response_body=request.response_body,
                response_status=request.response_status,
                query_params=request.query_params or [],
            )

            return JSONResponse(content=result)

        except Exception as e:
            logger.error(f"Failed to generate API description: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to generate description: {str(e)}"
            )

    @app.websocket("/ws")
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

                # Register this scan as active and notify all clients
                _active_scans[scan_id] = domain
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

                async def _listen_for_stop():
                    """Listen for client messages while crawl runs."""
                    try:
                        while True:
                            msg = await ws.receive_text()
                            data = json.loads(msg)
                            if data.get('action') == 'stop':
                                crawler.stop()
                                return
                    except WebSocketDisconnect:
                        crawler.stop()
                        raise

                crawl_task = asyncio.create_task(crawler.crawl())
                listen_task = asyncio.create_task(_listen_for_stop())
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
                    # Scan finished — remove from active, but keep client connected
                    _active_scans.pop(scan_id, None)
                    await _broadcast_active_scans()

        except WebSocketDisconnect:
            pass
        finally:
            _active_scans.pop(scan_id, None)
            _connected_clients.pop(scan_id, None)
            await _broadcast_active_scans()

    return app
