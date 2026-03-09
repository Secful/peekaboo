/* PII/AI detection and domain classification helpers */

function _extractJsonKeys(text) {
  /* Return only JSON keys from a string (recursive). Returns empty string if not valid JSON. */
  if (!text) return '';
  const trimmed = text.trim();
  if ((trimmed[0] !== '{' && trimmed[0] !== '[')) return '';
  try {
    const obj = JSON.parse(trimmed);
    const keys = [];
    (function walk(v) {
      if (v && typeof v === 'object') {
        if (Array.isArray(v)) { v.forEach(walk); }
        else { for (const k of Object.keys(v)) { keys.push(k); walk(v[k]); } }
      }
    })(obj);
    return keys.join(' ');
  } catch { return ''; }
}

function getPiiMatches(text, jsonKeysOnly) {
  if (!text) return [];
  const target = jsonKeysOnly ? _extractJsonKeys(text) : text;
  const lower = target.toLowerCase();
  return PII_KEYWORDS.filter(kw => new RegExp(`(?:^|[^a-z])${kw}(?:$|[^a-z])`).test(lower));
}

function getAiMatches(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const matches = AI_KEYWORDS.filter(kw => new RegExp(`(?:^|[^a-z])${kw}(?:$|[^a-z])`).test(lower));
  for (const kw of AI_BOUNDED) {
    if (new RegExp(`(?:^|[^a-z])${kw}(?:$|[^a-z])`).test(lower)) matches.push(kw);
  }
  return matches;
}

function isAiRelated(text) {
  return getAiMatches(text).length > 1;
}

// Domain classification helpers
function isDomainHost(host) {
  if (!host || !appState.targetDomain) return false;
  const h = host.toLowerCase();
  const d = appState.targetDomain.toLowerCase();
  return h === d || h.endsWith('.' + d);
}

function isDomainEndpoint(endpoint) {
  return endpoint && isDomainHost(endpoint.host);
}

function isSubdomainEndpoint(host) {
  return isDomainHost(host);
}

function apiHostBelongsToDomain(apiUrl) {
  if (!appState.targetDomain) return false;
  const trimmed = apiUrl.trim();
  // Relative paths (/api/users, /submit, etc.) belong to the subdomain itself
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    return isSubdomainEndpoint(host);
  } catch {
    // Not a full URL and not a /-path — treat as domain (e.g. "api/users")
    return true;
  }
}

// Subdomain helpers
function normalizeSubdomains(data) {
  return Array.isArray(data) ? data : (data.subdomains || data.results || []);
}

function getSubdomainName(sub) {
  return sub.subdomain || sub.domain || sub.host || '—';
}

function getSubdomainStatusClass(status) {
  if (status >= 200 && status < 300) return 'subdomain-status-2xx';
  if (status >= 300 && status < 400) return 'subdomain-status-3xx';
  if (status >= 400 && status < 500) return 'subdomain-status-4xx';
  if (status >= 500) return 'subdomain-status-5xx';
  return 'subdomain-status-0';
}
