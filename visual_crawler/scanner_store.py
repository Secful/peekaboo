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
    extracted_apis: dict[str, dict] = field(default_factory=dict)
    api_specs: dict[str, dict] = field(default_factory=dict)
    mobile_endpoints: dict[str, dict] = field(default_factory=dict)
    git_findings: dict[str, dict] = field(default_factory=dict)
    js_secrets: dict[str, dict] = field(default_factory=dict)


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

    def store_js_secrets(self, domain: str, subdomain: str, payload: dict) -> None:
        with self._lock:
            self._get_or_create(domain).js_secrets[subdomain] = payload

    def store_extracted_apis(self, domain: str, subdomain: str, payload: dict) -> None:
        with self._lock:
            self._get_or_create(domain).extracted_apis[subdomain] = payload

    def store_api_specs(self, domain: str, subdomain: str, payload: dict) -> None:
        with self._lock:
            self._get_or_create(domain).api_specs[subdomain] = payload

    def store_mobile_endpoints(self, domain: str, package_name: str, payload: dict) -> None:
        with self._lock:
            data = self._get_or_create(domain)
            existing = data.mobile_endpoints.get(package_name)
            if existing:
                # Merge new findings into existing, dedup by (method, url)
                old_findings = existing.get("findings", [])
                seen = {(f.get("method"), f.get("url")) for f in old_findings}
                for f in payload.get("findings", []):
                    if (f.get("method"), f.get("url")) not in seen:
                        old_findings.append(f)
                        seen.add((f.get("method"), f.get("url")))
                existing["findings"] = old_findings
                existing["findings_count"] = len(old_findings)
                # Keep the richer metadata (non-zero values)
                for k in ("decompiled_classes", "analyzed_classes",
                          "app_version", "scan_duration_secs"):
                    if payload.get(k):
                        existing[k] = payload[k]
            else:
                data.mobile_endpoints[package_name] = payload

    def store_git_findings(self, domain: str, key: str, payload: dict) -> None:
        with self._lock:
            self._get_or_create(domain).git_findings[key] = payload

    def get_security_insights(self, domain: str) -> dict[str, dict]:
        with self._lock:
            data = self._data.get(domain)
            return dict(data.security_insights) if data else {}

    def get_open_ports(self, domain: str) -> dict[str, dict]:
        with self._lock:
            data = self._data.get(domain)
            return dict(data.open_ports) if data else {}

    def get_js_resources(self, domain: str) -> dict[str, dict]:
        with self._lock:
            data = self._data.get(domain)
            return dict(data.js_resources) if data else {}

    def get_agentic(self, domain: str) -> dict[str, dict]:
        with self._lock:
            data = self._data.get(domain)
            return dict(data.agentic) if data else {}

    def get_extracted_apis(self, domain: str) -> dict[str, dict]:
        with self._lock:
            data = self._data.get(domain)
            return dict(data.extracted_apis) if data else {}

    def get_api_specs(self, domain: str) -> dict[str, dict]:
        with self._lock:
            data = self._data.get(domain)
            return dict(data.api_specs) if data else {}

    def get_js_secrets(self, domain: str) -> dict[str, dict]:
        with self._lock:
            data = self._data.get(domain)
            return dict(data.js_secrets) if data else {}

    def get_mobile_endpoints(self, domain: str) -> dict[str, dict]:
        with self._lock:
            data = self._data.get(domain)
            return dict(data.mobile_endpoints) if data else {}

    def get_git_findings(self, domain: str) -> dict[str, dict]:
        with self._lock:
            data = self._data.get(domain)
            return dict(data.git_findings) if data else {}

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
            payloads.extend(data.extracted_apis.values())
            payloads.extend(data.api_specs.values())
            payloads.extend(data.mobile_endpoints.values())
            payloads.extend(data.git_findings.values())
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