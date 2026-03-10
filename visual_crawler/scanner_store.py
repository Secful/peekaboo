"""In-memory store for external scanner results, keyed by domain."""

import time
import threading
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

_DEFAULT_TTL_SECS = 4 * 60 * 60  # 4 hours


@dataclass
class _DomainData:
    """All scanner results for one domain."""
    created_at: float = field(default_factory=time.time)
    security_insights: dict[str, dict] = field(default_factory=dict)
    open_ports: dict[str, dict] = field(default_factory=dict)
    js_resources: dict[str, dict] = field(default_factory=dict)
    agentic: dict[str, dict] = field(default_factory=dict)


class ScannerStore:
    """Thread-safe, TTL-aware in-memory store for scanner results."""

    def __init__(self, ttl_secs: int = _DEFAULT_TTL_SECS):
        self._data: dict[str, _DomainData] = {}
        self._ttl = ttl_secs
        self._lock = threading.Lock()

    def _get_or_create(self, domain: str) -> _DomainData:
        if domain not in self._data:
            self._data[domain] = _DomainData()
        return self._data[domain]

    def store_security_insights(self, domain: str, subdomain: str, payload: dict) -> None:
        with self._lock:
            self._get_or_create(domain).security_insights[subdomain] = payload

    def store_open_ports(self, domain: str, subdomain: str, payload: dict) -> None:
        with self._lock:
            self._get_or_create(domain).open_ports[subdomain] = payload

    def store_js_resources(self, domain: str, subdomain: str, payload: dict) -> None:
        with self._lock:
            self._get_or_create(domain).js_resources[subdomain] = payload

    def store_agentic(self, domain: str, subdomain: str, payload: dict) -> None:
        with self._lock:
            self._get_or_create(domain).agentic[subdomain] = payload

    def get_all_for_domain(self, domain: str) -> list[dict]:
        """Return all stored payloads for a domain as a flat list."""
        with self._lock:
            data = self._data.get(domain)
            if not data:
                return []
            payloads = []
            payloads.extend(data.security_insights.values())
            payloads.extend(data.open_ports.values())
            payloads.extend(data.js_resources.values())
            payloads.extend(data.agentic.values())
            return list(payloads)

    def cleanup_expired(self) -> int:
        """Remove entries older than TTL. Returns count of removed domains."""
        cutoff = time.time() - self._ttl
        with self._lock:
            expired = [d for d, v in self._data.items() if v.created_at < cutoff]
            for d in expired:
                del self._data[d]
        if expired:
            logger.info(f"Scanner store: cleaned up {len(expired)} expired domain(s)")
        return len(expired)


scanner_store = ScannerStore()