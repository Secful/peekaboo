"""
Live Visual REST API Discovery Crawler - DEPRECATED
====================================================

⚠️  DEPRECATION NOTICE:
    This file is deprecated and maintained only for backward compatibility.
    Please use the new entry points instead:

    NEW USAGE:
        python main.py
        # or
        python -m visual_crawler

    This wrapper will be removed in a future version.

Architecture:
  FastAPI server  ←WebSocket→  Browser Dashboard
       ↕
  Playwright crawler (runs in background)

Usage:
    pip install playwright fastapi uvicorn websockets jinja2
    playwright install chromium
    python main_flow.py --domain example.com
"""

import warnings

# Show deprecation warning
warnings.warn(
    "\n"
    "=" * 70 + "\n"
    "DEPRECATION WARNING: main_flow.py is deprecated!\n"
    "=" * 70 + "\n"
    "Please use the new entry points:\n"
    "  • python main.py\n"
    "  • python -m visual_crawler\n"
    "\n"
    "This file will be removed in a future version.\n"
    "=" * 70,
    DeprecationWarning,
    stacklevel=2
)

# Import everything from the refactored package
from visual_crawler.cli import main

if __name__ == "__main__":
    # Pass through to the new CLI
    main()
