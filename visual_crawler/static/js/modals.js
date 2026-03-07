/* Summary, about, and findings modals */

function _populateSummaryModal(stats) {
  document.getElementById('summaryEndpoints').textContent = stats.totalEndpoints;
  document.getElementById('summaryApiCount').textContent = `${stats.apiCount} confirmed APIs`;
  document.getElementById('summaryPages').textContent = stats.pages;
  document.getElementById('summarySkipped').textContent = stats.skippedText;
  document.getElementById('summaryDuration').textContent = stats.durationText;
  document.getElementById('summaryRate').textContent = stats.pagesPerMin > 0 ? `${stats.pagesPerMin} pages/min` : '';

  const hostArray = Array.from(appState.hosts).sort();
  const subdomainHosts = [];
  const externalDomains = [];
  hostArray.forEach(h => (isDomainHost(h) ? subdomainHosts : externalDomains).push(h));

  document.getElementById('summaryHosts').textContent = appState.hosts.size;
  document.getElementById('summarySubdomains').textContent =
    `${subdomainHosts.length} subdomains, ${externalDomains.length} external`;

  function fillList(elId, items) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    if (items.length > 0) {
      items.forEach(h => { const t = document.createElement('div'); t.className = 'summary-domain-tag'; t.textContent = h; el.appendChild(t); });
    } else {
      el.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">None</span>';
    }
  }
  fillList('summarySubdomainList', subdomainHosts);
  fillList('summaryExternalList', externalDomains);

  document.getElementById('summaryTitle').textContent = stats.title;
}

function showScanSummary(msg) {
  const duration = appState.scanStartTime ? Math.round((Date.now() - appState.scanStartTime) / 1000) : 0;
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const pagesPerMin = minutes > 0 ? Math.round(msg.pages_visited / (duration / 60)) : 0;

  _populateSummaryModal({
    totalEndpoints: msg.total_endpoints,
    apiCount: appState.endpoints.filter(ep => ep.api_confidence === 'API').length,
    pages: msg.pages_visited,
    skippedText: msg.pages_skipped > 0 ? `${msg.pages_skipped} skipped` : '',
    durationText: minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`,
    pagesPerMin,
    title: '✅ Scan Complete',
  });

  setTimeout(() => { document.getElementById('summaryOverlay').classList.add('show'); }, 500);
}

function closeSummary() {
  document.getElementById('summaryOverlay').classList.remove('show');
}

function showCurrentFindings() {
  const duration = appState.scanStartTime ? Math.round((Date.now() - appState.scanStartTime) / 1000) : 0;
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const currentPages = parseInt(document.getElementById('statPages').textContent) || 0;
  const pagesPerMin = minutes > 0 ? Math.round(currentPages / (duration / 60)) : 0;
  const queueSize = parseInt(document.getElementById('statQueue').textContent) || 0;

  _populateSummaryModal({
    totalEndpoints: appState.endpoints.length,
    apiCount: appState.endpoints.filter(ep => ep.api_confidence === 'API').length,
    pages: currentPages,
    skippedText: queueSize > 0 ? `${queueSize} in queue` : '',
    durationText: `${minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`} (ongoing)`,
    pagesPerMin,
    title: '📊 Current Findings',
  });

  document.getElementById('summaryOverlay').classList.add('show');
}

async function showAbout() {
  document.getElementById('aboutOverlay').classList.add('show');

  // Fetch version info
  try {
    const response = await fetch('/api/version');
    const data = await response.json();
    document.getElementById('appVersion').textContent = `v${data.version}`;
    document.getElementById('deployTime').textContent = data.deploy_time;
  } catch (err) {
    console.error('Failed to fetch version info:', err);
    document.getElementById('appVersion').textContent = 'Unknown';
    document.getElementById('deployTime').textContent = 'Unknown';
  }
}

function closeAbout() {
  document.getElementById('aboutOverlay').classList.remove('show');
}

function startNewScan() {
  closeSummary();
  newScan();
}
