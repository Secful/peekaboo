"""Technology detection based on file extensions and HTTP headers."""

from typing import Optional
from urllib.parse import urlparse
from collections import defaultdict


def analyze_technologies(endpoints: list[dict], target_domain: str) -> dict:
    """Analyze server-side technologies and CDNs from discovered endpoints.

    Analyzes only endpoints belonging to the target domain/subdomains.
    Detects technologies based on:
    - File extensions (php, jsp, asp, aspx, etc.)
    - HTTP response headers (Server, X-Powered-By, X-AspNet-Version, etc.)
    - CDN indicators (Cloudflare, Akamai, Fastly, etc.)

    Args:
        endpoints: List of discovered endpoint dictionaries
        target_domain: The target domain (e.g., "example.com")

    Returns:
        Dictionary with technology analysis:
        {
            "server_technologies": {
                "PHP": {"count": 5, "versions": ["7.4", "8.1"], "endpoints": [...]},
                "ASP.NET": {"count": 3, "versions": ["4.0"], "endpoints": [...]}
            },
            "web_servers": {
                "nginx": {"count": 10, "versions": ["1.18.0"], "endpoints": [...]},
                "Apache": {"count": 2, "versions": ["2.4.41"], "endpoints": [...]}
            },
            "cdns": {
                "Cloudflare": {"count": 8, "endpoints": [...]},
                "Akamai": {"count": 2, "endpoints": [...]}
            },
            "frameworks": {
                "Express": {"count": 5, "endpoints": [...]},
                "Django": {"count": 1, "endpoints": [...]}
            },
            "other_technologies": {
                "Varnish": {"count": 1, "endpoints": [...]},
                "OpenSSL": {"count": 10, "versions": ["1.1.1"], "endpoints": [...]}
            }
        }
    """
    # Normalize domain (remove www, protocol, trailing slash)
    target_domain = target_domain.lower().replace("www.", "").rstrip("/")

    # Storage for detected technologies
    server_technologies = defaultdict(lambda: {"count": 0, "versions": set(), "endpoints": []})
    web_servers = defaultdict(lambda: {"count": 0, "versions": set(), "endpoints": []})
    cdns = defaultdict(lambda: {"count": 0, "endpoints": []})
    frameworks = defaultdict(lambda: {"count": 0, "endpoints": []})
    other_technologies = defaultdict(lambda: {"count": 0, "versions": set(), "endpoints": []})

    # File extension to technology mapping
    extension_map = {
        ".php": "PHP",
        ".php3": "PHP",
        ".php4": "PHP",
        ".php5": "PHP",
        ".phtml": "PHP",
        ".asp": "ASP (Classic)",
        ".aspx": "ASP.NET",
        ".ashx": "ASP.NET",
        ".asmx": "ASP.NET (Web Services)",
        ".axd": "ASP.NET",
        ".jsp": "JSP (Java)",
        ".jspx": "JSP (Java)",
        ".do": "Java Struts",
        ".action": "Java Struts",
        ".jsf": "JavaServer Faces",
        ".xhtml": "JavaServer Faces",
        ".rb": "Ruby",
        ".py": "Python",
        ".pl": "Perl",
        ".cgi": "CGI",
        ".cfm": "ColdFusion",
        ".cfml": "ColdFusion",
    }

    # Process each endpoint
    for endpoint in endpoints:
        # Get endpoint URL and host
        url = endpoint.get("url", "")
        if not url:
            continue

        # Parse URL to get host
        parsed = urlparse(url)
        endpoint_domain = parsed.netloc.lower().replace("www.", "")

        # Skip if not same domain or subdomain
        if not (endpoint_domain == target_domain or endpoint_domain.endswith(f".{target_domain}")):
            continue

        # Analyze file extension
        path = parsed.path.lower()
        for ext, tech in extension_map.items():
            if ext in path:
                server_technologies[tech]["count"] += 1
                server_technologies[tech]["endpoints"].append({
                    "url": url,
                    "method": endpoint.get("method", "GET")
                })
                break

        # Analyze HTTP headers
        headers = endpoint.get("headers", {})
        if not headers:
            continue

        # Normalize header keys to lowercase
        headers_lower = {k.lower(): v for k, v in headers.items()}

        # Detect web server
        server_header = headers_lower.get("server", "")
        if server_header:
            web_server_info = _parse_server_header(server_header)
            if web_server_info:
                name, version = web_server_info
                web_servers[name]["count"] += 1
                if version:
                    web_servers[name]["versions"].add(version)
                web_servers[name]["endpoints"].append({
                    "url": url,
                    "server_header": server_header
                })

        # Detect server-side technologies from headers
        _detect_from_headers(headers_lower, url, server_technologies, frameworks, other_technologies)

        # Detect CDN
        cdn_name = _detect_cdn(headers_lower)
        if cdn_name:
            cdns[cdn_name]["count"] += 1
            cdns[cdn_name]["endpoints"].append({
                "url": url,
                "indicators": _get_cdn_indicators(headers_lower, cdn_name)
            })

    # Convert sets to sorted lists and format output
    result = {
        "server_technologies": _format_tech_dict(server_technologies),
        "web_servers": _format_tech_dict(web_servers),
        "cdns": _format_simple_dict(cdns),
        "frameworks": _format_simple_dict(frameworks),
        "other_technologies": _format_tech_dict(other_technologies),
    }

    return result


