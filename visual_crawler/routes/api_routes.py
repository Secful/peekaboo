"""API routes: description generation, JS analysis, subdomain crawl, geolocation, scan history."""

import asyncio
import logging

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from ..models import GenerateDescriptionRequest, GeolocateIpsRequest, SecurityInsightsRequest, JsResourcesRequest, OpenPortsRequest, AgenticRequest, ExtractedApiRequest, ApiSpecRequest, MobileEndpointsRequest, ApkAnalyzerStatusRequest
from ..bedrock_analyzer import BedrockAPIAnalyzer
from ..scan_logger import list_scans, list_recent_scans, get_scan

logger = logging.getLogger(__name__)

# Subdomain discovery Lambda URL (configurable via env var)
import os
SUBDOMAIN_LAMBDA_URL = os.getenv(
    'SUBDOMAIN_LAMBDA_URL',
    'https://24g3gth3qwhguxrhkuomm3l67i0gdhyy.lambda-url.us-east-1.on.aws/'
)

router = APIRouter()


@router.post("/api/generate-description")
async def generate_description(request: GenerateDescriptionRequest):
    """Generate API description using AWS Bedrock with Claude."""
    try:
        analyzer = BedrockAPIAnalyzer()
        result = await analyzer.generate_api_description(
            method=request.method,
            path=request.path,
            host=request.host,
            request_body=request.request_body,
            response_body=request.response_body,
            response_status=request.response_status,
            query_params=request.query_params or [],
        )
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Failed to generate API description: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate description: {str(e)}"
        )


