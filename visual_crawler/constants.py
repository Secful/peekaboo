"""Configuration constants and patterns for the Visual API Crawler."""

import re

# Static file extensions to exclude from API detection
STATIC_EXTENSIONS = {
    ".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".eot", ".otf", ".mp4", ".webp", ".map",
    ".br", ".gz", ".webmanifest", ".xml", ".txt", ".pdf", ".json",
    ".webm", ".avi", ".mov", ".mp3", ".wav", ".ogg", ".flac",
    ".bmp", ".tiff", ".tif", ".avif", ".apng",
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
