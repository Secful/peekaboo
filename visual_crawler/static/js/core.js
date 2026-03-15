/* WebSocket, scan lifecycle, timer, event dispatcher, and initialization */

// Timer functions
function updateTimer() {
  if (!appState.scanStartTime) {
    document.getElementById('statTimer').textContent = '00:00';
    return;
  }

  const elapsed = Math.floor((Date.now() - appState.scanStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  document.getElementById('statTimer').textContent = formattedTime;
}

function startTimer() {
  appState.scanStartTime = Date.now();
  updateTimer();
  appState.timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
  if (appState.timerInterval) {
    clearInterval(appState.timerInterval);
    appState.timerInterval = null;
  }
}

function resetTimer() {
  stopTimer();
  appState.scanStartTime = null;
  document.getElementById('statTimer').textContent = '00:00';
}

// Advanced settings toggle
function toggleAdvanced() {
  const settings = document.getElementById('advancedSettings');
  const icon = document.getElementById('advancedIcon');

  if (settings.style.display === 'none') {
    settings.style.display = 'block';
    icon.classList.add('expanded');
  } else {
    settings.style.display = 'none';
    icon.classList.remove('expanded');
  }
}

// WebSocket connection
function ensureWebSocket() {
  return new Promise((resolve, reject) => {
    if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    appState.ws = new WebSocket(`ws://${location.host}/ws`);

    appState.ws.onopen = () => resolve();

    appState.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleEvent(msg);
      } catch (err) {
        console.error('WS message error:', err, e.data?.slice?.(0, 200));
      }
    };

    appState.ws.onclose = () => {
      document.getElementById('liveDot').classList.add('done');
      document.getElementById('statusText').textContent = 'Disconnected';
      document.getElementById('pauseBtn').classList.add('hidden');
      document.getElementById('findingsBtn').classList.add('hidden');
      document.getElementById('stopBtn').classList.add('hidden');
      document.getElementById('newScanBtn').classList.remove('hidden');
      document.getElementById('domainIndicator').classList.add('hidden');
      const badge = document.getElementById('otherScans');
      if (badge) { badge.classList.add('hidden'); badge.textContent = ''; }

      // Check for incomplete scan and warn user
      const queueSize = parseInt(document.getElementById('statQueue').textContent) || 0;
      if (queueSize > 0) {
        addLog('', `Scan incomplete - ${queueSize} URLs remaining in queue`, 'warning');
      }

      // Clear stale queue stats
      document.getElementById('statQueue').textContent = '0';

      appState.ws = null;
      appState.myScanId = null;
    };

    appState.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      addLog('', 'Connection error', 'error');
      reject(err);
    };
  });
}

// Scan lifecycle
async function startScan(event) {
  event.preventDefault();

  const domain = document.getElementById('domain').value.trim();
  if (!domain) {
    alert('Please enter a domain name');
    return;
  }

  // Start scan timer
  startTimer();

  const apiFilterValue = document.querySelector('input[name="apiFilter"]:checked').value;

  const params = {
    domain: domain,
    max_pages: parseInt(document.getElementById('maxPages').value) || 50,
    max_depth: parseInt(document.getElementById('maxDepth').value) || 3,
    timeout: parseInt(document.getElementById('timeout').value) || 30000,
    include_subdomains: document.getElementById('includeSubdomains').checked,
    api_filter: apiFilterValue,
    concurrent_pages: parseInt(document.getElementById('concurrentPages').value) || 5,
    fast_mode: document.getElementById('fastMode').checked,
    use_proxy: document.getElementById('useProxy').checked
  };

  // Store target domain and settings for UI filtering
  appState.targetDomain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  appState.includeSubdomains = params.include_subdomains;

  // Hide the overlay and show controls
  document.getElementById('startOverlay').classList.add('hidden');
  document.getElementById('statusText').textContent = 'Connecting...';
  document.getElementById('pauseBtn').classList.remove('hidden');
  document.getElementById('findingsBtn').classList.remove('hidden');
  document.getElementById('stopBtn').classList.remove('hidden');
  document.getElementById('newScanBtn').classList.add('hidden');
  appState.uiPaused = false; // Reset pause state

  // Show domain indicator
  const domainIndicator = document.getElementById('domainIndicator');
  domainIndicator.textContent = appState.targetDomain;
  domainIndicator.classList.remove('hidden');

  try {
    await ensureWebSocket();
    document.getElementById('statusText').textContent = 'Starting scan...';
    addLog('', `Scan started for ${params.domain}`, 'page');
    appState.ws.send(JSON.stringify(params));
  } catch (err) {
    document.getElementById('statusText').textContent = 'Connection failed';
  }
}

