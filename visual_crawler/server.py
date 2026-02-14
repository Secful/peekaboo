"""FastAPI server for the Visual API Crawler."""

# Standard library
import json
import os
from typing import Optional

# Third-party
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

# Local imports
from .crawler import APICrawler
from .dashboard import DASHBOARD_HTML
from .bedrock_analyzer import BedrockAPIAnalyzer


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


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI()
    clients: list[WebSocket] = []

    @app.get("/", response_class=HTMLResponse)
    async def index():
        """Serve the dashboard HTML."""
        return DASHBOARD_HTML

    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy"}

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
            print(f"[ERROR] Failed to generate API description: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to generate description: {str(e)}"
            )

    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket):
        """WebSocket endpoint for real-time crawler communication."""
        await ws.accept()
        clients.append(ws)

        async def broadcast(event: dict):
            """Broadcast event to all connected clients."""
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
            concurrent_pages = params.get('concurrent_pages', 5)
            fast_mode = params.get('fast_mode', False)

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
                concurrent_pages=concurrent_pages,
                fast_mode=fast_mode,
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