def _parse_server_header(server_header: str) -> Optional[tuple[str, Optional[str]]]:
    """Parse Server header to extract server name and version.

    Examples:
        "nginx/1.18.0" -> ("nginx", "1.18.0")
        "Apache/2.4.41 (Ubuntu)" -> ("Apache", "2.4.41")
        "cloudflare" -> ("Cloudflare", None)

    Returns:
        Tuple of (server_name, version) or None if not parseable
    """
    if not server_header:
        return None

    # Common server patterns
    # nginx/1.18.0
    # Apache/2.4.41 (Ubuntu)
    # Microsoft-IIS/10.0
    # cloudflare
    # AmazonS3

    parts = server_header.split("/")
    if len(parts) >= 2:
        name = parts[0].strip()
        version = parts[1].split()[0].strip()  # Remove OS info like (Ubuntu)
        return (name, version)
    elif len(parts) == 1:
        # No version, just name
        name = server_header.split()[0].strip()
        # Normalize common names
        name_lower = name.lower()
        if "cloudflare" in name_lower:
            return ("Cloudflare", None)
        elif "amazon" in name_lower or "s3" in name_lower:
            return ("Amazon S3", None)
        elif "nginx" in name_lower:
            return ("nginx", None)
        elif "apache" in name_lower:
            return ("Apache", None)
        elif "iis" in name_lower or "microsoft" in name_lower:
            return ("Microsoft-IIS", None)
        else:
            return (name, None)

    return None