function togglePause() {
  appState.uiPaused = !appState.uiPaused;
  const btn = document.getElementById('pauseBtn');
  const statusText = document.getElementById('statusText');

  if (appState.uiPaused) {
    btn.innerHTML = 'Resume';
    btn.style.background = 'var(--green)';
    btn.style.color = 'var(--navy)';
    statusText.textContent = 'Paused (scan running in background)';
    addLog('', 'UI updates paused - scan continues in background', 'info');
  } else {
    btn.innerHTML = 'Pause';
    btn.style.background = '';
    btn.style.color = '';
    statusText.textContent = 'Scanning...';

    // Refresh UI with all accumulated data
    updateEndpointCounter();
    document.getElementById('statHosts').textContent = appState.hosts.size;

    // Rebuild the table with all endpoints
    const tbody = document.getElementById('tbody');
    tbody.innerHTML = '';
    appState.endpoints.forEach(ep => addEndpointRow(ep, false));
    updateMethodFilters();
    applyFilters();

    addLog('', `UI updates resumed - displaying ${appState.endpoints.length} endpoints`, 'info');
  }
}

function retrySubdomains() {
  if (appState.ws && appState.ws.readyState === WebSocket.OPEN && appState.targetDomain) {
    appState.ws.send(JSON.stringify({ action: 'retry_subdomains', domain: appState.targetDomain }));
  }
}

function stopScan() {
  if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
    appState.ws.send(JSON.stringify({ action: 'stop' }));
  }
  stopTimer();
  document.getElementById('liveDot').classList.add('done');
  document.getElementById('statusText').textContent = 'Stopped';
  document.getElementById('pauseBtn').classList.add('hidden');
  document.getElementById('findingsBtn').classList.add('hidden');
  document.getElementById('stopBtn').classList.add('hidden');
  document.getElementById('newScanBtn').classList.remove('hidden');
  document.getElementById('domainIndicator').classList.add('hidden');
  addLog('', 'Scan terminated by user', '');
}

function newScan() {
  // Clear current data
  appState.endpoints.length = 0;
  appState.hosts.clear();
  appState.activeFilters.clear();
  appState.domainFilter = 'all';
  appState.targetDomain = '';
  appState.currentPage = 1;
  appState.uiPaused = false;
  resetTimer();
  appState.capturedScreenshots = [];
  appState.subdomainResults = null;
  appState.securityInsights = {};
  appState.jsResources = {};
  appState.openPorts = {};
  appState.agentic = {};
  appState.extractedApis = {};
  appState.apiSpecs = {};
  appState.mobileEndpoints = {};
  appState._mobileCards = {};
  _mobileDomainFilter = 'all';

  // Remove dynamically created mobile tab + view
  const mobileTab = document.getElementById('tabMobile');
  if (mobileTab) mobileTab.remove();
  const mobileView = document.getElementById('mobileEndpointsView');
  if (mobileView) mobileView.remove();

  // Reset map state
  Object.keys(appState.geoCache).forEach(k => delete appState.geoCache[k]);
  appState.subdomainViewMode = 'table';
  if (appState.subdomainMapInstance) {
    appState.subdomainMapMarkers.forEach(m => appState.subdomainMapInstance.removeLayer(m));
    appState.subdomainMapMarkers = [];
  }
  document.getElementById('subdomainMapContainer').classList.add('hidden');

  // Reset pause button
  const pauseBtn = document.getElementById('pauseBtn');
  pauseBtn.innerHTML = 'Pause';
  pauseBtn.style.background = '';
  pauseBtn.style.color = '';

  // Hide domain indicator
  document.getElementById('domainIndicator').classList.add('hidden');

  // Reset UI
  document.getElementById('tbody').innerHTML = '';
  document.getElementById('activityLog').innerHTML = '';
  document.getElementById('emptyState').style.display = 'block';
  updateEndpointCounter();
  document.getElementById('statPages').textContent = '0';
  document.getElementById('statHosts').textContent = '0';
  document.getElementById('statQueue').textContent = '0';
  document.getElementById('previewThumb').innerHTML = '<div class="idle-scanner"><span class="idle-scanner-label"><span class="idle-scanner-dot"></span>Scanning</span></div>';
  document.getElementById('previewLabel').textContent = 'Live Preview';
  document.getElementById('previewLive').classList.remove('hidden');
  document.getElementById('previewSummary').classList.add('hidden');
  appState.lastScreenshotBase64 = null;
  document.getElementById('currentUrl').textContent = '\u00A0';
  document.getElementById('methodFilters').innerHTML = '';
  document.getElementById('liveDot').classList.remove('done');
  document.getElementById('statusText').textContent = 'Ready';
  document.getElementById('newScanBtn').classList.add('hidden');

  // Reset domain filter buttons
  ['All', 'Subdomain', 'External'].forEach(f => {
    const btn = document.getElementById(`domain${f}`);
    if (btn) {
      btn.classList.toggle('active', f === 'All');
    }
  });

  // Reset subdomain view
  document.getElementById('subdomainContent').innerHTML = `
    <div class="subdomain-placeholder">
      <div class="icon">🌐</div>
      <div>Start a scan to discover subdomains</div>
    </div>`;
  switchView('endpoints');

  // Show the start form
  document.getElementById('startOverlay').classList.remove('hidden');
}

