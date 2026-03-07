"""API routes: description generation, JS analysis, subdomain crawl, geolocation."""

import json
import logging

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from ..models import GenerateDescriptionRequest, AnalyzeJsRequest, GeolocateIpsRequest
from ..bedrock_analyzer import BedrockAPIAnalyzer

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


@router.post("/api/analyze-js")
async def analyze_js(request: AnalyzeJsRequest):
    """Fetch JS files and use Bedrock/Claude to extract REST API calls."""
    js_urls = request.urls[:10]  # Limit to 10 JS files
    if not js_urls:
        raise HTTPException(status_code=400, detail="No URLs provided")

    # Fetch JS source code
    js_sources: list[dict] = []
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        for url in js_urls:
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                text = resp.text[:50_000]  # Cap each file at 50KB
                js_sources.append({"url": url, "source": text})
            except Exception as e:
                logger.warning(f"Failed to fetch JS {url}: {e}")

    if not js_sources:
        return JSONResponse(content={"apis": [], "error": "Could not fetch any JS files"})

    # Build prompt for Claude
    prompt = (
        "You are an expert at reading JavaScript source code and extracting REST API calls.\n\n"
        "Analyze the following JavaScript files and extract ALL REST API endpoints you can find. "
        "Look for: fetch() calls, XMLHttpRequest, axios, $.ajax, $.get, $.post, superagent, "
        "ky, got, request(), http.get/post, and any URL strings that look like API endpoints.\n\n"
        "IMPORTANT - Only extract actual API calls that send/receive data. STRICTLY EXCLUDE:\n"
        "- Any URL ending in a file extension such as .js, .css, .html, .png, .jpg, .svg, "
        ".gif, .ico, .woff, .woff2, .ttf, .eot, .map, .json (static file), .xml (static file)\n"
        "- CDN URLs, asset bundle paths, or package paths (e.g. /rum/@adobe/helix-rum-enhancer@^2/src/index.js)\n"
        "- Webpack/module loader references, dynamic imports, or script src URLs\n"
        "- URL strings that are just file paths or resource paths, not API endpoints\n"
        "- Analytics/tracking pixel URLs\n"
        "- JavaScript variable names or object properties that HOLD a URL but are NOT the URL itself "
        "(e.g. 'ajaxurl', 'ajax_posts.ajax_url', 'MSP_SP_AJAX_ADMIN_URL', 'swp.ajaxurl', 'url'). "
        "The 'url' field MUST be a literal URL/path string containing at least one '/' character, "
        "like '/api/users' or 'https://example.com/data'. If you can only see a variable name "
        "and cannot resolve the actual URL path, skip that entry entirely.\n"
        "A real API call typically hits a path like /api/*, /v1/*, /graphql, /auth/*, "
        "/users/*, etc. and returns JSON/XML data. If a URL points to a static resource "
        "or file (especially .js files), it is NOT an API call — skip it.\n\n"
        "For each endpoint found, extract:\n"
        "- method: The HTTP method (GET, POST, PUT, DELETE, PATCH) or UNKNOWN if unclear\n"
        "- url: The full or partial URL/path\n"
        "- context: A very brief description (under 10 words) of what the call does\n"
        "- source_file: The filename (not full URL) of the JS file where this was found\n"
        "- evidence: The exact code snippet (1-3 lines) from the source that proves this API call exists. "
        "Copy the relevant lines verbatim from the source code.\n"
        "- category: Classify the API into one of: Authentication, User Management, Payment, Shopping, "
        "Analytics, Security, Search, Media, Configuration, Social, Messaging, Data, or Other\n"
        "- pii: An object with 'detected' (boolean) and 'fields' (array of strings). Set detected=true "
        "if the URL path, parameters, or request payload suggests PII or sensitive data is transmitted "
        "(e.g. email, password, credit_card, ssn, phone, address, name, date_of_birth, token, api_key). "
        "If no PII detected, set detected=false and fields=[].\n\n"
    )

    for src in js_sources:
        prompt += f"--- FILE: {src['url']} ---\n{src['source']}\n\n"

    prompt += (
        "\nReturn ONLY a JSON array. No explanation. Example:\n"
        '[{"method":"GET","url":"/api/users","context":"Fetch user list","source_file":"app.js",'
        '"evidence":"fetch(\'/api/users\', {method: \'GET\'})","category":"User Management",'
        '"pii":{"detected":false,"fields":[]}},'
        '{"method":"POST","url":"/api/auth/login","context":"User authentication","source_file":"auth.bundle.js",'
        '"evidence":"axios.post(\'/api/auth/login\', credentials)","category":"Authentication",'
        '"pii":{"detected":true,"fields":["email","password"]}}]\n'
        "\nIf no API calls found, return an empty array: []"
    )

    try:
        analyzer = BedrockAPIAnalyzer()
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 6000,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
        }
        response = analyzer.bedrock_runtime.invoke_model(
            modelId=analyzer.model_id,
            body=json.dumps(body),
        )
        resp_json = json.loads(response["body"].read())
        llm_text = resp_json["content"][0]["text"]

        # Parse JSON from response (reuse shared parser)
        from ..bedrock_analyzer import _parse_llm_response
        apis = _parse_llm_response(llm_text)
        if not isinstance(apis, list):
            apis = []
        return JSONResponse(content={"apis": apis})
    except Exception as e:
        logger.error(f"JS analysis via Bedrock failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


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
