/* Real-Time HTTP Header Analysis — heatmap + security findings
   Only analyzes responses from the target domain & its subdomains. */

// ── Security Rules ──────────────────────────────────────────────────
const HEADER_SECURITY_RULES = [
  {
    id: 'missing-hsts', severity: 'high', category: 'Missing HSTS',
    problem: "This API doesn't enforce HTTPS connections",
    impact: "Attackers on the same network (coffee shop, airport) can intercept traffic by downgrading HTTPS to HTTP",
    fix: 'Add header: Strict-Transport-Security: max-age=31536000; includeSubDomains',
    check: (h) => !h['strict-transport-security'],
  },
  {
    id: 'missing-xcto', severity: 'medium', category: 'Missing X-Content-Type-Options',
    problem: "The browser is allowed to guess content types",
    impact: "Attackers can trick the browser into executing uploaded files as scripts (MIME-sniffing attack)",
    fix: 'Add header: X-Content-Type-Options: nosniff',
    check: (h) => !h['x-content-type-options'],
  },
  {
    id: 'missing-xfo', severity: 'medium', category: 'Missing X-Frame-Options',
    problem: "This page can be embedded in iframes on any site",
    impact: "Attackers can overlay invisible iframes to trick users into clicking hidden buttons (clickjacking)",
    fix: 'Add header: X-Frame-Options: DENY (or SAMEORIGIN if iframes are needed within the same site)',
    check: (h) => !h['x-frame-options'],
  },
  {
    id: 'missing-csp', severity: 'medium', category: 'Missing Content-Security-Policy',
    problem: "No restrictions on what scripts and resources can load",
    impact: "If an attacker injects content, the browser has no policy to block malicious scripts from running",
    fix: "Add header: Content-Security-Policy: default-src 'self' — then expand allowed sources as needed",
    check: (h) => !h['content-security-policy'],
  },
  {
    id: 'server-leakage', severity: 'medium', category: 'Server Version Leakage',
    problem: "The server reveals its exact software version",
    impact: "Attackers can look up known vulnerabilities for this specific version and exploit them directly",
    fix: 'Remove the version from the Server header (e.g. send "Server: nginx" instead of "Server: nginx/1.21.3")',
    check: (h) => {
      const sv = h['server'] || '';
      return /\/\d/.test(sv); // e.g. nginx/1.21.3
    },
  },
  {
    id: 'tech-leakage', severity: 'medium', category: 'Technology Stack Leakage',
    problem: "Response headers expose the backend technology stack",
    impact: "Knowing the framework (Express, ASP.NET, etc.) lets attackers narrow down attack techniques",
    fix: 'Remove the X-Powered-By header entirely from server responses',
    check: (h) => !!h['x-powered-by'],
  },
  {
    id: 'cors-wildcard', severity: 'high', category: 'CORS Wildcard',
    problem: "Any website in the world can make requests to this API",
    impact: "A malicious site can read API responses from the user's browser session, potentially stealing data",
    fix: 'Replace Access-Control-Allow-Origin: * with a whitelist of trusted origins',
    check: (h) => (h['access-control-allow-origin'] || '').trim() === '*',
  },
  {
    id: 'insecure-cookies', severity: 'high', category: 'Insecure Cookies',
    problem: "Session cookies are missing critical security flags",
    impact: "Missing Secure: cookies sent over HTTP. Missing HttpOnly: JavaScript can steal them. Missing SameSite: vulnerable to CSRF",
    fix: 'Set all cookies with: Secure; HttpOnly; SameSite=Lax (or SameSite=Strict for sensitive cookies)',
    check: (h) => {
      const sc = h['set-cookie'];
      if (!sc) return false;
      const cookies = Array.isArray(sc) ? sc : [sc];
      return cookies.some(c => {
        const lc = c.toLowerCase();
        return !lc.includes('secure') || !lc.includes('httponly') || !lc.includes('samesite');
      });
    },
  },
  {
    id: 'no-cache-control', severity: 'low', category: 'No Cache Control',
    problem: "API responses may be stored in browser/proxy caches",
    impact: "Sensitive data (user info, tokens) could be cached and accessible to other users on shared machines",
    fix: 'Add header: Cache-Control: no-store, no-cache, must-revalidate (for sensitive endpoints)',
    check: (h) => !h['cache-control'],
  },
  {
    id: 'no-rate-limit', severity: 'info', category: 'No Rate Limiting',
    problem: "No rate limiting headers detected on this API",
    impact: "Without throttling, the API is vulnerable to brute-force attacks, credential stuffing, and abuse",
    fix: 'Implement rate limiting and expose headers: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After',
    check: (h) => !h['x-ratelimit-limit'] && !h['x-rate-limit-limit'] && !h['ratelimit-limit'] && !h['retry-after'],
  },
];

const _KNOWN_SECURITY_HEADERS = new Set([
  'strict-transport-security', 'content-security-policy', 'x-content-type-options',
  'x-frame-options', 'referrer-policy', 'permissions-policy',
]);

const _HEADER_CATEGORIES = {
  'strict-transport-security': 'Security', 'content-security-policy': 'Security',
  'x-content-type-options': 'Security', 'x-frame-options': 'Security',
  'referrer-policy': 'Security', 'permissions-policy': 'Security',
  'x-xss-protection': 'Security',
  'cache-control': 'Caching', 'expires': 'Caching', 'pragma': 'Caching',
  'etag': 'Caching', 'last-modified': 'Caching', 'age': 'Caching', 'vary': 'Caching',
  'access-control-allow-origin': 'CORS', 'access-control-allow-methods': 'CORS',
  'access-control-allow-headers': 'CORS', 'access-control-expose-headers': 'CORS',
  'access-control-max-age': 'CORS', 'access-control-allow-credentials': 'CORS',
  'authorization': 'Auth', 'www-authenticate': 'Auth', 'set-cookie': 'Auth',
  'x-ratelimit-limit': 'Auth', 'x-ratelimit-remaining': 'Auth',
};