function switchView(view) {
  const endpointsView = document.getElementById('endpointsView');
  const subdomainsView = document.getElementById('subdomainsView');
  const mobileView = document.getElementById('mobileEndpointsView');
  const tabEndpoints = document.getElementById('tabEndpoints');
  const tabSubdomains = document.getElementById('tabSubdomains');
  const tabMobile = document.getElementById('tabMobile');

  // Hide all views
  endpointsView.style.display = 'none';
  subdomainsView.style.display = 'none';
  if (mobileView) mobileView.style.display = 'none';

  // Deactivate all tabs
  tabEndpoints.classList.remove('active');
  tabSubdomains.classList.remove('active');
  if (tabMobile) tabMobile.classList.remove('active');

  if (view === 'subdomains') {
    subdomainsView.style.display = '';
    tabSubdomains.classList.add('active');
    if (appState.subdomainViewMode === 'map' && appState.subdomainMapInstance) {
      setTimeout(() => appState.subdomainMapInstance.invalidateSize(), 100);
    }
  } else if (view === 'mobile' && mobileView) {
    mobileView.style.display = '';
    if (tabMobile) tabMobile.classList.add('active');
  } else {
    endpointsView.style.display = '';
    tabEndpoints.classList.add('active');
  }
}

// Event dispatcher
function handleEvent(msg) {
  switch(msg.type) {
    case 'status':
      if (!appState.uiPaused) {
        addLog('', msg.message, '');
      }
      break;

    case 'error':
      addLog('', msg.message, 'error');
      document.getElementById('statusText').textContent = 'Error';
      break;

    case 'crawl_start':
      if (!appState.uiPaused) {
        document.getElementById('statPages').textContent = msg.pages_visited;
        document.getElementById('statQueue').textContent = msg.pages_remaining;
        updateEndpointCounter();
        document.getElementById('currentUrl').textContent = msg.url;
        addLog('', `Crawling: ${shortenUrl(msg.url)}`, 'page');
      }
      break;

    case 'heartbeat':
      if (msg.scan_id && msg.scan_id === appState.myScanId) {
        document.getElementById('statPages').textContent = msg.pages_visited || 0;
        document.getElementById('statQueue').textContent = msg.queue_size || 0;
      }
      break;

    case 'screenshot':
      if (msg.scan_id && msg.scan_id !== appState.myScanId) {
        break;
      }

      if (appState.capturedScreenshots.length < 5) {
        appState.capturedScreenshots.push({
          image: msg.image,
          url: msg.url
        });
      }
      if (!appState.uiPaused) {
        document.getElementById('previewThumb').innerHTML = `<img src="data:image/jpeg;base64,${msg.image}" alt="screenshot">`;
        document.getElementById('currentUrl').textContent = msg.url;
        appState.lastScreenshotBase64 = msg.image;
      }
      break;

    case 'endpoint':
      if (!appState.uiPaused) {
        appState.endpoints.push(msg);
        appState.hosts.add(msg.host);
        updateEndpointCounter();
        document.getElementById('statHosts').textContent = appState.hosts.size;
        document.getElementById('emptyState').style.display = 'none';
        addEndpointRow(msg, true);
        updateMethodFilters();
        addLog('', `${msg.method} ${msg.host}${msg.path}`, 'endpoint');
      } else {
        appState.endpoints.push(msg);
        appState.hosts.add(msg.host);
      }
      break;

    case 'active_scans':
      if (msg.your_scan_id) {
        appState.myScanId = msg.your_scan_id;
      }
      renderActiveScans(msg.scans);
      break;

    case 'subdomains_loading':
      appState.subdomainResults = null;
      document.getElementById('tabSubdomains').classList.add('tab-loading');
      document.getElementById('subdomainContent').innerHTML = `
        <div class="subdomain-loading">
          <div class="spinner"></div>
          <div class="loading-text">Discovering subdomains...</div>
          <div class="loading-subtext">This may take up to 3 minutes</div>
        </div>`;
      addLog('', 'Subdomain discovery started...', '');
      break;

    case 'subdomains':
      document.getElementById('tabSubdomains').classList.remove('tab-loading');
      appState.subdomainResults = msg.data;
      renderSubdomainTable(msg.data);
      {
        const subs = normalizeSubdomains(msg.data);
        addLog('', `Subdomain discovery complete: ${subs.length} found`, 'endpoint');
      }
      break;

    case 'subdomains_error':
      document.getElementById('tabSubdomains').classList.remove('tab-loading');
      appState.subdomainResults = null;
      document.getElementById('subdomainContent').innerHTML = `
        <div class="subdomain-error">
          ${escHtml(msg.message)}
          <button class="retry-subdomains-btn" onclick="retrySubdomains()">Retry</button>
        </div>`;
      addLog('', msg.message, 'error');
      break;

    case 'security_insights':
      appState.securityInsights[msg.subdomain] = msg;
      applySecurityPill(msg.subdomain);
      if (msg.findings_count > 0) {
        addLog('', `Security findings for ${msg.subdomain}: ${msg.findings_count} findings`, 'error');
      } else {
        addLog('', `${msg.subdomain}: security scan clean`, '');
      }
      break;

    case 'js_resources':
      appState.jsResources[msg.subdomain] = msg;
      applyJsResources(msg.subdomain, msg.urls || []);
      if (msg.urls_count > 0) {
        addLog('', `JS resources for ${msg.subdomain}: ${msg.urls_count} files`, '');
      } else {
        addLog('', `${msg.subdomain}: no JS resources found`, '');
      }
      break;

    case 'open_ports':
      appState.openPorts[msg.subdomain] = msg;
      applyOpenPortsPill(msg.subdomain);
      if (msg.open_ports_count > 0) {
        addLog('', `Open ports for ${msg.subdomain}: ${msg.open_ports_count} ports`, '');
      }
      break;

    case 'agentic':
      appState.agentic[msg.subdomain] = msg;
      applyAgenticPill(msg.subdomain);
      if (msg.findings_count > 0) {
        addLog('', `Agentic findings for ${msg.subdomain}: ${msg.findings_count} findings`, '');
      }
      break;

    case 'extracted_apis':
      appState.extractedApis[msg.subdomain] = msg;
      applyExtractedApis(msg.subdomain);
      if (msg.findings_count > 0) {
        addLog('', `Extracted APIs for ${msg.subdomain}: ${msg.findings_count} endpoints`, '');
      }
      break;

    case 'api_specs':
      if (msg.findings_count > 0) {
        appState.apiSpecs[msg.subdomain] = msg;
        applyApiSpecPill(msg.subdomain);
        addLog('', `API specs for ${msg.subdomain}: ${msg.findings_count} spec(s) found`, 'api_specs');
      }
      break;

    case 'mobile_endpoints':
      handleMobileEndpoints(msg);
      break;

    case 'android_apps':
      showAndroidToast(msg.apps);
      break;

    case 'crawl_error':
      addLog('', `Error on ${shortenUrl(msg.url)}: ${msg.error}`, 'error');
      break;

    case 'crawl_end':
      break;

    case 'done':
      stopTimer();

      if (msg.technologies) {
        appState.detectedTechnologies = msg.technologies;
        console.log('Technologies detected:', appState.detectedTechnologies);
      }

      document.getElementById('liveDot').classList.add('done');
      document.getElementById('statusText').textContent =
        `Done — ${msg.total_endpoints} endpoints found`;
      document.getElementById('pauseBtn').classList.add('hidden');
      document.getElementById('findingsBtn').classList.add('hidden');
      document.getElementById('stopBtn').classList.add('hidden');
      document.getElementById('newScanBtn').classList.remove('hidden');
      document.getElementById('statQueue').textContent = '0';
      const skippedMsg = msg.pages_skipped > 0 ? ` (${msg.pages_skipped} queued pages skipped)` : '';
      addLog('', `Scan complete. ${msg.total_endpoints} endpoints across ${msg.pages_visited} pages.${skippedMsg}`, '');

      if (appState.uiPaused) {
        appState.uiPaused = false;
        updateEndpointCounter();
        document.getElementById('statHosts').textContent = appState.hosts.size;
        const tbody = document.getElementById('tbody');
        tbody.innerHTML = '';
        appState.endpoints.forEach(ep => addEndpointRow(ep, false));
        updateMethodFilters();
        applyFilters();
      }

      if (msg.total_endpoints === 0) {
        const emptyState = document.getElementById('emptyState');
        emptyState.innerHTML = '<div class="icon">🔍</div><div>No records found</div>';
        emptyState.style.display = 'block';
      }

      document.getElementById('piStatus').textContent = 'Completed';
      document.getElementById('piStatus').style.color = 'var(--green)';
      document.getElementById('piTarget').textContent = appState.targetDomain;

      document.getElementById('previewLabel').textContent = 'Summary';
      document.getElementById('previewLive').classList.add('hidden');
      document.getElementById('previewSummary').classList.remove('hidden');

      showScanSummary(msg);

      if (!appState.subdomainResults) {
        addLog('', 'Subdomain discovery still in progress...', '');
      }

      const scanDuration = appState.scanStartTime ? (Date.now() - appState.scanStartTime) / 1000 : Infinity;
      if (scanDuration < 60) {
        switchView('subdomains');
      }

      // Resolve any remaining security spinners after a grace period
      setTimeout(resolveStaleSecuritySpinners, 90000);
      break;
  }
}

