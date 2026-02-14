"""
Live Visual REST API Discovery Crawler

A tool for discovering REST API endpoints by crawling web applications
and monitoring network traffic.
"""

__version__ = "0.1.0"

# Expose public API
from .models import DiscoveredEndpoint
from .crawler import APICrawler
from .server import create_app
from .cli import main

__all__ = [
    "DiscoveredEndpoint",
    "APICrawler",
    "create_app",
    "main",
]