function _headerCategory(name) {
  return _HEADER_CATEGORIES[name] || 'Info';
}

const _HEADER_DESCRIPTIONS = {
  // Security
  'strict-transport-security': 'Forces browsers to use HTTPS for all future requests to this domain',
  'content-security-policy': 'Controls which resources the browser is allowed to load, preventing XSS and injection attacks',
  'x-content-type-options': 'Prevents browsers from guessing (MIME-sniffing) the content type, must be served as declared',
  'x-frame-options': 'Controls whether the page can be embedded in iframes, preventing clickjacking',
  'referrer-policy': 'Controls how much referrer URL info is sent when navigating away from the page',
  'permissions-policy': 'Controls which browser features (camera, mic, geolocation) the page is allowed to use',
  'x-xss-protection': 'Legacy browser XSS filter toggle (largely replaced by CSP)',
  // Caching
  'cache-control': 'Directives for how browsers and proxies should cache this response',
  'expires': 'Date/time after which the response is considered stale',
  'pragma': 'Legacy HTTP/1.0 cache directive, typically "no-cache"',
  'etag': 'Unique version identifier for the resource, used for conditional requests',
  'last-modified': 'Timestamp when the resource was last changed on the server',
  'age': 'Time in seconds the response has been in a proxy cache',
  'vary': 'Lists request headers that affect which cached version to serve',
  // CORS
  'access-control-allow-origin': 'Specifies which origins are permitted to read the response',
  'access-control-allow-methods': 'Lists HTTP methods allowed for cross-origin requests',
  'access-control-allow-headers': 'Lists request headers allowed in cross-origin requests',
  'access-control-expose-headers': 'Lists response headers the browser is allowed to read in cross-origin requests',
  'access-control-max-age': 'How long the browser can cache preflight request results (in seconds)',
  'access-control-allow-credentials': 'Whether cross-origin requests can include cookies or auth headers',
  // Auth & Cookies
  'set-cookie': 'Sends a cookie from the server to the browser for session tracking or state',
  'www-authenticate': 'Indicates the authentication scheme the server expects (e.g. Basic, Bearer)',
  'authorization': 'Carries credentials (token, API key) from client to server',
  'x-ratelimit-limit': 'Maximum number of requests allowed in the current time window',
  'x-ratelimit-remaining': 'Number of requests remaining in the current rate-limit window',
  'x-rate-limit-limit': 'Maximum requests allowed per time window (alternate naming)',
  'ratelimit-limit': 'Standardized rate limit: max requests per window (RFC draft)',
  'retry-after': 'How long to wait before retrying, after a 429 or 503 response',
  // Common response
  'content-type': 'Media type of the response body (e.g. application/json, text/html)',
  'content-length': 'Size of the response body in bytes',
  'content-encoding': 'Compression algorithm applied to the response (e.g. gzip, br)',
  'transfer-encoding': 'How the response body is transferred (e.g. chunked)',
  'connection': 'Whether the network connection stays open after this response',
  'server': 'Identifies the software running the web server',
  'date': 'Timestamp when the server generated the response',
  'x-powered-by': 'Reveals the backend framework or technology (e.g. Express, ASP.NET)',
  'x-request-id': 'Unique identifier for tracing a request across services',
  'x-correlation-id': 'Tracks a request across multiple microservices for debugging',
  'accept-ranges': 'Whether the server supports partial content requests (byte ranges)',
  'content-disposition': 'Suggests how the browser should handle the response (inline vs download)',
  'location': 'URL to redirect to, used with 3xx status codes',
  'link': 'Provides relationships to other resources (e.g. pagination, preload hints)',
  'x-dns-prefetch-control': 'Controls whether the browser should prefetch DNS for links on the page',
  'expect-ct': 'Enforces Certificate Transparency requirements for the domain',
  'alt-svc': 'Advertises alternative services (e.g. HTTP/3 or QUIC endpoint)',
  'nel': 'Network Error Logging: instructs the browser to report network errors',
  'report-to': 'Configures endpoint groups for receiving browser-generated reports',
  'cross-origin-opener-policy': 'Controls whether the page shares a browsing context with cross-origin popups',
  'cross-origin-embedder-policy': 'Controls whether the page can load cross-origin resources without CORS',
  'cross-origin-resource-policy': 'Controls which origins can embed this resource',
  'timing-allow-origin': 'Controls which origins can read detailed timing info via the Resource Timing API',
  // Client Hints (sec-ch-*)
  'sec-ch-ua': 'Browser brand and version hints sent by the client (User-Agent Client Hints)',
  'sec-ch-ua-mobile': 'Indicates whether the browser is on a mobile device',
  'sec-ch-ua-platform': 'Operating system the browser is running on (e.g. Windows, macOS, Android)',
  'sec-ch-ua-platform-version': 'OS version the browser is running on',
  'sec-ch-ua-full-version': 'Full browser version string via Client Hints',
  'sec-ch-ua-full-version-list': 'Full version list for all browser brands',
  'sec-ch-ua-arch': 'CPU architecture of the client device (e.g. x86, ARM)',
  'sec-ch-ua-bitness': 'CPU bitness of the client (e.g. 32, 64)',
  'sec-ch-ua-model': 'Device model (e.g. Pixel 7, Galaxy S23) — typically empty on desktop',
  'sec-ch-prefers-color-scheme': 'User preference for light or dark color scheme',
  'sec-ch-prefers-reduced-motion': 'User preference for reduced motion/animations',
  // Fetch metadata (sec-fetch-*)
  'sec-fetch-dest': 'The destination of the request (e.g. document, script, image, empty for API calls)',
  'sec-fetch-mode': 'The mode of the request (e.g. navigate, cors, no-cors, same-origin)',
  'sec-fetch-site': 'Relationship between request origin and target (same-origin, same-site, cross-site, none)',
  'sec-fetch-user': 'Whether the request was triggered by a user action (e.g. click, form submit)',
  // Common request headers
  'accept': 'Media types the client is willing to receive (e.g. text/html, application/json)',
  'accept-encoding': 'Compression algorithms the client supports (e.g. gzip, br, deflate)',
  'accept-language': 'Preferred languages for the response (e.g. en-US, fr)',
  'host': 'The domain name of the server being requested',
  'user-agent': 'Identifies the client software (browser name, version, OS)',
  'referer': 'URL of the page that linked to this request',
  'origin': 'Origin (scheme + host + port) that initiated the request, sent with CORS and POST requests',
  'cookie': 'Cookies previously set by the server, sent back with each request',
  'if-none-match': 'ETag value from a previous response — server returns 304 if unchanged',
  'if-modified-since': 'Timestamp from a previous response — server returns 304 if not modified since',
  'upgrade-insecure-requests': 'Tells the server the client prefers HTTPS versions of resources',
  'dnt': 'Do Not Track preference (1 = opt out of tracking, 0 = consent)',
  'priority': 'Request priority hint for the browser fetch scheduler (e.g. u=0 for high, u=3 for low)',
};

