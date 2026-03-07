"""Sitemap parser for discovering URLs when homepage is inaccessible."""

import gzip
import logging
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

from playwright.async_api import Page

logger = logging.getLogger(__name__)


async def fetch_sitemap_urls(
    domain: str,
    page: Page,
    include_subdomains: bool = True,
    timeout: int = 15000,
) -> list[str]:
    """Fetch and parse sitemap.xml to extract URLs.

    Tries multiple common sitemap locations:
    - /sitemap.xml
    - /sitemap_index.xml
    - /sitemap.xml.gz

    Args:
        domain: The domain to fetch sitemap from (e.g., "example.com")
        page: Playwright page instance to use for fetching
        include_subdomains: Whether to include subdomain URLs

    Returns:
        List of URLs found in sitemap that are in scope
    """
    sitemap_urls = [
        f"https://{domain}/sitemap.xml",
        f"https://{domain}/sitemap_index.xml",
        f"https://{domain}/sitemap.xml.gz",
    ]

    for sitemap_url in sitemap_urls:
        try:
            logger.info(f"Attempting to fetch sitemap: {sitemap_url}")

            # Try to fetch sitemap with provided timeout
            try:
                response = await page.goto(sitemap_url, wait_until="load", timeout=timeout)
            except Exception as e:
                logger.debug(f"Failed to fetch {sitemap_url}: {e}")
                continue

            if not response or response.status >= 400:
                logger.debug(
                    f"Sitemap not found or error: {sitemap_url} "
                    f"(status: {response.status if response else 'no response'})"
                )
                continue

            # Get content
            content = await page.content()
            content_bytes = content.encode('utf-8')

            # Handle gzipped sitemap
            if sitemap_url.endswith('.gz'):
                try:
                    content_bytes = gzip.decompress(content_bytes)
                except Exception as e:
                    logger.debug(f"Failed to decompress gzipped sitemap: {e}")
                    continue

            # Parse XML and extract URLs
            urls_found = _parse_sitemap_xml(content_bytes)

            if not urls_found:
                logger.debug(f"No URLs found in sitemap: {sitemap_url}")
                continue

            # Filter URLs by scope
            in_scope_urls = _filter_urls_by_scope(
                urls_found,
                domain,
                include_subdomains
            )

            if in_scope_urls:
                logger.info(
                    f"✅ Sitemap parsed successfully: "
                    f"found {len(in_scope_urls)} in-scope URLs "
                    f"(out of {len(urls_found)} total) from {sitemap_url}"
                )
                return in_scope_urls
            else:
                logger.debug(f"No in-scope URLs found in sitemap: {sitemap_url}")

        except Exception as e:
            logger.debug(f"Error during sitemap fetch for {sitemap_url}: {e}")
            continue

    # No sitemap worked
    logger.info("Sitemap fallback failed: no sitemaps found or no valid URLs extracted")
    return []


def _parse_sitemap_xml(xml_bytes: bytes) -> list[str]:
    """Parse sitemap XML and extract all URLs.

    Handles both regular sitemaps and sitemap indexes.
    Handles sitemaps with and without XML namespaces.

    Args:
        xml_bytes: Raw XML content as bytes

    Returns:
        List of URLs found in the sitemap
    """
    try:
        root = ET.fromstring(xml_bytes)
    except Exception as e:
        logger.debug(f"Failed to parse sitemap XML: {e}")
        return []

    urls_found = []

    # Check for sitemap namespace
    ns = {'ns': 'http://www.sitemaps.org/schemas/sitemap/0.9'}

    # Try with namespace first (standard sitemap format)
    for loc in root.findall('.//ns:loc', ns):
        if loc.text:
            urls_found.append(loc.text)

    # If no URLs found, try without namespace (some sitemaps don't use it)
    if not urls_found:
        for loc in root.findall('.//loc'):
            if loc.text:
                urls_found.append(loc.text)

    return urls_found


def _filter_urls_by_scope(
    urls: list[str],
    domain: str,
    include_subdomains: bool
) -> list[str]:
    """Filter URLs to only include those in scope.

    Args:
        urls: List of URLs to filter
        domain: The target domain (e.g., "example.com")
        include_subdomains: Whether to include subdomain URLs

    Returns:
        List of URLs that are in scope
    """
    in_scope = []

    for url in urls:
        try:
            parsed = urlparse(url)
            host = (parsed.hostname or "").lower()

            # Check if URL is in scope
            if host == domain or (include_subdomains and host.endswith(f".{domain}")):
                in_scope.append(url)

        except Exception as e:
            logger.debug(f"Failed to parse URL {url}: {e}")
            continue

    return in_scope
