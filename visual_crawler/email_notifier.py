"""SES email notification for scan-start events.

Sends a notification email when a user starts a scan so the developer
has visibility into usage.  Feature is disabled when NOTIFY_EMAIL is unset.
"""

import logging
import os

import boto3
import httpx

logger = logging.getLogger(__name__)

NOTIFY_EMAIL = os.getenv("NOTIFY_EMAIL", "")

_ses = None


def _ses_client():
    """Return a cached SES client."""
    global _ses
    if _ses is None:
        _ses = boto3.client("ses", region_name="us-east-1")
    return _ses


def _geolocate_ip(ip: str) -> str:
    """Return 'City, Country' for an IP address, or empty string on failure."""
    if not ip or ip in ("unknown", "127.0.0.1", "::1"):
        return ""
    try:
        resp = httpx.get(f"http://ip-api.com/json/{ip}?fields=status,city,country",
                         timeout=3)
        data = resp.json()
        if data.get("status") == "success":
            city = data.get("city", "")
            country = data.get("country", "")
            parts = [p for p in (city, country) if p]
            return ", ".join(parts)
    except Exception:
        pass
    return ""


def _format_ip(ip: str) -> str:
    """Format IP with geolocation: '1.2.3.4 (New York, United States)'."""
    geo = _geolocate_ip(ip)
    return f"{ip} ({geo})" if geo else ip


def send_scan_start_email(domain: str, scan_id: str, started_at, params: dict, client_ip: str = "unknown") -> None:
    """Send a scan-start notification via SES.

    Never raises -- notification failures must not break a scan.
    """
    if not NOTIFY_EMAIL:
        return

    try:
        subject = f"Peekaboo Scan Started: {domain}"
        ip_display = _format_ip(client_ip)

        text_body = (
            f"Scan started\n"
            f"Domain:    {domain}\n"
            f"Scan ID:   {scan_id}\n"
            f"Started:   {started_at}\n"
            f"Client IP: {ip_display}\n"
            f"Max pages: {params.get('max_pages', 'N/A')}\n"
            f"Max depth: {params.get('max_depth', 'N/A')}\n"
            f"Fast mode: {params.get('fast_mode', 'N/A')}\n"
            f"Proxy:     {params.get('use_proxy', 'N/A')}\n"
        )

        html_body = f"""\
<html><body>
<h2>Peekaboo Scan Started</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
  <tr><td><b>Domain</b></td><td>{domain}</td></tr>
  <tr><td><b>Scan ID</b></td><td>{scan_id}</td></tr>
  <tr><td><b>Started</b></td><td>{started_at}</td></tr>
  <tr><td><b>Client IP</b></td><td>{ip_display}</td></tr>
  <tr><td><b>Max Pages</b></td><td>{params.get('max_pages', 'N/A')}</td></tr>
  <tr><td><b>Max Depth</b></td><td>{params.get('max_depth', 'N/A')}</td></tr>
  <tr><td><b>Fast Mode</b></td><td>{params.get('fast_mode', 'N/A')}</td></tr>
  <tr><td><b>Proxy</b></td><td>{params.get('use_proxy', 'N/A')}</td></tr>
</table>
</body></html>"""

        _ses_client().send_email(
            Source=NOTIFY_EMAIL,
            Destination={"ToAddresses": [NOTIFY_EMAIL]},
            Message={
                "Subject": {"Data": subject},
                "Body": {
                    "Text": {"Data": text_body},
                    "Html": {"Data": html_body},
                },
            },
        )
        logger.info("Scan-start email sent for scan_id=%s domain=%s", scan_id, domain)
    except Exception as exc:
        logger.warning("Failed to send scan-start email: %s", exc)
