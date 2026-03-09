"""S3-backed scan activity logger.

Persists scan results to S3 so past scans can be queried by domain.
Path structure: scans/{domain}/{timestamp}_{scan_id}.json
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


def _get_bucket_name() -> str:
    """Return the S3 bucket name, falling back to account-suffixed default."""
    bucket = os.getenv("SCAN_LOG_BUCKET")
    if bucket:
        return bucket
    try:
        account_id = boto3.client("sts").get_caller_identity()["Account"]
        return f"peekaboo-scan-logs-{account_id}"
    except Exception:
        return "peekaboo-scan-logs"


def _s3_client():
    return boto3.client("s3")


def save_scan(scan_data: dict) -> None:
    """Write a scan result JSON to S3.

    Never raises — logging failures must not break a scan.
    """
    try:
        domain = scan_data.get("domain", "unknown")
        scan_id = scan_data.get("scan_id", 0)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        key = f"scans/{domain}/{ts}_{scan_id}.json"

        _s3_client().put_object(
            Bucket=_get_bucket_name(),
            Key=key,
            Body=json.dumps(scan_data, default=str),
            ContentType="application/json",
        )
        logger.info("Scan saved to s3://%s/%s", _get_bucket_name(), key)
    except Exception as exc:
        logger.warning("Failed to save scan to S3: %s", exc)


def _fetch_scan_summary(bucket: str, key: str) -> dict:
    """Fetch a single scan object and return its summary dict."""
    # key format: scans/{domain}/{timestamp}_{scan_id}.json
    parts = key.split("/")
    domain = parts[1] if len(parts) >= 3 else "unknown"
    filename = parts[-1]
    try:
        scan_obj = _s3_client().get_object(Bucket=bucket, Key=key)
        data = json.loads(scan_obj["Body"].read())
        return {
            "scan_key": filename,
            "scan_id": data.get("scan_id"),
            "domain": data.get("domain", domain),
            "started_at": data.get("started_at"),
            "finished_at": data.get("finished_at"),
            "duration_seconds": data.get("duration_seconds"),
            "total_endpoints": data.get("results", {}).get("total_endpoints", 0),
            "confirmed_apis": data.get("results", {}).get("confirmed_apis", 0),
            "pages_visited": data.get("results", {}).get("pages_visited", 0),
        }
    except Exception:
        return {"scan_key": filename, "domain": domain}


def list_scans(domain: str) -> list[dict]:
    """List scan summaries for a domain (S3 prefix listing)."""
    return _list_scans_by_prefix(f"scans/{domain}/")


def list_recent_scans(limit: int = 10) -> list[dict]:
    """List the most recent scans across all domains."""
    return _list_scans_by_prefix("scans/", limit=limit)


def _list_scans_by_prefix(prefix: str, limit: int = 0) -> list[dict]:
    """List scan summaries under an S3 prefix, newest first."""
    try:
        bucket = _get_bucket_name()
        s3 = _s3_client()
        # Collect all object keys under prefix
        all_objects = []
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            all_objects.extend(page.get("Contents", []))

        # Sort by key descending (keys start with timestamp, so lexicographic = chronological)
        # key format: scans/{domain}/{YYYYMMDDTHHMMSSz}_{id}.json
        all_objects.sort(key=lambda o: o["Key"].rsplit("/", 1)[-1], reverse=True)

        if limit > 0:
            all_objects = all_objects[:limit]

        scans = [_fetch_scan_summary(bucket, obj["Key"]) for obj in all_objects]
        return scans
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "NoSuchBucket":
            logger.warning("Scan log bucket does not exist yet")
            return []
        logger.warning("Failed to list scans: %s", exc)
        return []
    except Exception as exc:
        logger.warning("Failed to list scans: %s", exc)
        return []


def get_scan(domain: str, scan_key: str) -> Optional[dict]:
    """Fetch a full scan JSON from S3."""
    try:
        bucket = _get_bucket_name()
        key = f"scans/{domain}/{scan_key}"
        resp = _s3_client().get_object(Bucket=bucket, Key=key)
        return json.loads(resp["Body"].read())
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "NoSuchKey":
            return None
        logger.warning("Failed to get scan: %s", exc)
        return None
    except Exception as exc:
        logger.warning("Failed to get scan: %s", exc)
        return None
