/* PII/AI detection and domain classification helpers */

function getPiiMatches(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return PII_KEYWORDS.filter(kw => lower.includes(kw));
}

function getAiMatches(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const matches = AI_KEYWORDS.filter(kw => lower.includes(kw));
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