// Mobile Endpoints helpers
function classifyMobileUrl(url, baseUrl, targetDomain) {
  if (!targetDomain) return false;
  const td = targetDomain.toLowerCase();

  // Relative paths (starting with / and no scheme) → domain
  if (url && url.startsWith('/') && !url.startsWith('//')) return true;

  // Check the URL itself for the target domain
  const urlsToCheck = [url, baseUrl].filter(Boolean);
  for (const u of urlsToCheck) {
    try {
      const host = new URL(u).hostname.toLowerCase();
      if (host === td || host.endsWith('.' + td)) return true;
    } catch(e) {
      // Not a valid absolute URL — if it looks like a relative path, it's domain
      if (u && !u.includes('://') && !u.match(/^\d+\.\d+\.\d+\.\d+/)) return true;
    }
  }
  return false;
}

let _mobileDomainFilter = 'all';

function setMobileDomainFilter(filter) {
  _mobileDomainFilter = filter;
  ['All', 'Domain', 'External'].forEach(f => {
    const btn = document.getElementById('mobileFilter' + f);
    if (btn) btn.classList.toggle('active', f.toLowerCase() === filter);
  });
  applyMobileDomainFilter();
}

function applyMobileDomainFilter() {
  const tbody = document.getElementById('mobileEndpointsTbody');
  if (!tbody) return;
  let visibleIdx = 0;
  for (const row of tbody.rows) {
    const domTag = row.dataset.mobileDomain;
    const show = _mobileDomainFilter === 'all' || domTag === _mobileDomainFilter;
    row.style.display = show ? '' : 'none';
    if (show) {
      visibleIdx++;
      row.cells[0].textContent = visibleIdx;
    }
  }
}

