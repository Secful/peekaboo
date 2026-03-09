/* Scan History UI — fetch past scans from S3 via REST API */

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
  html += '<th>Domain</th><th>Date</th><th>Duration</th><th>Pages</th><th>Endpoints</th><th>APIs</th><th></th>';
  html += '</tr></thead><tbody>';

  scans.forEach(scan => {
    const date = scan.started_at
      ? new Date(scan.started_at).toLocaleString()
      : scan.scan_key || '—';
    const dur = scan.duration_seconds != null
      ? (scan.duration_seconds >= 60
        ? `${Math.floor(scan.duration_seconds / 60)}m ${scan.duration_seconds % 60}s`
        : `${scan.duration_seconds}s`)
      : '—';
    const scanDomain = scan.domain || domain || '—';

    html += '<tr class="history-row">';
    html += `<td class="history-domain-cell">${escHtml(scanDomain)}</td>`;
    html += `<td>${escHtml(date)}</td>`;
    html += `<td>${escHtml(dur)}</td>`;
    html += `<td>${scan.pages_visited ?? '—'}</td>`;
    html += `<td>${scan.total_endpoints ?? '—'}</td>`;
    html += `<td>${scan.confirmed_apis ?? '—'}</td>`;
    html += `<td><button class="history-view-btn" onclick="viewScanDetail('${escHtml(scanDomain)}','${escHtml(scan.scan_key)}')">View</button></td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  resultsEl.innerHTML = html;
}

async function viewScanDetail(domain, scanKey) {
  const resultsEl = document.getElementById('historyResults');
  const prevHtml = resultsEl.innerHTML;

  resultsEl.innerHTML = `
    <div class="history-loading">
      <div class="spinner"></div>
      <div class="loading-text">Loading scan details...</div>
    </div>`;

  try {
    const resp = await fetch(`/api/scan-history/${encodeURIComponent(domain)}/${encodeURIComponent(scanKey)}`);
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

function renderScanDetail(scan, prevHtml) {
  const resultsEl = document.getElementById('historyResults');
  const results = scan.results || {};

  let html = `<button class="history-back-btn" id="historyBackBtn">&#x2190; Back to list</button>`;
  html += '<div class="history-detail">';
  html += `<h4>${escHtml(scan.domain)} — Scan #${scan.scan_id}</h4>`;
  html += '<div class="history-detail-stats">';
  html += `<div class="hd-stat"><span class="hd-label">Started</span><span class="hd-val">${scan.started_at ? new Date(scan.started_at).toLocaleString() : '—'}</span></div>`;
  html += `<div class="hd-stat"><span class="hd-label">Duration</span><span class="hd-val">${scan.duration_seconds != null ? scan.duration_seconds + 's' : '—'}</span></div>`;
  html += `<div class="hd-stat"><span class="hd-label">Pages</span><span class="hd-val">${results.pages_visited ?? '—'}</span></div>`;
  html += `<div class="hd-stat"><span class="hd-label">Endpoints</span><span class="hd-val">${results.total_endpoints ?? '—'}</span></div>`;
  html += `<div class="hd-stat"><span class="hd-label">Confirmed APIs</span><span class="hd-val">${results.confirmed_apis ?? '—'}</span></div>`;
  html += '</div>';

  // Params
  if (scan.params) {
    html += '<div class="hd-section"><span class="hd-section-title">Scan Parameters</span>';
    html += '<div class="hd-params">';
    Object.entries(scan.params).forEach(([k, v]) => {
      html += `<span class="hd-param">${escHtml(k)}: <strong>${escHtml(String(v))}</strong></span>`;
    });
    html += '</div></div>';
  }

  // Endpoints table
  const endpoints = scan.endpoints || [];
  if (endpoints.length > 0) {
    html += `<div class="hd-section"><span class="hd-section-title">Endpoints (${endpoints.length})</span>`;
    html += '<div class="history-endpoint-table-wrap"><table class="history-endpoint-table"><thead><tr>';
    html += '<th>Method</th><th>Path</th><th>Host</th><th>Status</th><th>Confidence</th>';
    html += '</tr></thead><tbody>';
    endpoints.slice(0, 200).forEach(ep => {
      const statusClass = ep.response_status
        ? `status-${Math.floor(ep.response_status / 100)}xx`
        : '';
      html += '<tr>';
      html += `<td><span class="badge badge-${escHtml(ep.method || 'GET')}">${escHtml(ep.method || '—')}</span></td>`;
      html += `<td class="path-cell">${escHtml(ep.path || '—')}</td>`;
      html += `<td class="host-cell">${escHtml(ep.host || '—')}</td>`;
      html += `<td class="${statusClass}">${ep.response_status || '—'}</td>`;
      html += `<td>${escHtml(ep.api_confidence || '—')}</td>`;
      html += '</tr>';
    });
    if (endpoints.length > 200) {
      html += `<tr><td colspan="5" style="color:var(--text-muted);text-align:center">... and ${endpoints.length - 200} more</td></tr>`;
    }
    html += '</tbody></table></div></div>';
  }

  html += '</div>';
  resultsEl.innerHTML = html;

  document.getElementById('historyBackBtn').addEventListener('click', () => {
    resultsEl.innerHTML = prevHtml;
  });
}
