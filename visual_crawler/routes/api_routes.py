"""API routes: description generation, JS analysis, subdomain crawl, geolocation, scan history."""

import asyncio
import logging

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from ..models import GenerateDescriptionRequest, GeolocateIpsRequest, SecurityInsightsRequest, JsResourcesRequest, OpenPortsRequest, AgenticRequest, ExtractedApiRequest
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
    """List past scan summaries. Without domain: returns 10 most recent across all domains."""
    domain = domain.strip().lower()
    try:
        if domain:
            scans = await asyncio.to_thread(list_scans, domain)
        else:
            scans = await asyncio.to_thread(list_recent_scans, 10)
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