function updateMobileFilterCounts() {
  const tbody = document.getElementById('mobileEndpointsTbody');
  const countsEl = document.getElementById('mobileFilterCounts');
  if (!tbody || !countsEl) return;
  let domainCount = 0, externalCount = 0;
  for (const row of tbody.rows) {
    if (row.dataset.mobileDomain === 'domain') domainCount++;
    else externalCount++;
  }
  countsEl.textContent = `${domainCount} domain · ${externalCount} external · ${domainCount + externalCount} total`;
}

// Mobile Endpoints handler
function handleMobileEndpoints(msg) {
  const pkg = msg.package_name || 'unknown';
  const appName = msg.app_name || pkg;
  const findings = msg.findings || [];

  // Decode HTML entities that may arrive pre-encoded from upstream
  const cleanAppName = (() => { const t = document.createElement('textarea'); t.innerHTML = appName; return t.value; })();

  // Only show the tab when we have actual findings
  if (findings.length === 0) {
    addLog('', `📱 Mobile: 0 endpoints from ${pkg} (${cleanAppName})`, '');
    return;
  }

  // Store in appState
  appState.mobileEndpoints[pkg] = msg;

  // Sanitized id for DOM (dots are not valid in getElementById selectors)
  const cardId = 'mobile-app-' + pkg.replace(/\./g, '-');

  // Create tab + view on first call
  if (!document.getElementById('tabMobile')) {
    const tabContainer = document.querySelector('.view-tabs');
    const tabBtn = document.createElement('button');
    tabBtn.className = 'view-tab';
    tabBtn.id = 'tabMobile';
    tabBtn.onclick = () => switchView('mobile');
    tabBtn.textContent = 'Mobile Endpoints';
    tabContainer.appendChild(tabBtn);

    const rightPanel = document.querySelector('.right-panel');
    const viewDiv = document.createElement('div');
    viewDiv.id = 'mobileEndpointsView';
    viewDiv.style.display = 'none';
    viewDiv.innerHTML = `
      <div id="mobileAppsHeader" class="mobile-apps-header"></div>
      <div class="mobile-filter-bar" id="mobileFilterBar">
        <div class="filter-section">
          <span class="filter-label">Domain:</span>
          <span class="filter-btn active" id="mobileFilterAll" onclick="setMobileDomainFilter('all')">All</span>
          <span class="filter-btn" id="mobileFilterDomain" onclick="setMobileDomainFilter('domain')">Domain</span>
          <span class="filter-btn" id="mobileFilterExternal" onclick="setMobileDomainFilter('external')">External</span>
        </div>
        <span class="mobile-filter-counts" id="mobileFilterCounts"></span>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th style="width:35px">#</th>
              <th style="width:70px">Method</th>
              <th style="width:35%">Path</th>
              <th style="width:25%">Description</th>
              <th style="width:80px">Category</th>
              <th style="width:70px">Domain</th>
            </tr>
          </thead>
          <tbody id="mobileEndpointsTbody"></tbody>
        </table>
        <div class="empty-state" id="mobileEmptyState" style="display:none">
          <div class="icon">📱</div>
          <div>Waiting for mobile endpoint data...</div>
        </div>
      </div>`;
    rightPanel.appendChild(viewDiv);
  }

  // Update app header — single card per package, accumulate endpoint count
  const headerDiv = document.getElementById('mobileAppsHeader');
  if (!appState._mobileCards) appState._mobileCards = {};
  let card = appState._mobileCards[pkg];
  if (!card) {
    card = document.createElement('div');
    card.id = cardId;
    card.className = 'mobile-app-card';
    card.dataset.endpointCount = '0';
    headerDiv.appendChild(card);
    appState._mobileCards[pkg] = card;
  }
  const prevCount = parseInt(card.dataset.endpointCount) || 0;
  const totalCount = prevCount + findings.length;
  card.dataset.endpointCount = String(totalCount);

  const playLink = msg.play_url
    ? `<a href="${escHtml(msg.play_url)}" target="_blank" rel="noopener" class="mobile-play-link">Google Play ↗</a>`
    : '';
  card.innerHTML =
    `<div class="mobile-app-info">` +
      `<strong>${escHtml(cleanAppName)}</strong>` +
      `<span class="mobile-app-pkg">${escHtml(pkg)}</span>` +
      (msg.app_version && msg.app_version !== 'unknown' ? `<span class="mobile-app-version">v${escHtml(msg.app_version)}</span>` : '') +
      playLink +
    `</div>` +
    `<div class="mobile-app-stats">` +
      `<span>${totalCount} endpoint${totalCount !== 1 ? 's' : ''}</span>` +
      (msg.analyzed_classes ? `<span>${msg.analyzed_classes} classes analyzed</span>` : '') +
      (msg.scan_duration_secs ? `<span>${msg.scan_duration_secs.toFixed(1)}s</span>` : '') +
    `</div>`;

  // Append rows
  const tbody = document.getElementById('mobileEndpointsTbody');
  const startIdx = tbody.rows.length;

  const targetDomain = appState.targetDomain;

  findings.forEach((f, i) => {
    const row = tbody.insertRow();
    row.classList.add('flash');

    const method = f.method || 'GET';
    const badgeClass = `badge-${method}`;
    const url = f.url || '';

    // Domain relevance: relative paths or URLs containing the target domain = "domain", else "external"
    const isDomain = classifyMobileUrl(url, f.base_url || '', targetDomain);
    row.dataset.mobileDomain = isDomain ? 'domain' : 'external';

    const domainBadge = isDomain
      ? '<span class="mobile-domain-badge mobile-domain-yes">Domain</span>'
      : '<span class="mobile-domain-badge mobile-domain-no">External</span>';

    row.innerHTML =
      `<td class="row-number" style="text-align:center;color:var(--text-muted);font-size:0.85rem;">${startIdx + i + 1}</td>` +
      `<td><span class="badge ${badgeClass}">${escHtml(method)}</span></td>` +
      `<td class="path-cell" title="${escHtml(f.evidence || url)}">${escHtml(trimPath(url))}</td>` +
      `<td class="reason-cell" title="${escHtml(f.context || '')}">${escHtml(f.context ? f.context.charAt(0).toUpperCase() + f.context.slice(1) : '')}</td>` +
      `<td>${f.category ? `<span class="mobile-category">${escHtml(f.category)}</span>` : ''}</td>` +
      `<td>${domainBadge}</td>`;
  });

  updateMobileFilterCounts();
  document.getElementById('mobileEmptyState').style.display = findings.length === 0 ? 'block' : 'none';

  // Log
  addLog('', `📱 Mobile: ${findings.length} endpoints from ${pkg} (${cleanAppName})`, '');
}

