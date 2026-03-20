"""DynamoDB + S3 backed scan activity logger.

Persists scan summaries to DynamoDB and full payloads to S3 (gzipped)
so past scans can be queried by domain with fast indexed lookups.
"""

import gzip
import json
import logging
import os
from decimal import Decimal
from typing import Optional

import boto3

logger = logging.getLogger(__name__)

TABLE_NAME = os.getenv("SCAN_TABLE_NAME", "peekaboo-scans")
PAYLOAD_BUCKET = os.getenv("SCAN_PAYLOAD_BUCKET", "peekaboo-scan-payloads")

_table = None
_s3 = None


def _dynamodb_table():
    """Return a cached DynamoDB Table resource."""
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb").Table(TABLE_NAME)
    return _table


def _s3_client():
    """Return a cached S3 client."""
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3")
    return _s3


def save_scan(scan_data: dict) -> None:
    """Write a scan result to DynamoDB (summary) + S3 (full payload).

    Never raises -- logging failures must not break a scan.
    """
    try:
        scan_id = str(scan_data.get("scan_id", "0"))
        domain = scan_data.get("domain", "unknown")
        started_at = scan_data.get("started_at", "")
        finished_at = scan_data.get("finished_at", "")
        duration_secs = scan_data.get("duration_seconds", 0)
        results = scan_data.get("results", {})
        scanner = scan_data.get("scanner", {})

        pages_visited = results.get("pages_visited", 0)
        total_endpoints = results.get("total_endpoints", 0)
        confirmed_apis = results.get("confirmed_apis", 0)

        security_count = sum(
            len(v.get("findings", []))
            for v in scanner.get("security_insights", {}).values()
        )
        ports_count = sum(
            v.get("open_ports_count", 0)
            for v in scanner.get("open_ports", {}).values()
        )
        extracted_apis_count = sum(
            v.get("findings_count", 0)
            for v in scanner.get("extracted_apis", {}).values()
        )
        api_specs_count = sum(
            v.get("findings_count", 0)
            for v in scanner.get("api_specs", {}).values()
        )
        mobile_endpoints_count = sum(
            len(v.get("findings", []))
            for v in scanner.get("mobile_endpoints", {}).values()
        )

        # Upload full payload to S3 (gzipped)
        s3_key = f"{domain}/{scan_id}.json.gz"
        payload_bytes = gzip.compress(
            json.dumps(scan_data, default=str).encode("utf-8")
        )
        _s3_client().put_object(
            Bucket=PAYLOAD_BUCKET,
            Key=s3_key,
            Body=payload_bytes,
            ContentType="application/json",
            ContentEncoding="gzip",
        )

        # Write summary to DynamoDB
        _dynamodb_table().put_item(
            Item={
                "domain": domain,
                "started_at": started_at,
                "scan_id": scan_id,
                "finished_at": finished_at,
                "duration_secs": duration_secs,
                "pages_visited": pages_visited,
                "total_endpoints": total_endpoints,
                "confirmed_apis": confirmed_apis,
                "security_count": security_count,
                "ports_count": ports_count,
                "extracted_apis_count": extracted_apis_count,
                "api_specs_count": api_specs_count,
                "mobile_endpoints_count": mobile_endpoints_count,
                "gsi_pk": "ALL",
                "s3_key": s3_key,
            }
        )

        logger.info("Scan saved to DynamoDB: scan_id=%s domain=%s", scan_id, domain)
    except Exception as exc:
        logger.warning("Failed to save scan: %s", exc)


def list_scans(domain: str) -> list[dict]:
    """List scan summaries for a domain, newest first."""
    try:
        resp = _dynamodb_table().query(
            KeyConditionExpression="#d = :d",
            ExpressionAttributeNames={"#d": "domain"},
            ExpressionAttributeValues={":d": domain},
            ScanIndexForward=False,
        )
        return [_item_to_summary(item) for item in resp.get("Items", [])]
    except Exception as exc:
        logger.warning("Failed to list scans: %s", exc)
        return []


def list_recent_scans(limit: int = 10) -> list[dict]:
    """List the most recent scans across all domains."""
    try:
        resp = _dynamodb_table().query(
            IndexName="all-scans-by-date",
            KeyConditionExpression="gsi_pk = :pk",
            ExpressionAttributeValues={":pk": "ALL"},
            ScanIndexForward=False,
            Limit=limit,
        )
        return [_item_to_summary(item) for item in resp.get("Items", [])]
    except Exception as exc:
        logger.warning("Failed to list recent scans: %s", exc)
        return []


def get_scan(domain: str, scan_id: str) -> Optional[dict]:
    """Fetch a full scan JSON from S3 by domain + scan_id."""
    try:
        s3_key = f"{domain}/{scan_id}.json.gz"
        resp = _s3_client().get_object(Bucket=PAYLOAD_BUCKET, Key=s3_key)
        raw = gzip.decompress(resp["Body"].read())
        return json.loads(raw)
    except Exception as exc:
        logger.warning("Failed to get scan: %s", exc)
        return None


def _item_to_summary(item: dict) -> dict:
    """Convert a DynamoDB item to a summary dict."""
    return {
        "scan_id": item.get("scan_id", ""),
        "domain": item.get("domain", ""),
        "started_at": item.get("started_at"),
        "finished_at": item.get("finished_at"),
        "duration_seconds": _to_int(item.get("duration_secs")),
        "pages_visited": _to_int(item.get("pages_visited")),
        "total_endpoints": _to_int(item.get("total_endpoints")),
        "confirmed_apis": _to_int(item.get("confirmed_apis")),
        "security_count": _to_int(item.get("security_count")),
        "ports_count": _to_int(item.get("ports_count")),
        "extracted_apis_count": _to_int(item.get("extracted_apis_count")),
        "api_specs_count": _to_int(item.get("api_specs_count")),
        "mobile_endpoints_count": _to_int(item.get("mobile_endpoints_count")),
    }


def _to_int(val) -> int:
    """Convert DynamoDB Decimal or other numeric types to int."""
    if val is None:
        return 0
    if isinstance(val, Decimal):
        return int(val)
    return int(val)
