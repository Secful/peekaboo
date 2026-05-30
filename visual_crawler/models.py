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

    # WebSocket message sampling
    websocket_messages: Optional[list[dict]] = None  # Sampled WebSocket frames

    # WebSocket security issues
    security_issues: Optional[list[str]] = None  # Security issue types detected
    url_token_detected: bool = False  # Auth tokens found in URL params


# Pydantic request models for API routes

class DescribeServicesRequest(BaseModel):
    """Request body for batch service description."""
    target_domain: str
    hostnames: list[str]


class GenerateDescriptionRequest(BaseModel):
    """Request body for generating API description."""
    method: str
    path: str
    host: str
    request_body: Optional[str] = None
    response_body: Optional[str] = None
    response_status: Optional[int] = None
    query_params: Optional[list[str]] = None


class UpdateDescriptionRequest(BaseModel):
    """Request body for updating endpoint description in backend."""
    scan_id: str
    method: str
    path: str
    host: str
    llm_description: str


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


class JsSecretFinding(BaseModel):
    """A single secret found in JavaScript files."""
    rule_id: str
    description: str
    secret: str
    match: str
    file: str
    entropy: float
    line: int
    start_column: int
    is_likely_public: bool = False


class JsSecretsRequest(BaseModel):
    """Request body for JS secrets scanner results."""
    subdomain: str
    url: str
    js_files_analyzed: int = 0
    js_files_total: int = 0
    scan_duration_secs: float = 0.0
    findings_count: int = 0
    findings: list[JsSecretFinding] = []


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


class ExtractedApiFinding(BaseModel):
    """A single API endpoint extracted from JS source by the external Lambda."""
    method: str
    url: str
    context: str
    source_file: str
    evidence: str
    category: str
    pii: list[str] = ["none"]


class ExtractedApiRequest(BaseModel):
    """Request body for extracted API findings from the api_extractor_lambda."""
    domain: str
    subdomain: str
    url: str
    js_files_analyzed: int = 0
    js_files_total: int = 0
    scan_duration_secs: float = 0.0
    findings_count: int = 0
    findings: list[ExtractedApiFinding] = []


class MobileTrafficVerification(BaseModel):
    """Verification probe results for an ambiguous mobile traffic test."""
    options_allowed: str = ""
    options_cors: bool = False
    malformed_status: int = 0
    malformed_differs: bool = False
    parent_status: int = 0
    parent_differs: bool = False
    waf_detected: str = ""


class MobileTrafficRequest(BaseModel):
    """Single mobile endpoint traffic result from the testing Lambda."""
    domain: str
    package_name: str
    app_name: str = ""
    scan_id: str = ""
    method: str
    url: str
    full_url: str = ""
    base_url_used: str = ""
    status_code: int = 0
    content_type: str = ""
    response_body: str = ""
    response_size: int = 0
    latency_ms: int = 0
    error: str = ""
    tls: bool = False
    redirect_url: str = ""
    confidence: int = 0
    verification: Optional[MobileTrafficVerification] = None
    response_headers: Optional[dict] = None


class MobileEndpointFinding(BaseModel):
    """A single API endpoint extracted from an Android APK."""
    method: str
    url: str
    base_url: str = ""
    context: str = ""
    source_class: str = ""
    evidence: str = ""
    category: str = ""
    confidence: int | None = None


class MobileEndpointsRequest(BaseModel):
    """Request body for mobile endpoint findings from the peekaboo-apk-analyzer."""
    domain: str
    package_name: str
    app_name: str = ""
    play_url: str = ""
    scan_id: str = ""
    app_version: str = ""
    scan_duration_secs: float = 0.0
    decompiled_classes: int = 0
    analyzed_classes: int = 0
    findings_count: int = 0
    findings: list[MobileEndpointFinding] = []


class ApiSpecFinding(BaseModel):
    """A single API specification finding from the api_discovery_lambda."""
    name: str
    category: str
    path: str
    file_url: str
    description: str
    spec_version: str = ""


class GraphQLResult(BaseModel):
    """GraphQL introspection result from the api_discovery_lambda."""
    endpoint: str
    introspection_enabled: bool
    type_count: int = 0
    type_names: list[str] = []


class ApkAnalyzerStatusRequest(BaseModel):
    """Real-time status update from the peekaboo-apk-analyzer."""
    domain: str
    package_name: str
    scan_id: str = ""
    type: str          # "INFO", "WARNING", "ERROR"
    message: str


class GitFinding(BaseModel):
    """A single API spec finding from public source control."""
    source: str
    repo: str
    file_path: str
    file_url: str
    raw_url: str
    spec_type: str
    description: str
    discovery_method: str


class GitFindingsRequest(BaseModel):
    """Request body for git-based API spec findings from the git-search service."""
    domain: str
    scan_id: str
    scan_duration_secs: float = 0
    findings_count: int = 0
    findings: list[GitFinding] = []
    errors: list[str] = []


class ApiSpecRequest(BaseModel):
    """Request body for API spec discovery findings from the api_discovery_lambda."""
    domain: str
    subdomain: str
    url: str
    scan_duration_secs: float = 0.0
    findings_count: int = 0
    findings: list[ApiSpecFinding] = []
    robots_api_paths: list[str] = []
    sitemap_api_urls: list[str] = []
    graphql: Optional[GraphQLResult] = None


class EndpointData(BaseModel):
    """Single endpoint data for Swagger export."""
    method: str
    path: str
    source: str  # 'web-traffic', 'js', 'apk'
    summary: Optional[str] = None  # LLM-generated description if available


class SwaggerExportRequest(BaseModel):
    """Request body for Swagger/OpenAPI export with Drain3 parameterization."""
    domain: str
    scan_date: str
    endpoints: list[EndpointData]