function _headerDescription(name) {
  return _HEADER_DESCRIPTIONS[name] || '';
}

const _MDN_HEADERS = new Set([
  'accept','accept-ch','accept-encoding','accept-language','accept-patch','accept-post','accept-ranges',
  'access-control-allow-credentials','access-control-allow-headers','access-control-allow-methods',
  'access-control-allow-origin','access-control-expose-headers','access-control-max-age',
  'access-control-request-headers','access-control-request-method','activate-storage-access','age','allow',
  'alt-svc','alt-used','attribution-reporting-eligible','attribution-reporting-register-source',
  'attribution-reporting-register-trigger','authorization','available-dictionary','cache-control',
  'clear-site-data','connection','content-digest','content-disposition','content-dpr','content-encoding',
  'content-language','content-length','content-location','content-range','content-security-policy',
  'content-security-policy-report-only','content-type','cookie','critical-ch','cross-origin-embedder-policy',
  'cross-origin-embedder-policy-report-only','cross-origin-opener-policy','cross-origin-resource-policy',
  'date','device-memory','dictionary-id','dnt','downlink','dpr','early-data','ect','etag','expect',
  'expect-ct','expires','forwarded','from','host','idempotency-key','if-match','if-modified-since',
  'if-none-match','if-range','if-unmodified-since','integrity-policy','integrity-policy-report-only',
  'keep-alive','last-modified','link','location','max-forwards','nel','no-vary-search',
  'observe-browsing-topics','origin','origin-agent-cluster','permissions-policy','pragma','prefer',
  'preference-applied','priority','proxy-authenticate','proxy-authorization','range','referer',
  'referrer-policy','refresh','report-to','repr-digest','retry-after','rtt','save-data',
  'sec-browsing-topics','sec-ch-device-memory','sec-ch-dpr','sec-ch-prefers-color-scheme',
  'sec-ch-prefers-reduced-motion','sec-ch-prefers-reduced-transparency','sec-ch-ua','sec-ch-ua-arch',
  'sec-ch-ua-bitness','sec-ch-ua-form-factors','sec-ch-ua-full-version','sec-ch-ua-full-version-list',
  'sec-ch-ua-mobile','sec-ch-ua-model','sec-ch-ua-platform','sec-ch-ua-platform-version','sec-ch-ua-wow64',
  'sec-ch-viewport-height','sec-ch-viewport-width','sec-ch-width','sec-fetch-dest','sec-fetch-mode',
  'sec-fetch-site','sec-fetch-storage-access','sec-fetch-user','sec-gpc','sec-private-state-token',
  'sec-private-state-token-crypto-version','sec-private-state-token-lifetime','sec-purpose',
  'sec-redemption-record','sec-speculation-tags','sec-websocket-accept','sec-websocket-extensions',
  'sec-websocket-key','sec-websocket-protocol','sec-websocket-version','server','server-timing',
  'service-worker','service-worker-allowed','service-worker-navigation-preload','set-cookie','set-login',
  'sourcemap','speculation-rules','strict-transport-security','supports-loading-mode','te',
  'timing-allow-origin','tk','trailer','transfer-encoding','upgrade','upgrade-insecure-requests',
  'use-as-dictionary','user-agent','vary','via','viewport-width','want-content-digest','want-repr-digest',
  'warning','width','www-authenticate','x-content-type-options','x-dns-prefetch-control','x-forwarded-for',
  'x-forwarded-host','x-forwarded-proto','x-frame-options','x-permitted-cross-domain-policies',
  'x-powered-by','x-robots-tag','x-xss-protection',
]);

