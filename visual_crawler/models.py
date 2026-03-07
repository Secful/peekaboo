"""Data models for the Visual API Crawler."""

from dataclasses import dataclass
from typing import Optional

from pydantic import BaseModel


@dataclass
class DiscoveredEndpoint:
    """Represents a discovered API endpoint."""
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
    api_confidence: Optional[str] = None  # "API", "Maybe API", or None

    # Request/Response capture for LLM analysis
    request_body: Optional[str] = None  # Request payload (for POST/PUT/PATCH)
    response_body: Optional[str] = None  # Response payload (truncated to 100KB)
    request_headers: Optional[dict] = None  # Request headers
    response_headers: Optional[dict] = None  # Response headers

    # LLM-generated description
    llm_description: Optional[str] = None  # Auto-generated API description


# Pydantic request models for API routes

class GenerateDescriptionRequest(BaseModel):
    """Request body for generating API description."""
    method: str
    path: str
    host: str
    request_body: Optional[str] = None
    response_body: Optional[str] = None
    response_status: Optional[int] = None
    query_params: Optional[list[str]] = None


class AnalyzeJsRequest(BaseModel):
    """Request body for JS source analysis."""
    urls: list[str]


class GeolocateIpsRequest(BaseModel):
    """Request body for IP geolocation."""
    ips: list[str]
