"""Static routes: index page, health check, version."""

import os
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, FileResponse

router = APIRouter()

# Get the path to the static directory
_static_dir = Path(__file__).parent.parent / "static"


@router.get("/", response_class=HTMLResponse)
async def index():
    """Serve the dashboard HTML."""
    index_file = _static_dir / "index.html"
    return FileResponse(index_file)


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@router.get("/api/version")
async def get_version():
    """Get version and deployment information."""
    from ..version import __version__
    return {
        "version": __version__,
        "deploy_time": os.getenv("DEPLOY_TIME", "Unknown"),
        "deploy_date": os.getenv("DEPLOY_DATE", "Unknown")
    }