function _mdnLink(name) {
  if (!_MDN_HEADERS.has(name)) return '';
  return ` <a class="hdr-mdn" href="https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/${encodeURIComponent(name)}" target="_blank" rel="noopener" title="MDN reference" onclick="event.stopPropagation()">↗</a>`;
}

// ── Active sub-tab state ────────────────────────────────────────────
let _headersSubTab = 'heatmap';
let _headersHeatmapShowAll = false;

// ── Debounce render ─────────────────────────────────────────────────
let _headersRenderPending = false;

function _scheduleHeadersRender() {
  if (_headersRenderPending) return;
  _headersRenderPending = true;
  requestAnimationFrame(() => {
    _headersRenderPending = false;
    renderHeadersView();
  });
}

// ── Analysis engine ─────────────────────────────────────────────────
function updateHeaderAnalysis(ep) {
  // Only analyze domain / subdomain traffic
  if (!isDomainHost(ep.host)) return;

  const respHeaders = ep.response_headers;
  const reqHeaders = ep.request_headers;
  const hasResp = respHeaders && typeof respHeaders === 'object' && Object.keys(respHeaders).length > 0;
  const hasReq = reqHeaders && typeof reqHeaders === 'object' && Object.keys(reqHeaders).length > 0;
  if (!hasResp && !hasReq) return;

  const ha = appState.headerAnalysis;
  ha.endpointsAnalyzed++;
  const epRef = { method: ep.method, host: ep.host, path: ep.path };

  // Normalize + track response headers
  const normalized = {};
  if (hasResp) {
    for (const [k, v] of Object.entries(respHeaders)) {
      normalized[k.toLowerCase()] = v;
    }
    for (const [name, value] of Object.entries(normalized)) {
      if (!ha.responseHeaderMap[name]) {
        ha.responseHeaderMap[name] = { count: 0, values: new Set(), endpoints: [] };
      }
      const entry = ha.responseHeaderMap[name];
      entry.count++;
      const valStr = typeof value === 'string' ? value : JSON.stringify(value);
      if (entry.values.size < 50) entry.values.add(valStr);
      if (entry.endpoints.length < 200) entry.endpoints.push(epRef);
    }
  }

  // Normalize + track request headers
  if (hasReq) {
    for (const [k, v] of Object.entries(reqHeaders)) {
      const name = k.toLowerCase();
      if (!ha.requestHeaderMap[name]) {
        ha.requestHeaderMap[name] = { count: 0, values: new Set(), endpoints: [] };
      }
      const entry = ha.requestHeaderMap[name];
      entry.count++;
      const valStr = typeof v === 'string' ? v : JSON.stringify(v);
      if (entry.values.size < 50) entry.values.add(valStr);
      if (entry.endpoints.length < 200) entry.endpoints.push(epRef);
    }
  }

  // Run security rules (on response headers only)
  const secRef = { method: ep.method, host: ep.host, path: ep.path, status: ep.response_status };
  for (const rule of HEADER_SECURITY_RULES) {
    if (rule.check(normalized, ep)) {
      if (!ha.findings[rule.id]) {
        ha.findings[rule.id] = { ...rule, affectedEndpoints: [] };
      }
      if (ha.findings[rule.id].affectedEndpoints.length < 500) {
        ha.findings[rule.id].affectedEndpoints.push(secRef);
      }
    }
  }

  // Recalculate score
  const total = ha.endpointsAnalyzed;
  const highSevCount = Object.values(ha.findings)
    .filter(f => f.severity === 'high')
    .reduce((sum, f) => sum + f.affectedEndpoints.length, 0);
  const pct = total > 0 ? (highSevCount / total) * 100 : 0;
  if (pct <= 5) ha.score = 'A';
  else if (pct <= 15) ha.score = 'B';
  else if (pct <= 30) ha.score = 'C';
  else if (pct <= 50) ha.score = 'D';
  else ha.score = 'F';

  // Create tab on first analyzed endpoint
  if (ha.endpointsAnalyzed === 1) _createHeadersTab();

  _scheduleHeadersRender();
}

// ── Dynamic sub-tab creation (inside Web Endpoints toggle bar) ──────
function _createHeadersTab() {
  if (document.getElementById('evtHeaders')) return;
  const toggle = document.querySelector('.endpoint-view-toggle');
  if (!toggle) return;
  const btn = document.createElement('span');
  btn.className = 'evt-btn';
  btn.id = 'evtHeaders';
  btn.onclick = () => switchEndpointSubView('headers');
  btn.textContent = 'Headers';
  toggle.appendChild(btn);
}

