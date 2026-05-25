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

// Enhanced PII detection with regex patterns
const PII_REGEX_PATTERNS = [
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
  { name: 'credit_card', pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g, validate: true },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'phone', pattern: /\b(?:\+1[-.]?)?\(?([0-9]{3})\)?[-.]?([0-9]{3})[-.]?([0-9]{4})\b/g }
];

const AUTH_TOKEN_PATTERNS = [
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  { name: 'bearer', pattern: /Bearer\s+[A-Za-z0-9_\-\.]+/gi },
  { name: 'api_key_stripe', pattern: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g },
  { name: 'api_key_openai', pattern: /\bsk-[A-Za-z0-9]{48}\b/g },
  { name: 'basic_auth', pattern: /Authorization:\s*Basic\s+[A-Za-z0-9+\/=]+/gi },
  { name: 'oauth_token', pattern: /(?:access_token|refresh_token)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-\.]{32,}/gi }
];

function luhnCheck(cardNumber) {
  const digits = cardNumber.replace(/\D/g, '');
  let sum = 0, isEven = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i]);
    if (isEven) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

function getPiiRegexMatches(text) {
  if (!text) return [];
  const matches = [];
  PII_REGEX_PATTERNS.forEach(pattern => {
    const found = text.match(pattern.pattern);
    if (found) {
      if (pattern.validate) {
        const valid = found.filter(m => luhnCheck(m));
        if (valid.length > 0) matches.push(pattern.name);
      } else {
        matches.push(pattern.name);
      }
    }
  });
  return matches;
}

function getAuthTokenMatches(text, isBinary = false) {
  if (!text) return [];
  let searchText = text;
  if (isBinary) {
    try {
      searchText = decodeHexToString(text);
    } catch { /* Search hex directly */ }
  }
  const matches = [];
  AUTH_TOKEN_PATTERNS.forEach(pattern => {
    if (searchText.match(pattern.pattern)) {
      matches.push(pattern.name);
    }
  });
  return matches;
}

function decodeHexToString(hex) {
  const bytes = hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16));
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
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
