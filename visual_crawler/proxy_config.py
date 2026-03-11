"""Proxy configuration loading from AWS Secrets Manager."""

import json
import logging
import os
import random
from typing import Optional

from .proxy_pool import ProxyPool

logger = logging.getLogger(__name__)


def _get_proxy_secret() -> Optional[dict]:
    """Fetch peekaboo/proxy secret from AWS Secrets Manager (cached)."""
    try:
        import boto3
        client = boto3.client('secretsmanager', region_name=os.getenv('AWS_DEFAULT_REGION', 'us-east-1'))
        resp = client.get_secret_value(SecretId='peekaboo/proxy')
        return json.loads(resp['SecretString'])
    except Exception as e:
        logger.info(f"Could not load proxy secret: {e}")
        return None


def _load_proxy_config() -> Optional[dict]:
    """Load proxy credentials from AWS Secrets Manager.

    Returns Playwright-compatible proxy dict, or None if unavailable.
    """
    try:
        secret = _get_proxy_secret()
        if not secret:
            return None

        port = secret['port']
        # Warn if the port looks like a CDP/WebSocket port rather than HTTP proxy
        if str(port) == '9222':
            print(f"⚠️ Proxy port is 9222 (CDP/WebSocket port). HTTP proxy usually uses 22225. "
                  f"Local proxy fallback may fail with ERR_EMPTY_RESPONSE.", flush=True)
            logger.warning("Proxy secret has port=9222 (Scraping Browser CDP port). "
                           "If remote browser fails, local proxy fallback will also fail. "
                           "Set port to 22225 in peekaboo/proxy secret for HTTP proxy support.")

        proxy_config = {
            "server": f"http://{secret['host']}:{port}",
            "username": secret['username'],
            "password": secret['password'],
        }
        print(f"✅ Single proxy loaded from Secrets Manager: {secret['host']}:{port}", flush=True)
        logger.info(f"Proxy loaded from Secrets Manager: {secret['host']}:{port}")
        return proxy_config
    except Exception as e:
        print(f"⚠️ No single proxy configured: {e}", flush=True)
        logger.info(f"No proxy configured: {e}")
        return None


def _load_brightdata_proxy_pool() -> Optional[ProxyPool]:
    """Load BrightData proxy pool from AWS Secrets Manager.

    Expected secret format for proxy pool:
    {
        "host": "brd.superproxy.io",
        "port": "22225",
        "username": "brd-customer-{id}-zone-{zone}",
        "password": "{password}",
        "pool_size": 5  # Optional, number of proxy sessions to create
    }

    Or for multiple proxies:
    {
        "proxies": [
            {"host": "...", "port": "...", "username": "...", "password": "..."},
            {"host": "...", "port": "...", "username": "...", "password": "..."}
        ]
    }

    Returns ProxyPool or None if unavailable.
    """
    try:
        secret = _get_proxy_secret()
        if not secret:
            return None

        proxies = []

        # Check if it's a multi-proxy configuration
        if 'proxies' in secret:
            for proxy_config in secret['proxies']:
                proxies.append({
                    "server": f"http://{proxy_config['host']}:{proxy_config['port']}",
                    "username": proxy_config['username'],
                    "password": proxy_config['password'],
                })
        else:
            # Single proxy with session pool
            pool_size = secret.get('pool_size', 5)
            base_username = secret['username']

            # Extract zone type from username for debugging
            zone_info = "unknown"
            if '-zone-' in base_username:
                zone_part = base_username.split('-zone-')[1].split('-')[0]
                zone_info = zone_part
            print(f"🔍 Proxy zone: {zone_info}", flush=True)

            # BrightData: Add session ID to username for sticky sessions
            # Format: brd-customer-{id}-zone-{zone}-session-{random}
            for _ in range(pool_size):
                session_id = random.randint(100000, 999999)
                username_with_session = f"{base_username}-session-{session_id}"

                proxies.append({
                    "server": f"http://{secret['host']}:{secret['port']}",
                    "username": username_with_session,
                    "password": secret['password'],
                })

        if proxies:
            print(f"✅ Loaded BrightData proxy pool with {len(proxies)} proxies", flush=True)
            logger.info(f"Loaded BrightData proxy pool with {len(proxies)} proxies")
            return ProxyPool(proxies)
        else:
            print("⚠️ No proxies found in configuration", flush=True)
            return None

    except Exception as e:
        print(f"⚠️ No BrightData proxy pool configured: {e}", flush=True)
        logger.info(f"No BrightData proxy pool configured: {e}")
        return None


def _load_scraping_browser_url() -> Optional[str]:
    """Construct BrightData Scraping Browser URL from existing proxy credentials.

    Checks the peekaboo/proxy secret for enable_scraping_browser flag.
    If enabled, extracts customer ID and password to construct WebSocket URL.

    Returns:
        WebSocket URL for Chrome DevTools Protocol connection, or None if disabled
    """
    try:
        secret = _get_proxy_secret()
        if not secret:
            return None

        # Check if Scraping Browser is enabled
        if not secret.get('enable_scraping_browser', False):
            logger.info("Scraping Browser not enabled in secret config")
            return None

        # Extract customer ID from username
        # Format: brd-customer-{id}-zone-{zone}
        username = secret['username']
        if 'brd-customer-' not in username:
            logger.warning("Invalid BrightData username format")
            return None

        customer_id = username.split('brd-customer-')[1].split('-zone-')[0]
        password = secret['password']
        zone = secret.get('scraping_browser_zone', 'scraping_browser1')

        # Construct WebSocket URL for Chrome DevTools Protocol
        url = f"wss://brd-customer-{customer_id}-zone-{zone}:{password}@brd.superproxy.io:9222"

        print(f"🌐 BrightData Scraping Browser enabled (zone: {zone}, customer: {customer_id})", flush=True)
        logger.info(f"BrightData Scraping Browser enabled — zone: {zone}, customer: {customer_id}")
        logger.info(f"Scraping Browser WSS URL: wss://brd-customer-{customer_id}-zone-{zone}:***@brd.superproxy.io:9222")
        return url

    except Exception as e:
        logger.warning(f"Could not load scraping browser config: {e}")
        return None