def _detect_from_headers(headers: dict, url: str, server_technologies: dict,
                         frameworks: dict, other_technologies: dict) -> None:
    """Detect technologies from various HTTP headers.

    Args:
        headers: Dictionary of lowercase header keys to values
        url: The endpoint URL
        server_technologies: Dict to store server-side language detections
        frameworks: Dict to store framework detections
        other_technologies: Dict to store other technology detections
    """
    endpoint_info = {"url": url}

    # X-Powered-By header
    # Examples: "PHP/7.4.3", "ASP.NET", "Express", "Next.js"
    powered_by = headers.get("x-powered-by", "")
    if powered_by:
        endpoint_info["x-powered-by"] = powered_by

        # Parse version if present
        if "/" in powered_by:
            tech, version = powered_by.split("/", 1)
            tech = tech.strip()
            version = version.split()[0].strip()  # Remove extra info

            if tech.upper() == "PHP":
                server_technologies["PHP"]["count"] += 1
                server_technologies["PHP"]["versions"].add(version)
                server_technologies["PHP"]["endpoints"].append(endpoint_info)
            elif tech.upper() == "ASP.NET":
                server_technologies["ASP.NET"]["count"] += 1
                server_technologies["ASP.NET"]["versions"].add(version)
                server_technologies["ASP.NET"]["endpoints"].append(endpoint_info)
            else:
                frameworks[tech]["count"] += 1
                frameworks[tech]["endpoints"].append(endpoint_info)
        else:
            # No version
            if "ASP.NET" in powered_by:
                server_technologies["ASP.NET"]["count"] += 1
                server_technologies["ASP.NET"]["endpoints"].append(endpoint_info)
            elif "PHP" in powered_by.upper():
                server_technologies["PHP"]["count"] += 1
                server_technologies["PHP"]["endpoints"].append(endpoint_info)
            elif "Express" in powered_by:
                frameworks["Express"]["count"] += 1
                frameworks["Express"]["endpoints"].append(endpoint_info)
                server_technologies["Node.js"]["count"] += 1
                server_technologies["Node.js"]["endpoints"].append(endpoint_info)
            elif "Next.js" in powered_by:
                frameworks["Next.js"]["count"] += 1
                frameworks["Next.js"]["endpoints"].append(endpoint_info)
                server_technologies["Node.js"]["count"] += 1
                server_technologies["Node.js"]["endpoints"].append(endpoint_info)
            else:
                frameworks[powered_by]["count"] += 1
                frameworks[powered_by]["endpoints"].append(endpoint_info)

    # X-AspNet-Version
    aspnet_version = headers.get("x-aspnet-version", "")
    if aspnet_version:
        server_technologies["ASP.NET"]["count"] += 1
        server_technologies["ASP.NET"]["versions"].add(aspnet_version)
        server_technologies["ASP.NET"]["endpoints"].append({
            "url": url,
            "x-aspnet-version": aspnet_version
        })

    # X-AspNetMvc-Version
    mvc_version = headers.get("x-aspnetmvc-version", "")
    if mvc_version:
        frameworks["ASP.NET MVC"]["count"] += 1
        frameworks["ASP.NET MVC"]["endpoints"].append({
            "url": url,
            "version": mvc_version
        })

    # X-Framework headers (custom)
    framework = headers.get("x-framework", "")
    if framework:
        frameworks[framework]["count"] += 1
        frameworks[framework]["endpoints"].append(endpoint_info)

    # Django
    if headers.get("x-django-version", ""):
        version = headers["x-django-version"]
        frameworks["Django"]["count"] += 1
        frameworks["Django"]["endpoints"].append({"url": url, "version": version})
        server_technologies["Python"]["count"] += 1
        server_technologies["Python"]["endpoints"].append(endpoint_info)

    # Ruby on Rails
    if headers.get("x-runtime", ""):  # Rails adds this
        frameworks["Ruby on Rails"]["count"] += 1
        frameworks["Ruby on Rails"]["endpoints"].append(endpoint_info)
        server_technologies["Ruby"]["count"] += 1
        server_technologies["Ruby"]["endpoints"].append(endpoint_info)

    # Laravel (PHP framework)
    if headers.get("x-laravel-version", ""):
        version = headers["x-laravel-version"]
        frameworks["Laravel"]["count"] += 1
        frameworks["Laravel"]["endpoints"].append({"url": url, "version": version})
        server_technologies["PHP"]["count"] += 1
        server_technologies["PHP"]["endpoints"].append(endpoint_info)

    # Varnish cache
    if "varnish" in headers.get("via", "").lower():
        other_technologies["Varnish"]["count"] += 1
        other_technologies["Varnish"]["endpoints"].append(endpoint_info)

    # Check for other common technology indicators
    for header_name, header_value in headers.items():
        header_value_lower = header_value.lower()

        # OpenSSL
        if "openssl" in header_value_lower:
            import re
            version_match = re.search(r'openssl[/\s]+([\d.]+[a-z]?)', header_value_lower)
            if version_match:
                version = version_match.group(1)
                other_technologies["OpenSSL"]["count"] += 1
                other_technologies["OpenSSL"]["versions"].add(version)
                other_technologies["OpenSSL"]["endpoints"].append(endpoint_info)