// ── Render ──────────────────────────────────────────────────────────
function renderHeadersView() {
  const container = document.getElementById('headersContent');
  if (!container) return;

  const ha = appState.headerAnalysis;
  if (ha.endpointsAnalyzed === 0) {
    container.innerHTML = '<div class="history-empty" style="padding:2rem"><div>No header data yet</div></div>';
    return;
  }

  // Score summary bar
  const gradeColors = { A: '#059669', B: '#3b82f6', C: '#f59e0b', D: '#f97316', F: '#ef4444' };
  const gradeColor = gradeColors[ha.score] || '#6b7280';

  const sevCounts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of Object.values(ha.findings)) {
    if (sevCounts[f.severity] !== undefined) sevCounts[f.severity] += f.affectedEndpoints.length;
  }

  let html = `<div class="headers-score-summary">
    <div class="headers-grade" style="border-color:${gradeColor};color:${gradeColor}">${ha.score || '–'}</div>
    <div class="headers-score-chips">
      ${sevCounts.high ? `<span class="headers-chip headers-chip-high">${sevCounts.high} High</span>` : ''}
      ${sevCounts.medium ? `<span class="headers-chip headers-chip-medium">${sevCounts.medium} Medium</span>` : ''}
      ${sevCounts.low ? `<span class="headers-chip headers-chip-low">${sevCounts.low} Low</span>` : ''}
      ${sevCounts.info ? `<span class="headers-chip headers-chip-info">${sevCounts.info} Info</span>` : ''}
      <span class="headers-chip-muted">${ha.endpointsAnalyzed} endpoint${ha.endpointsAnalyzed !== 1 ? 's' : ''} analyzed</span>
    </div>
  </div>`;

  // Sub-tabs
  html += `<div class="headers-section-tabs">
    <button class="headers-section-tab ${_headersSubTab === 'heatmap' ? 'active' : ''}" onclick="switchHeadersSubTab('heatmap')">Heatmap</button>
    <button class="headers-section-tab ${_headersSubTab === 'findings' ? 'active' : ''}" onclick="switchHeadersSubTab('findings')">Security Findings</button>
  </div>`;

  if (_headersSubTab === 'heatmap') {
    html += _renderHeadersHeatmap(ha);
  } else {
    html += _renderHeadersFindings(ha);
  }

  container.innerHTML = html;
}

function switchHeadersSubTab(tab) {
  _headersSubTab = tab;
  renderHeadersView();
}

// ── Merge request + response header maps ─────────────────────────────
function _mergeHeaderMaps(ha) {
  const merged = {};
  for (const [name, data] of Object.entries(ha.responseHeaderMap)) {
    merged[name] = { name, count: data.count, values: data.values, endpoints: data.endpoints, direction: 'Response' };
  }
  for (const [name, data] of Object.entries(ha.requestHeaderMap)) {
    if (merged[name]) {
      merged[name].direction = 'Both';
    } else {
      merged[name] = { name, count: data.count, values: data.values, endpoints: data.endpoints, direction: 'Request' };
    }
  }
  return merged;
}

