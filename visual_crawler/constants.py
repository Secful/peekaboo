"""Configuration constants and patterns for the Visual API Crawler."""

import re

# Static file extensions to exclude from API detection
STATIC_EXTENSIONS = {
    ".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".eot", ".otf", ".mp4", ".webp", ".map",
    ".br", ".gz", ".webmanifest", ".xml", ".txt", ".pdf", ".json",
    ".webm", ".avi", ".mov", ".mp3", ".wav", ".ogg", ".flac",
    ".bmp", ".tiff", ".tif", ".avif", ".apng",
    ".pbf",  # Protocol Buffer Format (map tiles, fonts)
}

# Server-side script extensions that should be considered as API endpoints
API_SCRIPT_EXTENSIONS = {
    ".php",    # PHP Hypertext Preprocessor
    ".asp",    # Classic ASP
    ".aspx",   # ASP.NET Web Forms
    ".ashx",   # ASP.NET Web Handler (High value for data)
    ".asmx",   # ASP.NET Web Service (SOAP)
    ".jsp",    # Java Server Pages
    ".jspx",   # Java Server Pages (XML)
    ".do",     # Java Struts/Spring actions
    ".action", # Java framework actions
    ".cfm",    # Adobe ColdFusion
    ".pl",     # Perl
    ".cgi",    # Common Gateway Interface
    ".rb",     # Ruby
    ".py",     # Python
}

# Regex patterns that indicate API paths
API_PATH_PATTERNS = [
    re.compile(r"/api/", re.I),
    re.compile(r"/v\d+/", re.I),
    re.compile(r"/graphql", re.I),
    re.compile(r"/rest/", re.I),
    re.compile(r"/rpc/", re.I),
    re.compile(r"/gateway/", re.I),
    re.compile(r"/service/", re.I),
    re.compile(r"/ajax/", re.I),
]

# Content types that definitively indicate API responses
DEFINITE_API_CONTENT_TYPES = {
    "application/json",
    "application/xml",
    "text/xml",
    "application/graphql+json",
    "application/grpc",
    "application/protobuf",
    "application/x-protobuf",
    "application/msgpack",
    "application/soap+xml",
    "application/vnd.api+json",  # JSON:API
    "application/hal+json",
    "application/json-patch+json",
}

# Content types that might be API responses (ambiguous)
MAYBE_API_CONTENT_TYPES = {
    "application/x-www-form-urlencoded",  # Often API form posts
    "multipart/form-data",  # Can be API (file uploads) but ambiguous
}

# All API content types combined (for backward compatibility)
API_CONTENT_TYPES = DEFINITE_API_CONTENT_TYPES | MAYBE_API_CONTENT_TYPES

# Patterns for identifying and templatizing ID-like path segments
ID_PATTERNS = [
    (re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I), "{uuid}"),
    (re.compile(r"[0-9a-f]{24}"), "{objectId}"),
    (re.compile(r"^\d+$"), "{id}"),
    (re.compile(r"^[A-Za-z0-9_-]{40,}$"), "{token}"),  # Increased from 20 to 40 chars to avoid catching descriptive API path names
]

# User agents for rotation (anti-detection)
USER_AGENTS = [
    # Chrome on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    # Chrome on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    # Chrome on Linux
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    # Firefox on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
    # Firefox on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0",
    # Safari on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    # Edge on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    # Chrome on Android
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
]

# Viewport sizes for rotation (anti-detection)
VIEWPORTS = [
    {"width": 1920, "height": 1080},  # Full HD
    {"width": 1366, "height": 768},   # Laptop
    {"width": 1536, "height": 864},   # Laptop HD+
    {"width": 1440, "height": 900},   # MacBook
    {"width": 2560, "height": 1440},  # QHD
    {"width": 1280, "height": 720},   # HD
]

# Blocking detection patterns
CAPTCHA_INDICATORS = [
    "captcha", "recaptcha", "hcaptcha", "funcaptcha",
    "challenge", "verify you are human", "please verify",
]

CLOUDFLARE_INDICATORS = [
    "cloudflare", "checking your browser", "ray id",
    "please wait while we check", "ddos protection",
]

ACCESS_DENIED_INDICATORS = [
    "access denied", "blocked", "forbidden", "not authorized",
    "authentication required", "rate limit", "too many requests",
]