@router.get("/api/crawl-subdomain")
async def crawl_subdomain(crawl: str):
    """Call the subdomain Lambda with ?crawl=<subdomain> to get crawled URLs."""
    try:
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.get(
                SUBDOMAIN_LAMBDA_URL, params={"crawl": crawl}
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.error(f"Subdomain crawl failed for {crawl}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Subdomain crawl failed: {str(e)}",
        )


@router.post("/api/geolocate-ips")
async def geolocate_ips(request: GeolocateIpsRequest):
    """Proxy IP geolocation via ip-api.com batch endpoint."""
    unique_ips = list(dict.fromkeys(request.ips))[:100]
    if not unique_ips:
        return JSONResponse(content={"results": []})
    try:
        payload = [{"query": ip, "fields": "query,status,country,city,lat,lon,isp,org"} for ip in unique_ips]
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post("http://ip-api.com/batch", json=payload)
            resp.raise_for_status()
            return JSONResponse(content={"results": resp.json()})
    except Exception as e:
        logger.error(f"IP geolocation failed: {e}")
        raise HTTPException(status_code=502, detail=f"Geolocation failed: {str(e)}")


@router.get("/api/scan-history")
async def scan_history(domain: str = ""):
    """List past scan summaries. Without domain: returns 25 most recent across all domains."""
    domain = domain.strip().lower()
    try:
        if domain:
            scans = await asyncio.to_thread(list_scans, domain)
        else:
            scans = await asyncio.to_thread(list_recent_scans, 25)
        return JSONResponse(content={"scans": scans})
    except Exception as e:
        logger.error(f"Failed to list scan history: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list scan history: {str(e)}")


@router.get("/api/scan-history/{domain}/{scan_id}")
async def scan_history_detail(domain: str, scan_id: str):
    """Fetch full scan JSON for a specific past scan."""
    try:
        data = await asyncio.to_thread(get_scan, domain, scan_id)
        if data is None:
            raise HTTPException(status_code=404, detail="Scan not found")
        return JSONResponse(content=data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get scan detail: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get scan: {str(e)}")


@router.post("/api/security-insights")
async def security_insights(request: SecurityInsightsRequest):
    """Receive security findings from an external scanner and push to connected UI clients."""
    from .ws_routes import _client_domains, _connected_clients, _subdomains_ready
    from ..scanner_store import scanner_store

    logger.warning(f"Got {request.findings_count} security findings for subdomain {request.subdomain}")

    payload = {
        "type": "security_insights",
        "domain": request.domain,
        "subdomain": request.subdomain,
        "url": request.url,
        "scan_duration_secs": request.scan_duration_secs,
        "findings_count": request.findings_count,
        "findings": [f.model_dump() for f in request.findings],
    }

    scanner_store.store_security_insights(request.domain, request.subdomain, payload)

    pushed_to = 0
    for scan_id, domain in list(_client_domains.items()):
        if domain != request.domain:
            continue
        ws = _connected_clients.get(scan_id)
        if ws is None:
            continue
        if _subdomains_ready.get(scan_id):
            try:
                await ws.send_json(payload)
                pushed_to += 1
            except Exception:
                logger.warning(f"Failed to push security insights to scan {scan_id}")

    logger.warning(
        f"security_insights for {request.subdomain}: "
        f"pushed_to={pushed_to}, "
        f"request.domain={request.domain!r}, "
        f"client_domains={dict(_client_domains)}, "
        f"subdomains_ready={dict(_subdomains_ready)}"
    )
    return JSONResponse(content={"status": "ok", "pushed_to": pushed_to})


@router.post("/api/jsresources")
async def js_resources(request: JsResourcesRequest):
    """Receive JS resource URLs from an external scanner and push to connected UI clients."""
    from .ws_routes import _client_domains, _connected_clients, _subdomains_ready
    from ..scanner_store import scanner_store

    payload = {
        "type": "js_resources",
        "domain": request.domain,
        "subdomain": request.subdomain,
        "url": request.url,
        "scan_duration_secs": request.scan_duration_secs,
        "urls_count": request.urls_count,
        "urls": request.urls,
    }

    scanner_store.store_js_resources(request.domain, request.subdomain, payload)

    pushed_to = 0
    for scan_id, domain in list(_client_domains.items()):
        if domain != request.domain:
            continue
        ws = _connected_clients.get(scan_id)
        if ws is None:
            continue
        if _subdomains_ready.get(scan_id):
            try:
                await ws.send_json(payload)
                pushed_to += 1
            except Exception:
                logger.warning(f"Failed to push JS resources to scan {scan_id}")

    logger.warning(
        f"js_resources for {request.subdomain}: "
        f"pushed_to={pushed_to}, "
        f"request.domain={request.domain!r}, "
        f"client_domains={dict(_client_domains)}, "
        f"subdomains_ready={dict(_subdomains_ready)}"
    )
    return JSONResponse(content={"status": "ok", "pushed_to": pushed_to})


@router.post("/api/openports")
async def open_ports(request: OpenPortsRequest):
    """Receive open port scan results from an external scanner and push to connected UI clients."""
    from .ws_routes import _client_domains, _connected_clients, _subdomains_ready
    from ..scanner_store import scanner_store

    logger.warning(f"Got {request.open_ports_count} open ports for subdomain {request.subdomain}")

    payload = {
        "type": "open_ports",
        "domain": request.domain,
        "subdomain": request.subdomain,
        "ip": request.ip,
        "scan_duration_secs": request.scan_duration_secs,
        "open_ports_count": request.open_ports_count,
        "open_ports": request.open_ports,
    }

    scanner_store.store_open_ports(request.domain, request.subdomain, payload)

    pushed_to = 0
    for scan_id, domain in list(_client_domains.items()):
        if domain != request.domain:
            continue
        ws = _connected_clients.get(scan_id)
        if ws is None:
            continue
        if _subdomains_ready.get(scan_id):
            try:
                await ws.send_json(payload)
                pushed_to += 1
            except Exception:
                logger.warning(f"Failed to push open ports to scan {scan_id}")

    logger.warning(
        f"open_ports for {request.subdomain}: "
        f"pushed_to={pushed_to}, "
        f"request.domain={request.domain!r}, "
        f"client_domains={dict(_client_domains)}, "
        f"subdomains_ready={dict(_subdomains_ready)}"
    )
    return JSONResponse(content={"status": "ok", "pushed_to": pushed_to})


@router.post("/api/agentic")
async def agentic(request: AgenticRequest):
    """Receive agentic/AI discovery findings from an external scanner and push to connected UI clients."""
    from .ws_routes import _client_domains, _connected_clients, _subdomains_ready
    from ..scanner_store import scanner_store

    logger.warning(f"Got {request.findings_count} agentic findings for subdomain {request.subdomain}")

    payload = {
        "type": "agentic",
        "domain": request.domain,
        "subdomain": request.subdomain,
        "url": request.url,
        "scan_duration_secs": request.scan_duration_secs,
        "findings_count": request.findings_count,
        "findings": [f.model_dump() for f in request.findings],
        "mcp": request.mcp.model_dump() if request.mcp else None,
    }

    scanner_store.store_agentic(request.domain, request.subdomain, payload)

    pushed_to = 0
    for scan_id, domain in list(_client_domains.items()):
        if domain != request.domain:
            continue
        ws = _connected_clients.get(scan_id)
        if ws is None:
            continue
        if _subdomains_ready.get(scan_id):
            try:
                await ws.send_json(payload)
                pushed_to += 1
            except Exception:
                logger.warning(f"Failed to push agentic findings to scan {scan_id}")

    logger.warning(
        f"agentic for {request.subdomain}: "
        f"pushed_to={pushed_to}, "
        f"request.domain={request.domain!r}, "
        f"client_domains={dict(_client_domains)}, "
        f"subdomains_ready={dict(_subdomains_ready)}"
    )
    return JSONResponse(content={"status": "ok", "pushed_to": pushed_to})


@router.post("/api/extractedapi")
async def extracted_api(request: ExtractedApiRequest):
    """Receive extracted API findings from the api_extractor_lambda and push to connected UI clients."""
    from .ws_routes import _client_domains, _connected_clients, _subdomains_ready
    from ..scanner_store import scanner_store

    logger.warning(f"Got {request.findings_count} extracted API findings for subdomain {request.subdomain}")

    payload = {
        "type": "extracted_apis",
        "domain": request.domain,
        "subdomain": request.subdomain,
        "url": request.url,
        "js_files_analyzed": request.js_files_analyzed,
        "js_files_total": request.js_files_total,
        "scan_duration_secs": request.scan_duration_secs,
        "findings_count": request.findings_count,
        "findings": [f.model_dump() for f in request.findings],
    }

    scanner_store.store_extracted_apis(request.domain, request.subdomain, payload)

    pushed_to = 0
    for scan_id, domain in list(_client_domains.items()):
        if domain != request.domain:
            continue
        ws = _connected_clients.get(scan_id)
        if ws is None:
            continue
        if _subdomains_ready.get(scan_id):
            try:
                await ws.send_json(payload)
                pushed_to += 1
            except Exception:
                logger.warning(f"Failed to push extracted APIs to scan {scan_id}")

    logger.warning(
        f"extracted_apis for {request.subdomain}: "
        f"pushed_to={pushed_to}, "
        f"request.domain={request.domain!r}, "
        f"client_domains={dict(_client_domains)}, "
        f"subdomains_ready={dict(_subdomains_ready)}"
    )
    return JSONResponse(content={"status": "ok", "pushed_to": pushed_to})


@router.get("/api/fetch-spec")
async def fetch_spec(url: str):
    """Proxy-fetch an OpenAPI/Swagger JSON or YAML spec and extract endpoints."""
    import yaml

    if not url.startswith(("http://", "https://")):
        return JSONResponse(content={"error": "Invalid URL", "endpoints": []}, status_code=400)

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            body = resp.text
            # Pick parser based on URL extension; fall back to trying both
            path_lower = url.split("?")[0].lower()
            if path_lower.endswith((".yaml", ".yml")):
                spec = yaml.safe_load(body)
            else:
                try:
                    spec = __import__("json").loads(body)
                except Exception:
                    spec = yaml.safe_load(body)
            if not isinstance(spec, dict):
                return JSONResponse(content={"error": "Spec is not a valid JSON/YAML object", "endpoints": []})
    except httpx.HTTPStatusError as e:
        return JSONResponse(content={"error": f"HTTP {e.response.status_code}", "endpoints": []})
    except Exception as e:
        return JSONResponse(content={"error": str(e), "endpoints": []})

    try:
        endpoints = []
        http_methods = {"get", "post", "put", "delete", "patch", "options", "head"}
        for path, methods in (spec.get("paths") or {}).items():
            if not isinstance(methods, dict):
                continue
            for method, detail in methods.items():
                if method.lower() not in http_methods:
                    continue
                if not isinstance(detail, dict):
                    continue
                desc = detail.get("summary") or detail.get("description") or ""
                if len(desc) > 120:
                    desc = desc[:117] + "..."
                endpoints.append({"method": method.upper(), "path": path, "description": desc})
        endpoints.sort(key=lambda e: (e["path"], e["method"]))

        title = ""
        spec_version = ""
        info = spec.get("info") or {}
        title = info.get("title", "")
        if spec.get("openapi"):
            spec_version = f"OpenAPI {spec['openapi']}"
        elif spec.get("swagger"):
            spec_version = f"Swagger {spec['swagger']}"

        return JSONResponse(content={"endpoints": endpoints, "spec_version": spec_version, "title": title})
    except Exception as e:
        return JSONResponse(content={"error": f"Parse error: {e}", "endpoints": []})


@router.post("/api/apispec")
async def api_spec(request: ApiSpecRequest):
    """Receive API spec discovery findings from the api_discovery_lambda and push to connected UI clients."""
    from .ws_routes import _client_domains, _connected_clients, _subdomains_ready
    from ..scanner_store import scanner_store

    logger.warning(f"Got {request.findings_count} API spec findings for subdomain {request.subdomain}")

    payload = {
        "type": "api_specs",
        "domain": request.domain,
        "subdomain": request.subdomain,
        "url": request.url,
        "scan_duration_secs": request.scan_duration_secs,
        "findings_count": request.findings_count,
        "findings": [f.model_dump() for f in request.findings],
        "robots_api_paths": request.robots_api_paths,
        "sitemap_api_urls": request.sitemap_api_urls,
        "graphql": request.graphql.model_dump() if request.graphql else None,
    }

    scanner_store.store_api_specs(request.domain, request.subdomain, payload)

    pushed_to = 0
    for scan_id, domain in list(_client_domains.items()):
        if domain != request.domain:
            continue
        ws = _connected_clients.get(scan_id)
        if ws is None:
            continue
        if _subdomains_ready.get(scan_id):
            try:
                await ws.send_json(payload)
                pushed_to += 1
            except Exception:
                logger.warning(f"Failed to push API spec findings to scan {scan_id}")

    logger.warning(
        f"api_specs for {request.subdomain}: "
        f"pushed_to={pushed_to}, "
        f"request.domain={request.domain!r}, "
        f"client_domains={dict(_client_domains)}, "
        f"subdomains_ready={dict(_subdomains_ready)}"
    )
    return JSONResponse(content={"status": "ok", "pushed_to": pushed_to})


@router.post("/api/mobileendpoints")
async def mobile_endpoints(request: MobileEndpointsRequest):
    """Receive mobile endpoint findings from peekaboo-apk-analyzer and push to connected UI clients."""
    from .ws_routes import _client_domains, _connected_clients
    from ..scanner_store import scanner_store

    logger.warning(f"Got {request.findings_count} mobile endpoints from {request.package_name} for domain {request.domain}")

    payload = {
        "type": "mobile_endpoints",
        "domain": request.domain,
        "package_name": request.package_name,
        "app_name": request.app_name,
        "play_url": request.play_url,
        "scan_id": request.scan_id,
        "app_version": request.app_version,
        "scan_duration_secs": request.scan_duration_secs,
        "decompiled_classes": request.decompiled_classes,
        "analyzed_classes": request.analyzed_classes,
        "findings_count": request.findings_count,
        "findings": [f.model_dump() for f in request.findings],
    }

    scanner_store.store_mobile_endpoints(request.domain, request.package_name, payload)

    pushed_to = 0
    for scan_id, domain in list(_client_domains.items()):
        if domain != request.domain:
            continue
        ws = _connected_clients.get(scan_id)
        if ws is None:
            continue
        try:
            await ws.send_json(payload)
            pushed_to += 1
        except Exception:
            logger.warning(f"Failed to push mobile endpoints to scan {scan_id}")

    logger.warning(
        f"mobile_endpoints for {request.package_name}: "
        f"pushed_to={pushed_to}, "
        f"request.domain={request.domain!r}, "
        f"client_domains={dict(_client_domains)}"
    )
    return JSONResponse(content={"status": "ok", "pushed_to": pushed_to})


@router.post("/api/apkanalyzerstatus")
async def apk_analyzer_status(request: ApkAnalyzerStatusRequest):
    """Receive real-time status updates from peekaboo-apk-analyzer and push to connected UI clients."""
    from .ws_routes import _client_domains, _connected_clients

    logger.info(f"APK status [{request.type}] {request.package_name}: {request.message}")

    payload = {
        "type": "apk_status",
        "domain": request.domain,
        "package_name": request.package_name,
        "scan_id": request.scan_id,
        "level": request.type,
        "message": request.message,
    }

    pushed_to = 0
    for scan_id, domain in list(_client_domains.items()):
        if domain != request.domain:
            continue
        ws = _connected_clients.get(scan_id)
        if ws is None:
            continue
        try:
            await ws.send_json(payload)
            pushed_to += 1
        except Exception:
            logger.warning(f"Failed to push APK status to scan {scan_id}")

    return JSONResponse(content={"status": "ok", "pushed_to": pushed_to})