// Android App Toast
let _androidToastApps = [];

function showAndroidToast(apps) {
  _androidToastApps = apps;
  const toast = document.getElementById('androidToast');
  const body = document.getElementById('androidToastBody');
  // Reverse domain parts: example.com → com.example
  const domainPrefix = (appState.targetDomain || '').split('.').reverse().join('.').toLowerCase();
  // Sort: checked (relevant) entries first
  const sorted = apps.map((a, i) => ({ app: a, idx: i, relevant: domainPrefix && (a.package_name || '').toLowerCase().includes(domainPrefix) }));
  sorted.sort((a, b) => (b.relevant ? 1 : 0) - (a.relevant ? 1 : 0));
  body.innerHTML = sorted.map(({ app: a, idx, relevant }) => {
    return `<label class="android-toast-app">` +
      `<input type="checkbox" ${relevant ? 'checked' : ''} data-idx="${idx}">` +
      `<div class="app-info"><span class="app-name">${escHtml(a.app_name)}</span>` +
      `<span class="app-pkg">${escHtml(a.package_name)}</span></div>` +
      `<a class="app-play-link" href="${escHtml(a.play_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Google Play ↗</a>` +
    `</label>`;
  }).join('');
  toast.classList.add('show');
}

function confirmAndroidApps() {
  const checkboxes = document.querySelectorAll('#androidToastBody input[type="checkbox"]');
  const selected = [];
  checkboxes.forEach(cb => {
    if (cb.checked) selected.push(_androidToastApps[parseInt(cb.dataset.idx)]);
  });
  if (selected.length > 0 && appState.ws && appState.ws.readyState === WebSocket.OPEN) {
    appState.ws.send(JSON.stringify({ action: 'publish_apk', apps: selected }));
    addLog('', `📱 Queued ${selected.length} app(s) for APK analysis`, '');
  }
  document.getElementById('androidToast').classList.remove('show');
}

function dismissAndroidToast() {
  document.getElementById('androidToast').classList.remove('show');
}

// Live Preview hover: toggle class on .app so enlarged image floats above the endpoint table
(function() {
  const thumb = document.getElementById('previewThumb');
  const app = document.querySelector('.app');
  thumb.addEventListener('mouseenter', function(e) {
    if (e.target.tagName === 'IMG') app.classList.add('preview-hover-active');
  }, true);
  thumb.addEventListener('mouseleave', function(e) {
    if (e.target.tagName === 'IMG') app.classList.remove('preview-hover-active');
  }, true);
})();
