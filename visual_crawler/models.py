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


class JsResourcesRequest(BaseModel):
    """Request body for JS resources discovered by an external scanner."""
    domain: str
    subdomain: str
    url: str
    scan_duration_secs: float = 0.0
    urls_count: int = 0
    urls: list[str] = []


class OpenPortsRequest(BaseModel):
    """Request body for open ports discovered by an external scanner."""
    domain: str
    subdomain: str
    ip: str = ""
    scan_duration_secs: float = 0.0
    open_ports_count: int = 0
    open_ports: list[dict] = []


class SecurityFinding(BaseModel):
    """A single security finding from an external scanner."""
    template_id: str
    name: str
    severity: str
    type: str
    matched_at: str
    description: str = ""
    tags: list[str] = []


class SecurityInsightsRequest(BaseModel):
    """Request body for security insights from an external scanner."""
    domain: str
    subdomain: str
    url: str
    scan_duration_secs: float = 0.0
    findings_count: int = 0
    findings: list[SecurityFinding] = []


class MCPServerInfo(BaseModel):
    """MCP server identity returned by initialize."""
    name: str
    version: str = ""


class MCPTool(BaseModel):
    """A single tool advertised by an MCP server."""
    name: str
    description: str = ""
    input_schema: dict = {}


class MCPResource(BaseModel):
    """A single resource advertised by an MCP server."""
    uri: str
    name: str
    description: str = ""
    mime_type: str = ""


class MCPPrompt(BaseModel):
    """A single prompt advertised by an MCP server."""
    name: str
    description: str = ""
    arguments: list[dict] = []


class MCPRegistryInfo(BaseModel):
    """Match from the official MCP registry (registry.modelcontextprotocol.io)."""
    found: bool = True
    server_name: str = ""
    description: str = ""
    version: str = ""
    remote_url: str = ""
    remote_type: str = ""
    website_url: str = ""
    repo_url: str = ""


class MCPResult(BaseModel):
    """Full result of an MCP handshake performed by the external scanner."""
    transport: str  # "streamable_http" | "sse" | "unknown"
    confidence: int  # 0-120
    evidence: list[str] = []
    server_info: Optional[MCPServerInfo] = None
    protocol_version: str = ""
    capabilities: dict = {}
    tools: list[MCPTool] = []
    resources: list[MCPResource] = []
    prompts: list[MCPPrompt] = []
    registry: Optional[MCPRegistryInfo] = None
    errors: list[str] = []


class AgenticFinding(BaseModel):
    """A single agentic/AI discovery finding from an external scanner."""
    name: str
    path: str
    file_url: str = ""
    description: str = ""
    status_code: int = 0
    content_type: str = ""
    is_sse: bool = False
    body_preview: str = ""


class AgenticRequest(BaseModel):
    """Request body for agentic/AI discovery findings from an external scanner."""
    domain: str
    subdomain: str
    url: str
    scan_duration_secs: float = 0.0
    findings_count: int = 0
    findings: list[AgenticFinding] = []
    mcp: Optional[MCPResult] = None
