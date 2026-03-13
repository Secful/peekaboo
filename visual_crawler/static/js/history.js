/* Scan History UI — fetch past scans via REST API */

function openHistoryModal() {
  document.getElementById('historyOverlay').classList.add('show');
  // Always load recent scans on open
  fetchRecentScans();
}

function closeHistoryModal() {
  document.getElementById('historyOverlay').classList.remove('show');
}

async function fetchRecentScans() {
  const resultsEl = document.getElementById('historyResults');
  resultsEl.innerHTML = `
    <div class="history-loading">
      <div class="spinner"></div>
      <div class="loading-text">Loading recent scans...</div>
    </div>`;

  try {
    const resp = await fetch('/api/scan-history');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderScanHistory(data.scans || [], null);
  } catch (err) {
    resultsEl.innerHTML = `
      <div class="history-empty">
        <div class="icon">&#x26A0;&#xFE0F;</div>
        <div>Failed to load history: ${escHtml(err.message)}</div>
      </div>`;
  }
}

async function fetchScanHistory() {
  const domain = document.getElementById('historyDomain').value.trim().toLowerCase();
  if (!domain) {
    fetchRecentScans();
    return;
  }

  const resultsEl = document.getElementById('historyResults');
  resultsEl.innerHTML = `
    <div class="history-loading">
      <div class="spinner"></div>
      <div class="loading-text">Searching scans for ${escHtml(domain)}...</div>
    </div>`;

  try {
    const resp = await fetch(`/api/scan-history?domain=${encodeURIComponent(domain)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderScanHistory(data.scans || [], domain);
  } catch (err) {
    resultsEl.innerHTML = `
      <div class="history-empty">
        <div class="icon">&#x26A0;&#xFE0F;</div>
        <div>Failed to load history: ${escHtml(err.message)}</div>
      </div>`;
  }
}

function renderScanHistory(scans, domain) {
  const resultsEl = document.getElementById('historyResults');
  const heading = domain
    ? `No past scans found for <strong>${escHtml(domain)}</strong>`
    : 'No past scans found';

  if (scans.length === 0) {
    resultsEl.innerHTML = `
      <div class="history-empty">
        <div class="icon">&#x1F50D;</div>
        <div>${heading}</div>
      </div>`;
    return;
  }

  const label = domain
    ? `${scans.length} scan${scans.length > 1 ? 's' : ''} for ${escHtml(domain)}`
    : `${scans.length} recent scan${scans.length > 1 ? 's' : ''}`;
  let html = `<div class="history-count">${label}</div>`;
  html += '<table class="history-table"><thead><tr>';
  html += '<th>Domain</th><th>Date</th><th>Duration</th><th>Pages</th><th>Endpoints</th><th>APIs</th>';
  html += '<th>Sec</th><th>Ports</th><th>JS APIs</th><th>Specs</th>';
  html += '</tr></thead><tbody>';

  scans.forEach(scan => {
    const date = scan.started_at
      ? new Date(scan.started_at).toLocaleString()
      : '\u2014';
    const dur = scan.duration_seconds != null
      ? (scan.duration_seconds >= 60
        ? `${Math.floor(scan.duration_seconds / 60)}m ${scan.duration_seconds % 60}s`
        : `${scan.duration_seconds}s`)
      : '\u2014';
    const scanDomain = scan.domain || domain || '\u2014';

    const secVal = scan.security_count ?? null;
    const portsVal = scan.ports_count ?? null;
    const jsApisVal = scan.extracted_apis_count ?? null;
    const apiSpecsVal = scan.api_specs_count ?? null;

    html += `<tr class="history-row" onclick="viewScanDetail('${escHtml(scanDomain)}','${scan.scan_id}')">`;
    html += `<td class="history-domain-cell">${escHtml(scanDomain)}</td>`;
    html += `<td>${escHtml(date)}</td>`;
    html += `<td>${escHtml(dur)}</td>`;
    html += `<td>${scan.pages_visited ?? '\u2014'}</td>`;
    html += `<td>${scan.total_endpoints ?? '\u2014'}</td>`;
    html += `<td>${scan.confirmed_apis ?? '\u2014'}</td>`;
    html += `<td>${secVal ? `<span style="color:#ef4444;font-weight:600">${secVal}</span>` : '<span style="color:var(--text-muted)">\u2014</span>'}</td>`;
    html += `<td>${portsVal ? `<span style="color:#3b82f6;font-weight:600">${portsVal}</span>` : '<span style="color:var(--text-muted)">\u2014</span>'}</td>`;
    html += `<td>${jsApisVal ? `<span style="color:var(--patch);font-weight:600">${jsApisVal}</span>` : '<span style="color:var(--text-muted)">\u2014</span>'}</td>`;
    html += `<td>${apiSpecsVal ? `<span style="color:#7c3aed;font-weight:600">${apiSpecsVal}</span>` : '<span style="color:var(--text-muted)">\u2014</span>'}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  resultsEl.innerHTML = html;
}

async function viewScanDetail(domain, scanId) {
  const resultsEl = document.getElementById('historyResults');
  const prevHtml = resultsEl.innerHTML;

  resultsEl.innerHTML = `
    <div class="history-loading">
      <div class="spinner"></div>
      <div class="loading-text">Loading scan details...</div>
    </div>`;

  try {
    const resp = await fetch(`/api/scan-history/${encodeURIComponent(domain)}/${encodeURIComponent(scanId)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderScanDetail(data, prevHtml);
  } catch (err) {
    resultsEl.innerHTML = `
      <div class="history-empty">
        <div class="icon">&#x26A0;&#xFE0F;</div>
        <div>Failed to load scan: ${escHtml(err.message)}</div>
        <button class="history-back-btn" onclick="document.getElementById('historyResults').innerHTML = this._prevHtml;">Back</button>
      </div>`;
    resultsEl.querySelector('.history-back-btn')._prevHtml = prevHtml;
  }
}

/* ── Detail View ───────────────────────────────────────── */

// Module-level state for the detail view
let _historyDetailScan = null;
let _historyActiveTab = 'endpoints';
let _historyMethodFilters = {};  // method -> boolean (true = active)
let _historyFilterText = '';
let _historyEndpointsShowAll = false;

function renderScanDetail(scan, prevHtml) {
  _historyDetailScan = scan;
  _historyActiveTab = 'endpoints';
  _historyFilterText = '';
  _historyEndpointsShowAll = false;
  _historyMethodFilters = {};

  const resultsEl = document.getElementById('historyResults');
  const results = scan.results || {};
  const scanner = scan.scanner || {};
  const hasScanner = Object.keys(scanner).length > 0;

  // Pre-filter: only confirmed APIs belonging to the domain/subdomains
  const allEndpoints = scan.endpoints || [];
  const domainBase = (scan.domain || '').toLowerCase();
  const apiEndpoints = allEndpoints.filter(ep => {
    if (ep.api_confidence !== 'API') return false;
    const host = (ep.host || '').toLowerCase();
    return host === domainBase || host.endsWith('.' + domainBase);
  });
  scan._filteredEndpoints = apiEndpoints;

  // Collect unique methods for filter pills from the API-only set
  const methods = [...new Set(apiEndpoints.map(ep => ep.method || 'GET'))].sort();
  methods.forEach(m => { _historyMethodFilters[m] = true; });

  // ── Back button + header ──
  let html = `<button class="history-back-btn" id="historyBackBtn">&#x2190; Back to list</button>`;
  html += '<div class="history-detail">';

  // Domain title + date
  const dateStr = scan.started_at ? new Date(scan.started_at).toLocaleString() : '';
  html += `<h4>${escHtml(scan.domain)}</h4>`;
  if (dateStr) html += `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:-0.75rem;margin-bottom:0.75rem;">Scan #${scan.scan_id} &middot; ${escHtml(dateStr)}</div>`;

  // ── Stats grid ──
  const dur = scan.duration_seconds != null
    ? (scan.duration_seconds >= 60 ? `${Math.floor(scan.duration_seconds/60)}m ${scan.duration_seconds%60}s` : `${scan.duration_seconds}s`)
    : '\u2014';

  html += '<div class="history-stat-grid">';
  html += _hdStatCard('Duration', dur);
  html += _hdStatCard('Pages', results.pages_visited ?? '\u2014');
  html += _hdStatCard('Endpoints', results.total_endpoints ?? '\u2014');
  html += _hdStatCard('Domain APIs', scan._filteredEndpoints ? scan._filteredEndpoints.length : (results.confirmed_apis ?? '\u2014'));

  if (hasScanner) {
    const secCount = _countSecurityFindings(scanner);
    const portsCount = _countOpenPorts(scanner);
    const jsApiCount = _countExtractedApis(scanner);
    if (secCount > 0) html += _hdStatCard('Security', secCount, '#ef4444');
    else html += _hdStatCard('Security', '0');
    html += _hdStatCard('Ports', portsCount || '0');
    html += _hdStatCard('JS APIs', jsApiCount || '0');
    const apiSpecCount = _countApiSpecs(scanner);
    if (apiSpecCount > 0) html += _hdStatCard('API Specs', apiSpecCount, '#7c3aed');
  }
  html += '</div>';

  // ── Tab bar ──
  const tabs = [{ id: 'endpoints', label: 'APIs', always: true }];
  if (_hasData(scanner.security_insights)) tabs.push({ id: 'security', label: 'Security' });
  if (_hasData(scanner.extracted_apis)) tabs.push({ id: 'extracted_apis', label: 'JS APIs' });
  if (_hasData(scanner.open_ports)) tabs.push({ id: 'open_ports', label: 'Open Ports' });
  if (_hasData(scanner.api_specs)) tabs.push({ id: 'api_specs_tab', label: 'API Spec' });
  if (_hasData(scan.subdomain_results)) tabs.push({ id: 'subdomains', label: 'Subdomains' });

  html += '<div class="history-tabs">';
  tabs.forEach(t => {
    const cls = t.id === 'endpoints' ? 'history-tab active' : 'history-tab';
    html += `<button class="${cls}" data-tab="${t.id}" onclick="historySetTab('${t.id}')">${t.label}</button>`;
  });
  html += '</div>';

  // ── Tab content container ──
  html += '<div id="historyTabContent"></div>';
  html += '</div>'; // close .history-detail

  resultsEl.innerHTML = html;

  document.getElementById('historyBackBtn').addEventListener('click', () => {
    resultsEl.innerHTML = prevHtml;
    _historyDetailScan = null;
  });

  // Render initial tab
  _renderHistoryTabContent();
}

function historySetTab(tabId) {
  _historyActiveTab = tabId;
  // Update active tab styling
  document.querySelectorAll('.history-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  _renderHistoryTabContent();
}

function _renderHistoryTabContent() {
  const container = document.getElementById('historyTabContent');
  if (!container || !_historyDetailScan) return;

  switch (_historyActiveTab) {
    case 'endpoints': container.innerHTML = _renderEndpointsTab(); break;
    case 'security': container.innerHTML = _renderSecurityTab(); break;
    case 'extracted_apis': container.innerHTML = _renderExtractedApisTab(); break;
    case 'open_ports': container.innerHTML = _renderOpenPortsTab(); break;
    case 'api_specs_tab': container.innerHTML = _renderApiSpecsTab(); break;
    case 'subdomains': container.innerHTML = _renderSubdomainsTab(); break;
    default: container.innerHTML = '';
  }
}

/* ── Stat card helper ── */
function _hdStatCard(label, value, borderColor) {
  const borderStyle = borderColor ? `border-left-color:${borderColor}` : '';
  return `<div class="hd-stat" style="${borderStyle}">
    <span class="hd-val">${escHtml(String(value))}</span>
    <span class="hd-label">${escHtml(label)}</span>
  </div>`;
}

/* ── Data helpers ── */
function _hasData(obj) { return obj && typeof obj === 'object' && Object.keys(obj).length > 0; }

function _countSecurityFindings(scanner) {
  if (!scanner.security_insights) return 0;
  return Object.values(scanner.security_insights).reduce((sum, v) => sum + (v.findings?.length || 0), 0);
}
function _countOpenPorts(scanner) {
  if (!scanner.open_ports) return 0;
  return Object.values(scanner.open_ports).reduce((sum, v) => sum + (v.open_ports_count || 0), 0);
}
function _countExtractedApis(scanner) {
  if (!scanner.extracted_apis) return 0;
  return Object.values(scanner.extracted_apis).reduce((sum, v) => sum + (v.findings_count || 0), 0);
}
function _countApiSpecs(scanner) {
  if (!scanner.api_specs) return 0;
  return Object.values(scanner.api_specs).reduce((sum, v) => sum + (v.findings_count || 0), 0);
}

/* ────────────────────────────────────────────────────────
   ENDPOINTS TAB
   ──────────────────────────────────────────────────────── */
function _renderEndpointsTab() {
  const endpoints = _historyDetailScan._filteredEndpoints || [];
  if (endpoints.length === 0) {
    return '<div class="history-empty" style="padding:2rem"><div>No domain API endpoints found</div></div>';
  }

  // Method pills
  const methods = Object.keys(_historyMethodFilters).sort();
  let pillsHtml = methods.map(m => {
    const active = _historyMethodFilters[m];
    return `<span class="history-method-pill badge badge-${escHtml(m)} ${active ? '' : 'inactive'}"
      onclick="historyToggleMethod('${escHtml(m)}')">${escHtml(m)}</span>`;
  }).join('');

  let html = `<div class="history-filter-bar">
    <input class="history-filter-input" placeholder="Filter by path..." value="${escHtml(_historyFilterText)}"
      oninput="_historyFilterText=this.value;_renderHistoryTabContent();">
    <div class="history-method-pills">${pillsHtml}</div>
  </div>`;

  // Filter
  const filtered = endpoints.filter(ep => {
    const method = ep.method || 'GET';
    if (!_historyMethodFilters[method]) return false;
    if (_historyFilterText && !(ep.path || '').toLowerCase().includes(_historyFilterText.toLowerCase())) return false;
    return true;
  });

  const LIMIT = 500;
  const showAll = _historyEndpointsShowAll || filtered.length <= LIMIT;
  const visible = showAll ? filtered : filtered.slice(0, LIMIT);

  html += `<div class="hd-section"><span class="hd-section-title">Domain APIs (${filtered.length}${filtered.length !== endpoints.length ? ' of ' + endpoints.length : ''})</span>`;
  html += '<div class="history-endpoint-table-wrap"><table class="history-endpoint-table"><thead><tr>';
  html += '<th style="width:68px">Method</th><th>Path</th><th style="width:18%">Host</th><th style="width:55px">Status</th>';
  html += '</tr></thead><tbody>';

  visible.forEach(ep => {
    const statusClass = ep.response_status ? `status-${Math.floor(ep.response_status / 100)}xx` : '';
    html += '<tr>';
    html += `<td><span class="badge badge-${escHtml(ep.method || 'GET')}">${escHtml(ep.method || '\u2014')}</span></td>`;
    html += `<td class="history-path-cell">${escHtml(ep.path || '\u2014')}</td>`;
    html += `<td class="host-cell">${escHtml(ep.host || '\u2014')}</td>`;
    html += `<td class="${statusClass}">${ep.response_status || '\u2014'}</td>`;
    html += '</tr>';
  });

  if (!showAll && filtered.length > LIMIT) {
    html += `<tr><td colspan="4" style="text-align:center;padding:0.75rem">
      <button class="history-show-all-btn" onclick="_historyEndpointsShowAll=true;_renderHistoryTabContent();">
        Show all ${filtered.length} endpoints
      </button>
    </td></tr>`;
  }

  html += '</tbody></table></div></div>';
  return html;
}

function historyToggleMethod(method) {
  _historyMethodFilters[method] = !_historyMethodFilters[method];
  _renderHistoryTabContent();
}

/* ────────────────────────────────────────────────────────
   SECURITY TAB
   ──────────────────────────────────────────────────────── */
function _renderSecurityTab() {
  const insights = _historyDetailScan.scanner?.security_insights || {};
  const subdomains = Object.keys(insights);
  if (subdomains.length === 0) {
    return '<div class="history-empty" style="padding:2rem"><div>No security findings</div></div>';
  }

  let html = '';
  subdomains.forEach(sub => {
    const data = insights[sub];
    const findings = data.findings || [];
    if (findings.length === 0) return;

    // Determine worst severity for card border
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    let worstSev = 'info';
    findings.forEach(f => {
      const sev = (f.severity || 'info').toLowerCase();
      if ((severityOrder[sev] ?? 4) < (severityOrder[worstSev] ?? 4)) worstSev = sev;
    });

    const borderClass = `security-card-${worstSev}`;

    html += `<div class="history-scanner-card ${borderClass}">`;
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">`;
    html += `<span style="font-weight:600;font-size:0.9rem;font-family:'JetBrains Mono',monospace">${escHtml(sub)}</span>`;
    html += `<span class="severity-badge severity-${worstSev}">${escHtml(worstSev.toUpperCase())}</span>`;
    html += `</div>`;

    // Verdict if present
    if (data.verdict) {
      html += `<div style="font-size:0.8rem;color:var(--text-muted);font-style:italic;margin-bottom:0.5rem">${escHtml(data.verdict)}</div>`;
    }

    // Individual findings
    findings.forEach(f => {
      const sev = (f.severity || 'info').toLowerCase();
      const colors = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#3b82f6', info: '#6b7280' };
      const borderCol = colors[sev] || '#6b7280';
      html += `<div class="history-scanner-subcard" style="border-left-color:${borderCol}">`;
      html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem">`;
      html += `<span style="font-weight:600;font-size:0.82rem">${escHtml(f.name || f.template_id || 'Finding')}</span>`;
      html += `<span class="severity-badge severity-${sev}" style="font-size:0.6rem">${escHtml(sev.toUpperCase())}</span>`;
      html += `</div>`;
      if (f.description) html += `<div style="font-size:0.78rem;color:var(--text-muted);line-height:1.4">${escHtml(f.description)}</div>`;
      if (f.matched_at) html += `<div style="font-size:0.72rem;margin-top:0.2rem"><span style="color:var(--text-muted);font-weight:600">URL:</span> <span style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:var(--green);word-break:break-all">${escHtml(f.matched_at)}</span></div>`;
      html += `</div>`;
    });

    html += `</div>`;
  });

  return html || '<div class="history-empty" style="padding:2rem"><div>No security findings with issues</div></div>';
}

/* ────────────────────────────────────────────────────────
   EXTRACTED APIS TAB (JS APIs)
   ──────────────────────────────────────────────────────── */
function _renderExtractedApisTab() {
  const apis = _historyDetailScan.scanner?.extracted_apis || {};
  const subdomains = Object.keys(apis);
  if (subdomains.length === 0) {
    return '<div class="history-empty" style="padding:2rem"><div>No extracted APIs</div></div>';
  }

  let html = '';
  subdomains.forEach(sub => {
    const data = apis[sub];
    const findings = data.findings || [];
    if (findings.length === 0) return;

    html += `<div style="font-weight:600;font-size:0.85rem;margin-top:1rem;margin-bottom:0.5rem;color:var(--text)">${escHtml(sub)}</div>`;

    findings.forEach(f => {
      const method = (f.method || 'UNKNOWN').toUpperCase();
      const methodClass = `method-${method}`;
      const apiUrl = f.url || f.endpoint || f.path || '\u2014';
      html += `<div class="history-scanner-card" style="border-left-color:var(--green)">`;
      html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem">`;
      html += `<span class="api-card-method ${methodClass}">${escHtml(method)}</span>`;
      if (f.category) html += `<span style="font-size:0.68rem;font-weight:600;padding:0.1rem 0.45rem;border-radius:4px;background:rgba(124,58,237,0.1);color:var(--patch);border:1px solid rgba(124,58,237,0.25)">${escHtml(f.category)}</span>`;
      html += `</div>`;
      html += `<div style="font-family:'JetBrains Mono',monospace;font-size:0.78rem;word-break:break-all;margin-bottom:0.25rem;line-height:1.4">${escHtml(apiUrl)}</div>`;
      const meta = [];
      if (f.source_file) meta.push(`Source: ${f.source_file}`);
      if (f.context) meta.push(f.context);
      if (meta.length) html += `<div style="font-size:0.73rem;color:var(--text-muted)">${escHtml(meta.join('  \u00B7  '))}</div>`;
      html += `</div>`;
    });
  });

  return html || '<div class="history-empty" style="padding:2rem"><div>No extracted APIs found</div></div>';
}

/* ────────────────────────────────────────────────────────
   OPEN PORTS TAB
   ──────────────────────────────────────────────────────── */
function _renderOpenPortsTab() {
  const ports = _historyDetailScan.scanner?.open_ports || {};
  const subdomains = Object.keys(ports);
  if (subdomains.length === 0) {
    return '<div class="history-empty" style="padding:2rem"><div>No open ports data</div></div>';
  }

  let html = '';
  subdomains.forEach(sub => {
    const data = ports[sub];
    const portList = data.open_ports || [];
    if (portList.length === 0) return;

    html += `<div style="font-weight:600;font-size:0.85rem;margin-top:1rem;margin-bottom:0.5rem;color:var(--text)">${escHtml(sub)}</div>`;
    if (data.ip) html += `<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.4rem">IP: ${escHtml(data.ip)}</div>`;

    html += '<table class="history-endpoint-table" style="margin-bottom:0.75rem"><thead><tr>';
    html += '<th>Port</th><th>Protocol</th><th>Service</th><th>State</th>';
    html += '</tr></thead><tbody>';

    portList.forEach(p => {
      const port = p.port || p;
      const proto = p.protocol || 'tcp';
      const service = p.service || '\u2014';
      const state = p.state || 'open';
      const commonPorts = [80, 443, 8080, 8443];
      const portColor = commonPorts.includes(Number(port)) ? 'color:var(--green)' : 'color:#f59e0b';
      html += '<tr>';
      html += `<td style="font-family:'JetBrains Mono',monospace;font-weight:600;${portColor}">${escHtml(String(port))}</td>`;
      html += `<td>${escHtml(proto)}</td>`;
      html += `<td>${escHtml(service)}</td>`;
      html += `<td>${escHtml(state)}</td>`;
      html += '</tr>';
    });

    html += '</tbody></table>';
  });

  return html || '<div class="history-empty" style="padding:2rem"><div>No open ports found</div></div>';
}

/* ────────────────────────────────────────────────────────
   API SPECS TAB
   ──────────────────────────────────────────────────────── */
function _renderApiSpecsTab() {
  const specs = _historyDetailScan.scanner?.api_specs || {};
  const subdomains = Object.keys(specs);
  if (subdomains.length === 0) {
    return '<div class="history-empty" style="padding:2rem"><div>No API spec findings</div></div>';
  }

  const categoryColors = {
    openapi_spec: '#059669', api_docs_ui: '#3b82f6', graphql: '#ec4899',
    wsdl: '#f97316', api_root: '#6b7280', api_catalog: '#14b8a6',
  };

  let html = '';
  subdomains.forEach(sub => {
    const data = specs[sub];
    const findings = data.findings || [];
    const robotsPaths = data.robots_api_paths || [];
    const sitemapUrls = data.sitemap_api_urls || [];
    const hasContent = findings.length > 0 || robotsPaths.length > 0 || sitemapUrls.length > 0 || data.graphql;
    if (!hasContent) return;

    html += `<div style="font-weight:600;font-size:0.85rem;margin-top:1rem;margin-bottom:0.5rem;color:var(--text)">${escHtml(sub)}</div>`;

    // Grouped findings
    const groups = {};
    for (const f of findings) {
      const cat = f.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(f);
    }

    for (const [cat, items] of Object.entries(groups)) {
      const borderColor = categoryColors[cat] || '#6b7280';
      const catLabel = cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      html += `<div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);margin:0.5rem 0 0.25rem;padding-left:0.5rem;border-left:3px solid ${borderColor}">${escHtml(catLabel)}</div>`;

      for (const f of items) {
        html += `<div class="history-scanner-card" style="border-left-color:${borderColor}">`;
        html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem">`;
        html += `<span style="font-weight:600;font-size:0.82rem">${escHtml(f.name)}</span>`;
        if (f.spec_version) html += `<span style="font-size:0.65rem;font-weight:600;padding:0.1rem 0.4rem;border-radius:4px;background:rgba(124,58,237,0.1);color:#7c3aed;border:1px solid rgba(124,58,237,0.25)">${escHtml(f.spec_version)}</span>`;
        html += `</div>`;
        if (f.description) html += `<div style="font-size:0.78rem;color:var(--text-muted);line-height:1.4">${escHtml(f.description)}</div>`;
        html += `<div style="font-family:'JetBrains Mono',monospace;font-size:0.73rem;color:var(--text-muted);word-break:break-all;margin-top:0.15rem">${escHtml(f.path)}</div>`;
        if (f.file_url) html += `<div style="margin-top:0.15rem"><a href="${escHtml(f.file_url)}" target="_blank" rel="noopener" style="font-size:0.72rem;color:#3b82f6;word-break:break-all">${escHtml(f.file_url)}</a></div>`;
        html += `</div>`;
      }
    }

    // Robots paths (full URLs)
    if (robotsPaths.length > 0) {
      html += `<div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);margin:0.5rem 0 0.25rem;padding-left:0.5rem;border-left:3px solid #6b7280">Robots.txt API Paths (${robotsPaths.length})</div>`;
      for (const p of robotsPaths) {
        html += `<div style="font-family:'JetBrains Mono',monospace;font-size:0.73rem;padding:0.1rem 0 0.1rem 0.5rem"><a href="${escHtml(p)}" target="_blank" rel="noopener" style="color:#3b82f6;word-break:break-all">${escHtml(p)}</a></div>`;
      }
    }

    // Sitemap URLs
    if (sitemapUrls.length > 0) {
      html += `<div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);margin:0.5rem 0 0.25rem;padding-left:0.5rem;border-left:3px solid #14b8a6">Sitemap API URLs (${sitemapUrls.length})</div>`;
      for (const u of sitemapUrls) {
        html += `<div style="font-family:'JetBrains Mono',monospace;font-size:0.73rem;padding:0.1rem 0 0.1rem 0.5rem"><a href="${escHtml(u)}" target="_blank" rel="noopener" style="color:#3b82f6;word-break:break-all">${escHtml(u)}</a></div>`;
      }
    }

    // GraphQL
    if (data.graphql) {
      const gql = data.graphql;
      html += `<div class="history-scanner-card" style="border-left-color:#ec4899">`;
      html += `<div style="font-weight:600;font-size:0.82rem;margin-bottom:0.35rem;color:#ec4899">GraphQL</div>`;
      const gqlUrl = data.url ? `${data.url.replace(/\/$/, '')}${gql.endpoint}` : gql.endpoint;
      html += `<div style="font-size:0.78rem">Endpoint: <a href="${escHtml(gqlUrl)}" target="_blank" rel="noopener" style="color:#3b82f6">${escHtml(gql.endpoint)}</a></div>`;
      html += `<div style="font-size:0.78rem">Introspection: <span style="font-weight:600;color:${gql.introspection_enabled ? '#059669' : '#6b7280'}">${gql.introspection_enabled ? 'Enabled' : 'Disabled'}</span></div>`;
      if (gql.type_count > 0) html += `<div style="font-size:0.78rem">Types: ${gql.type_count}</div>`;
      html += `</div>`;
    }
  });

  return html || '<div class="history-empty" style="padding:2rem"><div>No API spec findings</div></div>';
}

/* ────────────────────────────────────────────────────────
   SUBDOMAINS TAB
   ──────────────────────────────────────────────────────── */
function _renderSubdomainsTab() {
  const subResults = _historyDetailScan.subdomain_results || {};
  const subs = Object.keys(subResults);
  if (subs.length === 0) {
    return '<div class="history-empty" style="padding:2rem"><div>No subdomain data</div></div>';
  }

  let html = '';
  subs.forEach(sub => {
    const info = subResults[sub] || {};
    const status = info.status_code || info.status || null;
    let statusCls = '';
    if (status) {
      const cat = Math.floor(Number(status) / 100);
      if (cat === 2) statusCls = 'color:var(--green)';
      else if (cat === 3) statusCls = 'color:#3b82f6';
      else if (cat === 4) statusCls = 'color:#f59e0b';
      else if (cat === 5) statusCls = 'color:#ef4444';
    }

    html += `<div class="history-scanner-card">`;
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.35rem">`;
    html += `<span style="font-weight:600;font-size:0.9rem;font-family:'JetBrains Mono',monospace">${escHtml(sub)}</span>`;
    if (status) html += `<span style="font-weight:600;font-size:0.8rem;${statusCls}">Status: ${escHtml(String(status))}</span>`;
    html += `</div>`;

    // Technologies
    const techs = info.technologies || info.tech || [];
    if (techs.length > 0) {
      html += `<div style="display:flex;flex-wrap:wrap;gap:0.25rem;margin-bottom:0.35rem">`;
      techs.forEach(t => {
        const name = typeof t === 'string' ? t : (t.name || t);
        html += `<span class="subdomain-tech-tag">${escHtml(String(name))}</span>`;
      });
      html += `</div>`;
    }

    // IP / Server
    const metaParts = [];
    if (info.ip) metaParts.push(`IP: ${info.ip}`);
    if (info.server) metaParts.push(`Server: ${info.server}`);
    if (info.title) metaParts.push(`Title: ${info.title}`);
    if (metaParts.length) html += `<div style="font-size:0.75rem;color:var(--text-muted)">${escHtml(metaParts.join('  \u00B7  '))}</div>`;

    html += `</div>`;
  });

  return html;
}