def _detect_cdn(headers: dict) -> Optional[str]:
    """Detect CDN from HTTP headers.

    Args:
        headers: Dictionary of lowercase header keys to values

    Returns:
        CDN name or None if no CDN detected
    """
    # Cloudflare
    if any(k.startswith("cf-") for k in headers.keys()):
        return "Cloudflare"
    if "cloudflare" in headers.get("server", "").lower():
        return "Cloudflare"

    # Akamai
    if any(k.startswith("x-akamai-") for k in headers.keys()):
        return "Akamai"
    if "akamai" in headers.get("server", "").lower():
        return "Akamai"

    # Fastly
    if any(k.startswith("fastly-") for k in headers.keys()):
        return "Fastly"
    if "fastly" in headers.get("via", "").lower():
        return "Fastly"
    if "fastly" in headers.get("server", "").lower():
        return "Fastly"

    # Amazon CloudFront
    if any(k.startswith("x-amz-cf-") for k in headers.keys()):
        return "Amazon CloudFront"
    if "cloudfront" in headers.get("via", "").lower():
        return "Amazon CloudFront"

    # KeyCDN
    if "keycdn" in headers.get("server", "").lower():
        return "KeyCDN"

    # MaxCDN / StackPath
    if "netdna" in headers.get("server", "").lower():
        return "MaxCDN"

    # Incapsula
    if any(k.startswith("x-cdn") for k in headers.keys()):
        cdn_header = headers.get("x-cdn", "")
        if "incapsula" in cdn_header.lower():
            return "Incapsula"

    # Sucuri
    if "sucuri" in headers.get("server", "").lower():
        return "Sucuri"

    return None


def _get_cdn_indicators(headers: dict, cdn_name: str) -> list[str]:
    """Get the specific headers that indicated this CDN.

    Args:
        headers: Dictionary of lowercase header keys to values
        cdn_name: Name of the detected CDN

    Returns:
        List of header names that indicated this CDN
    """
    indicators = []

    if cdn_name == "Cloudflare":
        indicators = [k for k in headers.keys() if k.startswith("cf-")]
        if "cloudflare" in headers.get("server", "").lower():
            indicators.append("server")

    elif cdn_name == "Akamai":
        indicators = [k for k in headers.keys() if k.startswith("x-akamai-")]

    elif cdn_name == "Fastly":
        indicators = [k for k in headers.keys() if k.startswith("fastly-")]
        if "fastly" in headers.get("via", "").lower():
            indicators.append("via")

    elif cdn_name == "Amazon CloudFront":
        indicators = [k for k in headers.keys() if k.startswith("x-amz-cf-")]
        if "cloudfront" in headers.get("via", "").lower():
            indicators.append("via")

    return indicators


def _format_tech_dict(tech_dict: dict) -> dict:
    """Format technology dictionary for JSON serialization.

    Converts sets to sorted lists and limits endpoint samples.
    """
    result = {}
    for tech_name, data in tech_dict.items():
        result[tech_name] = {
            "count": data["count"],
            "versions": sorted(list(data["versions"])) if data["versions"] else [],
            "sample_endpoints": data["endpoints"][:5]  # Limit to 5 samples
        }
    return result


def _format_simple_dict(simple_dict: dict) -> dict:
    """Format simple dictionary (no versions) for JSON serialization."""
    result = {}
    for name, data in simple_dict.items():
        result[name] = {
            "count": data["count"],
            "sample_endpoints": data["endpoints"][:5]  # Limit to 5 samples
        }
    return result
