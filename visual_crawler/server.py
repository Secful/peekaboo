"""FastAPI server for the Visual API Crawler."""

import os
import asyncio
import logging
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .proxy_config import (
    _load_proxy_config,
    _load_brightdata_proxy_pool,
    _load_scraping_browser_url,
)
from .scanner_store import scanner_store
from .routes.static_routes import router as static_router
from .routes.api_routes import router as api_router
from .routes.ws_routes import router as ws_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Periodic cleanup of expired scanner store entries."""
    async def _cleanup_loop():
        while True:
            await asyncio.sleep(3600)
            scanner_store.cleanup_expired()

    task = asyncio.create_task(_cleanup_loop())
    yield
    task.cancel()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(name)s - %(message)s")

    app = FastAPI(lifespan=_lifespan)

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

    # Include routers
    app.include_router(static_router)
    app.include_router(api_router)
    app.include_router(ws_router)

    return app