// ── Heatmap sub-tab ─────────────────────────────────────────────────
function _renderHeadersHeatmap(ha) {
  const total = ha.endpointsAnalyzed;
  const merged = _mergeHeaderMaps(ha);
  const entries = Object.values(merged)
    .map(e => ({ ...e, pct: total > 0 ? (e.count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);

  if (entries.length === 0) {
    return '<div class="history-empty" style="padding:1rem"><div>No headers collected yet</div></div>';
  }

  // Visual heatmap grid
  let html = '<div class="headers-heatmap-grid">';
  const gridEntries = entries.slice(0, 80);
  for (const e of gridEntries) {
    const isSecurity = _KNOWN_SECURITY_HEADERS.has(e.name);
    const opacity = Math.max(0.15, e.pct / 100);
    let bgColor;
    if (isSecurity) bgColor = `rgba(5, 150, 105, ${opacity})`;
    else bgColor = `rgba(59, 130, 246, ${opacity})`;
    const abbrev = e.name.length > 18 ? e.name.slice(0, 16) + '\u2026' : e.name;
    const desc = _headerDescription(e.name);
    const dirLabel = e.direction || 'Response';
    const gridTip = desc ? `[${dirLabel}] ${escHtml(e.name)}: ${escHtml(desc)}\n${e.count}/${total} (${e.pct.toFixed(0)}%)` : `[${dirLabel}] ${escHtml(e.name)}: ${e.count}/${total} (${e.pct.toFixed(0)}%)`;
    html += `<div class="headers-heatmap-cell" style="background:${bgColor}" title="${gridTip}" onclick="scrollToHeaderRow('${escHtml(e.name)}')">${escHtml(abbrev)}</div>`;
  }

  // Show missing security headers as red cells
  for (const secH of _KNOWN_SECURITY_HEADERS) {
    if (!ha.responseHeaderMap[secH]) {
      const missingDesc = _headerDescription(secH);
      const missingTip = missingDesc ? `${escHtml(secH)}: ${escHtml(missingDesc)}\nMissing from all endpoints` : `${escHtml(secH)}: missing from all endpoints`;
      html += `<div class="headers-heatmap-cell headers-heatmap-missing" title="${missingTip}">✗ ${escHtml(secH)}</div>`;
    }
  }
  html += '</div>';

  // Detail table
  const LIMIT = 100;
  const showAll = _headersHeatmapShowAll || entries.length <= LIMIT;
  const visible = showAll ? entries : entries.slice(0, LIMIT);

  html += '<div class="headers-heatmap-table-wrap"><table class="headers-heatmap-table"><thead><tr>';
  html += '<th style="width:30px">#</th><th>Header Name</th><th style="width:55px">Dir</th><th style="width:60px">Count</th>';
  html += '<th style="width:140px">Coverage</th><th style="width:80px">Category</th>';
  html += '</tr></thead><tbody>';

  visible.forEach((e, i) => {
    const isSecurity = _KNOWN_SECURITY_HEADERS.has(e.name);
    const missingSecHeader = isSecurity && e.pct < 50;
    const borderClass = isSecurity ? (missingSecHeader ? 'hdr-row-red' : 'hdr-row-green') : '';
    const cat = _headerCategory(e.name);
    const dir = e.direction || 'Response';
    const dirCls = dir === 'Request' ? 'hdr-dir-req' : dir === 'Both' ? 'hdr-dir-both' : 'hdr-dir-res';
    const dirAbbr = dir === 'Request' ? 'Req' : dir === 'Both' ? 'Both' : 'Res';
    const expandId = `hdr-expand-${CSS.escape(e.name)}`;

    html += `<tr class="${borderClass}" id="hdr-row-${CSS.escape(e.name)}" style="cursor:pointer" onclick="toggleHeaderRowExpand('${escHtml(e.name)}')">`;
    const rowDesc = _headerDescription(e.name);
    html += `<td style="text-align:center;color:var(--text-muted);font-size:0.82rem">${i + 1}</td>`;
    html += `<td style="font-family:'JetBrains Mono',monospace;font-size:0.82rem" title="${rowDesc ? escHtml(rowDesc) : ''}">${escHtml(e.name)}${_mdnLink(e.name)}</td>`;
    html += `<td style="text-align:center"><span class="hdr-dir ${dirCls}">${dirAbbr}</span></td>`;
    html += `<td style="text-align:center">${e.count}</td>`;
    html += `<td><div class="hdr-bar-wrap"><div class="hdr-bar" style="width:${e.pct.toFixed(1)}%"></div><span class="hdr-bar-label">${e.pct.toFixed(0)}%</span></div></td>`;
    html += `<td><span class="hdr-cat hdr-cat-${cat.toLowerCase()}">${escHtml(cat)}</span></td>`;
    html += '</tr>';
    // Inline expansion row (hidden by default)
    html += `<tr class="hdr-expand-row collapsed" id="${expandId}"><td colspan="6"><div class="hdr-expand-content" id="${expandId}-content"></div></td></tr>`;
  });

  if (!showAll && entries.length > LIMIT) {
    html += `<tr><td colspan="6" style="text-align:center;padding:0.75rem">
      <button class="history-show-all-btn" onclick="_headersHeatmapShowAll=true;renderHeadersView();">
        Show all ${entries.length} headers
      </button>
    </td></tr>`;
  }

  html += '</tbody></table></div>';
  return html;
}

function scrollToHeaderRow(name) {
  const row = document.getElementById('hdr-row-' + CSS.escape(name));
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1500);
  }
}

function toggleHeaderRowExpand(name) {
  const expandId = `hdr-expand-${CSS.escape(name)}`;
  const expandRow = document.getElementById(expandId);
  if (!expandRow) return;

  // If already expanded, collapse
  if (!expandRow.classList.contains('collapsed')) {
    expandRow.classList.add('collapsed');
    return;
  }

  // Collapse any other open row
  document.querySelectorAll('.hdr-expand-row:not(.collapsed)').forEach(r => r.classList.add('collapsed'));

  // Populate content on first expand
  const contentEl = document.getElementById(expandId + '-content');
  if (!contentEl.innerHTML) {
    const ha = appState.headerAnalysis;
    const entry = ha.responseHeaderMap[name] || ha.requestHeaderMap[name];
    if (!entry) return;

    const total = ha.endpointsAnalyzed;
    const pct = total > 0 ? ((entry.count / total) * 100).toFixed(1) : '0';
    const cat = _headerCategory(name);
    const isSecurity = _KNOWN_SECURITY_HEADERS.has(name);

    let html = '<div class="hdr-expand-grid">';
    html += `<div class="hdr-expand-meta">`;
    html += `<span class="hdr-cat hdr-cat-${cat.toLowerCase()}">${escHtml(cat)}</span>`;
    if (isSecurity) html += ' <span style="color:var(--green);font-size:0.75rem;font-weight:600">Security Header</span>';
    html += `<span style="color:var(--text-muted);font-size:0.78rem;margin-left:auto">${entry.count} / ${total} endpoints (${pct}%)</span>`;
    html += '</div>';

    // Unique values
    const vals = [...entry.values];
    if (vals.length > 0) {
      html += `<div class="hdr-expand-section"><div class="hdr-expand-label">Values (${vals.length}${entry.values.size >= 50 ? '+' : ''})</div>`;
      vals.slice(0, 10).forEach(v => {
        html += `<div class="hdr-expand-value">${escHtml(v)}</div>`;
      });
      if (vals.length > 10) html += `<div style="font-size:0.72rem;color:var(--text-muted)">...and ${vals.length - 10} more</div>`;
      html += '</div>';
    }

    // Endpoint sample
    html += `<div class="hdr-expand-section"><div class="hdr-expand-label">Endpoints (${entry.endpoints.length}${entry.endpoints.length >= 200 ? '+' : ''})</div>`;
    entry.endpoints.slice(0, 15).forEach(ep => {
      html += `<div class="hdr-expand-ep">`;
      html += `<span class="badge badge-${escHtml(ep.method)}" style="font-size:0.65rem;min-width:34px;text-align:center;padding:0.1rem 0.3rem">${escHtml(ep.method)}</span>`;
      html += `<span>${escHtml(ep.host)}${escHtml(ep.path)}</span>`;
      html += '</div>';
    });
    if (entry.endpoints.length > 15) html += `<div style="font-size:0.72rem;color:var(--text-muted)">...and ${entry.endpoints.length - 15} more</div>`;
    html += '</div></div>';

    contentEl.innerHTML = html;
  }

  expandRow.classList.remove('collapsed');
}

// ── Findings sub-tab ────────────────────────────────────────────────
function _renderHeadersFindings(ha) {
  const findingsList = Object.values(ha.findings)
    .sort((a, b) => {
      const sevOrder = { high: 0, medium: 1, low: 2, info: 3 };
      const sev = (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4);
      if (sev !== 0) return sev;
      return b.affectedEndpoints.length - a.affectedEndpoints.length;
    });

  if (findingsList.length === 0) {
    return '<div class="history-empty" style="padding:2rem"><div>No security findings detected</div></div>';
  }

  let html = '<div class="headers-findings-list">';
  findingsList.forEach(f => {
    const sevClass = `severity-${f.severity}`;
    const count = f.affectedEndpoints.length;
    const cardId = `hdr-finding-${f.id}`;

    html += `<div class="header-finding-card" onclick="toggleHeaderFindingExpand('${cardId}')">`;
    html += `<div class="header-finding-top">`;
    html += `<span class="severity-badge ${sevClass}">${escHtml(f.severity.toUpperCase())}</span>`;
    html += `<span class="header-finding-title">${escHtml(f.category)}</span>`;
    html += `<span class="header-finding-count">${count} endpoint${count !== 1 ? 's' : ''}</span>`;
    html += '</div>';
    html += `<div class="header-finding-problem">${escHtml(f.problem)}</div>`;
    html += `<div class="header-finding-impact">${escHtml(f.impact)}</div>`;
    if (f.fix) html += `<div class="header-finding-fix">${escHtml(f.fix)}</div>`;

    // Expandable endpoint list
    html += `<div class="header-finding-endpoints collapsed" id="${cardId}">`;
    const shown = f.affectedEndpoints.slice(0, 30);
    shown.forEach(ep => {
      html += `<div class="header-finding-ep">`;
      html += `<span class="badge badge-${escHtml(ep.method)}" style="font-size:0.68rem;min-width:36px;text-align:center">${escHtml(ep.method)}</span>`;
      html += `<span>${escHtml(ep.host)}${escHtml(ep.path)}</span>`;
      html += '</div>';
    });
    if (count > 30) html += `<div style="font-size:0.75rem;color:var(--text-muted);padding:0.3rem 0.5rem">...and ${count - 30} more</div>`;
    html += '</div>';

    html += '</div>';
  });
  html += '</div>';
  return html;
}

function toggleHeaderFindingExpand(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('collapsed');
}

// ── History tab renderer (called from history.js) ───────────────────
function renderHeadersHistoryTab(endpoints) {
  // Run header analysis on stored endpoints (domain-only)
  const domain = (_historyDetailScan && _historyDetailScan.domain || '').toLowerCase();
  if (!domain) return '<div class="history-empty" style="padding:2rem"><div>No header data</div></div>';

  const tempAnalysis = {
    responseHeaderMap: {},
    requestHeaderMap: {},
    findings: {},
    score: null,
    endpointsAnalyzed: 0,
  };

  for (const ep of endpoints) {
    const host = (ep.host || '').toLowerCase();
    const isSubdomain = host === domain || host.endsWith('.' + domain);
    if (!isSubdomain) continue;

    const respHeaders = ep.response_headers;
    const reqHeaders = ep.request_headers;
    const hasResp = respHeaders && typeof respHeaders === 'object' && Object.keys(respHeaders).length > 0;
    const hasReq = reqHeaders && typeof reqHeaders === 'object' && Object.keys(reqHeaders).length > 0;
    if (!hasResp && !hasReq) continue;

    tempAnalysis.endpointsAnalyzed++;
    const normalized = {};

    if (hasResp) {
      for (const [k, v] of Object.entries(respHeaders)) {
        normalized[k.toLowerCase()] = v;
      }
      for (const [name, value] of Object.entries(normalized)) {
        if (!tempAnalysis.responseHeaderMap[name]) {
          tempAnalysis.responseHeaderMap[name] = { count: 0, values: new Set(), endpoints: [] };
        }
        const entry = tempAnalysis.responseHeaderMap[name];
        entry.count++;
        const valStr = typeof value === 'string' ? value : JSON.stringify(value);
        if (entry.values.size < 50) entry.values.add(valStr);
        if (entry.endpoints.length < 200) entry.endpoints.push({ method: ep.method, host: ep.host, path: ep.path });
      }
    }

    if (hasReq) {
      for (const [k, v] of Object.entries(reqHeaders)) {
        const name = k.toLowerCase();
        if (!tempAnalysis.requestHeaderMap[name]) {
          tempAnalysis.requestHeaderMap[name] = { count: 0, values: new Set(), endpoints: [] };
        }
        const entry = tempAnalysis.requestHeaderMap[name];
        entry.count++;
        const valStr = typeof v === 'string' ? v : JSON.stringify(v);
        if (entry.values.size < 50) entry.values.add(valStr);
        if (entry.endpoints.length < 200) entry.endpoints.push({ method: ep.method, host: ep.host, path: ep.path });
      }
    }

    const epRef = { method: ep.method, host: ep.host, path: ep.path, status: ep.response_status };
    for (const rule of HEADER_SECURITY_RULES) {
      if (rule.check(normalized, ep)) {
        if (!tempAnalysis.findings[rule.id]) {
          tempAnalysis.findings[rule.id] = { ...rule, affectedEndpoints: [] };
        }
        if (tempAnalysis.findings[rule.id].affectedEndpoints.length < 500) {
          tempAnalysis.findings[rule.id].affectedEndpoints.push(epRef);
        }
      }
    }
  }

  if (tempAnalysis.endpointsAnalyzed === 0) {
    return '<div class="history-empty" style="padding:2rem"><div>No subdomain header data available</div></div>';
  }

  // Calculate score
  const total = tempAnalysis.endpointsAnalyzed;
  const highSevCount = Object.values(tempAnalysis.findings)
    .filter(f => f.severity === 'high')
    .reduce((sum, f) => sum + f.affectedEndpoints.length, 0);
  const pct = total > 0 ? (highSevCount / total) * 100 : 0;
  if (pct <= 5) tempAnalysis.score = 'A';
  else if (pct <= 15) tempAnalysis.score = 'B';
  else if (pct <= 30) tempAnalysis.score = 'C';
  else if (pct <= 50) tempAnalysis.score = 'D';
  else tempAnalysis.score = 'F';

  // Render score summary
  const gradeColors = { A: '#059669', B: '#3b82f6', C: '#f59e0b', D: '#f97316', F: '#ef4444' };
  const gradeColor = gradeColors[tempAnalysis.score] || '#6b7280';
  const sevCounts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of Object.values(tempAnalysis.findings)) {
    if (sevCounts[f.severity] !== undefined) sevCounts[f.severity] += f.affectedEndpoints.length;
  }

  let html = `<div class="headers-score-summary" style="margin-bottom:1rem">
    <div class="headers-grade" style="border-color:${gradeColor};color:${gradeColor}">${tempAnalysis.score}</div>
    <div class="headers-score-chips">
      ${sevCounts.high ? `<span class="headers-chip headers-chip-high">${sevCounts.high} High</span>` : ''}
      ${sevCounts.medium ? `<span class="headers-chip headers-chip-medium">${sevCounts.medium} Medium</span>` : ''}
      ${sevCounts.low ? `<span class="headers-chip headers-chip-low">${sevCounts.low} Low</span>` : ''}
      ${sevCounts.info ? `<span class="headers-chip headers-chip-info">${sevCounts.info} Info</span>` : ''}
      <span class="headers-chip-muted">${total} endpoint${total !== 1 ? 's' : ''} analyzed (subdomains only)</span>
    </div>
  </div>`;

  // Heatmap table (compact)
  const histMerged = _mergeHeaderMaps(tempAnalysis);
  const entries = Object.values(histMerged)
    .map(e => ({ ...e, pct: total > 0 ? (e.count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  if (entries.length > 0) {
    html += '<div class="hd-section"><span class="hd-section-title">Headers</span>';
    html += '<table class="headers-heatmap-table"><thead><tr>';
    html += '<th style="width:30px">#</th><th>Header</th><th style="width:45px">Dir</th><th style="width:55px">Count</th><th style="width:120px">Coverage</th><th style="width:70px">Category</th>';
    html += '</tr></thead><tbody>';
    entries.forEach((e, i) => {
      const isSecurity = _KNOWN_SECURITY_HEADERS.has(e.name);
      const borderClass = isSecurity ? (e.pct < 50 ? 'hdr-row-red' : 'hdr-row-green') : '';
      const cat = _headerCategory(e.name);
      const dir = e.direction || 'Response';
      const dirCls = dir === 'Request' ? 'hdr-dir-req' : dir === 'Both' ? 'hdr-dir-both' : 'hdr-dir-res';
      const dirAbbr = dir === 'Request' ? 'Req' : dir === 'Both' ? 'Both' : 'Res';
      html += `<tr class="${borderClass}">`;
      const histDesc = _headerDescription(e.name);
      html += `<td style="text-align:center;color:var(--text-muted);font-size:0.8rem">${i + 1}</td>`;
      html += `<td style="font-family:'JetBrains Mono',monospace;font-size:0.8rem" title="${histDesc ? escHtml(histDesc) : ''}">${escHtml(e.name)}${_mdnLink(e.name)}</td>`;
      html += `<td style="text-align:center"><span class="hdr-dir ${dirCls}" style="font-size:0.65rem">${dirAbbr}</span></td>`;
      html += `<td style="text-align:center;font-size:0.8rem">${e.count}</td>`;
      html += `<td><div class="hdr-bar-wrap"><div class="hdr-bar" style="width:${e.pct.toFixed(1)}%"></div><span class="hdr-bar-label">${e.pct.toFixed(0)}%</span></div></td>`;
      html += `<td><span class="hdr-cat hdr-cat-${cat.toLowerCase()}" style="font-size:0.65rem">${escHtml(cat)}</span></td>`;
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }

  // Security findings
  const findingsList = Object.values(tempAnalysis.findings)
    .sort((a, b) => {
      const sevOrder = { high: 0, medium: 1, low: 2, info: 3 };
      return (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4);
    });

  if (findingsList.length > 0) {
    html += '<div class="hd-section" style="margin-top:1rem"><span class="hd-section-title">Security Findings</span>';
    findingsList.forEach(f => {
      const sevClass = `severity-${f.severity}`;
      const count = f.affectedEndpoints.length;
      html += `<div class="header-finding-card" style="margin-bottom:0.5rem">`;
      html += `<div class="header-finding-top">`;
      html += `<span class="severity-badge ${sevClass}">${escHtml(f.severity.toUpperCase())}</span>`;
      html += `<span class="header-finding-title">${escHtml(f.category)}</span>`;
      html += `<span class="header-finding-count">${count} endpoint${count !== 1 ? 's' : ''}</span>`;
      html += '</div>';
      html += `<div class="header-finding-problem">${escHtml(f.problem)}</div>`;
      html += `<div class="header-finding-impact">${escHtml(f.impact)}</div>`;
      if (f.fix) html += `<div class="header-finding-fix">${escHtml(f.fix)}</div>`;
      html += '</div>';
    });
    html += '</div>';
  }

  return html;
}
