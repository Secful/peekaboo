"""
Dashboard UI for the Visual API Crawler

The dashboard UI has been extracted to separate static files for better
maintainability:

- visual_crawler/static/index.html - HTML structure
- visual_crawler/static/css/styles.css - Styles
- visual_crawler/static/js/app.js - JavaScript application logic

These files are served by FastAPI's StaticFiles middleware in server.py.

MIGRATION NOTE:
If you were importing DASHBOARD_HTML from this module, please update your code
to serve the static files instead:

    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse
    from pathlib import Path

    static_dir = Path(__file__).parent / "static"
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/")
    async def index():
        return FileResponse(static_dir / "index.html")
"""

# For backward compatibility, define DASHBOARD_HTML as None
# This will cause an error if anyone tries to use it, with a clear message
DASHBOARD_HTML = None

# TODO: Remove this module entirely in next major version
