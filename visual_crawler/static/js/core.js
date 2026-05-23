/* WebSocket, scan lifecycle, timer, event dispatcher, and initialization */

// ── WebSocket keep-alive heartbeat (prevents ALB idle-timeout disconnect) ──
let _heartbeatInterval = null;
function _startHeartbeat() {
  _stopHeartbeat();
  _heartbeatInterval = setInterval(() => {
    if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
      appState.ws.send(JSON.stringify({ action: 'heartbeat' }));
    }
  }, 30000);
}
function _stopHeartbeat() {
  if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
}

// ── Inactivity-based scan completion ─────────────────────────────────
let _inactivityInterval = null;   // setInterval handle (ticks every 12s)
let _inactivityElapsed  = 0;      // seconds elapsed since last activity
let _doneMsg            = null;   // stored 'done' message for finalization
let _backendDone        = false;  // true once composite 'done' event received
const _INACTIVITY_TIMEOUT = 120;  // total seconds before finalizing
const _INACTIVITY_TICK    = 12;   // seconds per segment (120 / 10)

// ── Reusable notify toast ──────────────────────────────────────────────
function showNotifyToast(message, level = 'info') {
  let container = document.querySelector('.notify-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'notify-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `notify-toast ${level}`;
  toast.innerHTML =
    `<span class="notify-msg">${message}</span>` +
    `<button class="notify-close" aria-label="Close">&times;</button>`;

  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('fade-out');
    toast.addEventListener('transitionend', () => toast.remove());
  };

  toast.querySelector('.notify-close').addEventListener('click', remove);
  setTimeout(remove, 8000);
}

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

// ── Inactivity timer helpers ─────────────────────────────────────────
function _startInactivityTimer() {
  if (_inactivityInterval) { clearInterval(_inactivityInterval); _inactivityInterval = null; }
  const bar  = document.getElementById('inactivityBar');
  const segs = document.getElementById('inactivitySegments').children;
  bar.classList.remove('hidden');
  for (let i = 0; i < segs.length; i++) segs[i].classList.remove('filled');
  _inactivityElapsed = 0;

  _inactivityInterval = setInterval(() => {
    _inactivityElapsed += _INACTIVITY_TICK;
    const idx = Math.floor(_inactivityElapsed / _INACTIVITY_TICK) - 1;
    if (idx >= 0 && idx < segs.length) segs[idx].classList.add('filled');
    if (_inactivityElapsed >= _INACTIVITY_TIMEOUT) _finalizeScan();
  }, _INACTIVITY_TICK * 1000);
}

function _resetInactivityTimer() {
  if (!_inactivityInterval) return;          // timer not started yet
  _inactivityElapsed = 0;
  const segs = document.getElementById('inactivitySegments').children;
  for (let i = 0; i < segs.length; i++) segs[i].classList.remove('filled');
}

function _finalizeScan() {
  if (_inactivityInterval) { clearInterval(_inactivityInterval); _inactivityInterval = null; }
  document.getElementById('inactivityBar').classList.add('hidden');
  document.getElementById('liveDot').classList.add('done');

  // Tell backend to persist the scan to history
  _sendSaveScan();

  if (_backendDone) {
    const total = _doneMsg ? _doneMsg.total_endpoints
                           : document.getElementById('statEndpointsTotal').textContent;
    document.getElementById('statusText').textContent = `Done — ${total} endpoints found`;
    document.getElementById('piStatus').textContent = 'Completed';
    document.getElementById('piStatus').style.color = 'var(--green)';
    if (_doneMsg) showScanSummary(_doneMsg);
  } else {
    stopTimer();
    const total = document.getElementById('statEndpointsTotal').textContent;
    document.getElementById('statusText').textContent = `Done (stalled) — ${total} endpoints found`;
    document.getElementById('piStatus').textContent = 'Stalled';
    document.getElementById('piStatus').style.color = 'var(--yellow, #eab308)';
    document.getElementById('pauseBtn').classList.add('hidden');
    document.getElementById('findingsBtn').classList.add('hidden');
    document.getElementById('stopBtn').classList.add('hidden');
    document.getElementById('addAppBtn').classList.add('hidden');
    document.getElementById('newScanBtn').classList.remove('hidden');
    addLog('', 'Scan finalized — 2 minutes of inactivity', 'warning');
    showCurrentFindings();
  }
}

function _sendSaveScan() {
  console.log('[Save] Saving scan...', {
    scanId: appState.myScanId,
    domain: appState.targetDomain,
    wsState: appState.ws ? appState.ws.readyState : 'null',
    wsOpen: appState.ws && appState.ws.readyState === WebSocket.OPEN
  });

  // Send save_scan via WebSocket if connected
  if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
    appState.ws.send(JSON.stringify({ action: 'save_scan' }));
    console.log('[Save] save_scan message sent via WebSocket');
  } else {
    console.warn('[Save] WebSocket not open, skipping WS save_scan message');
  }

  // Always try HTML report generation via HTTP (independent of WebSocket state)
  _saveHTMLReport();
}

// Generate and save HTML report after scan completes
async function _saveHTMLReport() {
  console.log('[HTML Report] Starting HTML report generation...', {
    scanId: appState.myScanId,
    domain: appState.targetDomain,
    endpoints: appState.endpoints.length,
    hosts: appState.hosts.size
  });

  if (!appState.myScanId || !appState.targetDomain) {
    console.error('[HTML Report] ❌ Cannot save HTML report: missing scan_id or domain', {
      scanId: appState.myScanId,
      domain: appState.targetDomain
    });
    return;
  }

  try {
    // Compute stats from appState (don't rely on DOM which may not be populated yet)
    const duration = appState.scanStartTime ? Math.round((Date.now() - appState.scanStartTime) / 1000) : 0;
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    const durationText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    const totalEndpoints = appState.endpoints.length;
    const confirmedApis = appState.endpoints.filter(ep => ep.api_confidence === 'API' || ep.method === 'GET*').length;
    const apiCountText = `${confirmedApis} confirmed APIs`;

    // Compute pages visited from _doneMsg or fall back to live count
    const pagesVisited = _doneMsg ? _doneMsg.pages_visited : document.getElementById('statPagesVisited')?.textContent || '0';

    // Separate subdomains from external domains
    const hostArray = Array.from(appState.hosts).sort();
    const subdomainHosts = [];
    const externalDomains = [];
    hostArray.forEach(h => {
      const isSubdomain = h.toLowerCase() === appState.targetDomain.toLowerCase() ||
                          h.toLowerCase().endsWith('.' + appState.targetDomain.toLowerCase());
      if (isSubdomain) {
        subdomainHosts.push(h);
      } else {
        externalDomains.push(h);
      }
    });

    const reportData = {
      scanDate: new Date().toLocaleString(),
      totalEndpoints: totalEndpoints.toString(),
      apiCount: apiCountText,
      pagesVisited: pagesVisited.toString(),
      duration: durationText,
      hostsCount: appState.hosts.size.toString(),
      breakdown: `${subdomainHosts.length} subdomains, ${externalDomains.length} external`,
      subdomains: subdomainHosts,
      externals: externalDomains
    };

    console.log('[HTML Report] Generating HTML from data...', {
      totalEndpoints: reportData.totalEndpoints,
      pagesVisited: reportData.pagesVisited,
      subdomains: subdomainHosts.length,
      externals: externalDomains.length
    });

    // Generate HTML with computed data
    const html = generateReportHTML(reportData);

    console.log('[HTML Report] HTML generated, sending to server...', {
      htmlSize: html.length,
      domain: appState.targetDomain,
      scanId: appState.myScanId
    });

    // Send to backend
    const response = await fetch('/api/save-html-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: appState.targetDomain,
        scan_id: appState.myScanId,
        html_content: html
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to save HTML report: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log('[HTML Report] ✅ HTML report saved successfully to S3', result);
  } catch (error) {
    console.error('[HTML Report] ❌ Failed to save HTML report:', {
      error: error.message,
      stack: error.stack,
      domain: appState.targetDomain,
      scanId: appState.myScanId
    });
    // Show notification to user
    addLog('', 'HTML report generation failed, but scan data was saved', 'warning');
  }
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

// Log tab switching
function switchLogTab(tab) {
  const activityLog = document.getElementById('activityLog');
  const apkLog = document.getElementById('apkAnalysisLog');
  const tabActivity = document.getElementById('logTabActivity');
  const tabApk = document.getElementById('logTabApk');

  activityLog.style.display = 'none';
  apkLog.style.display = 'none';
  tabActivity.classList.remove('active');
  tabApk.classList.remove('active');

  if (tab === 'apk') {
    apkLog.style.display = '';
    tabApk.classList.add('active');
    tabApk.classList.remove('has-new');
  } else {
    activityLog.style.display = '';
    tabActivity.classList.add('active');
  }
}

function addApkLog(msg) {
  _resetInactivityTimer();
  const log = document.getElementById('apkAnalysisLog');
  const entry = document.createElement('div');
  const level = (msg.level || 'INFO').toUpperCase();
  let levelClass = 'apk-info';
  if (level === 'WARNING') levelClass = 'apk-warning';
  else if (level === 'ERROR') levelClass = 'apk-error';
  entry.className = `log-entry ${levelClass}`;
  const pkg = msg.package_name || '';
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  entry.textContent = `${ts} [${pkg}] ${msg.message || ''}`;
  log.prepend(entry);

  // Cap at 200 entries
  while (log.children.length > 200) log.lastChild.remove();

  // Flash the APK tab if it's not active
  const tabApk = document.getElementById('logTabApk');
  if (!tabApk.classList.contains('active')) {
    tabApk.classList.add('has-new');
  }
}

// WebSocket connection
function ensureWebSocket() {
  return new Promise((resolve, reject) => {
    if (appState.ws && appState.ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    appState.ws = new WebSocket(`${wsProto}://${location.host}/ws`);

    appState.ws.onopen = () => { _startHeartbeat(); resolve(); };

    appState.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleEvent(msg);
      } catch (err) {
        console.error('WS message error:', err, e.data?.slice?.(0, 200));
      }
    };

    appState.ws.onclose = () => {
      _stopHeartbeat();
      if (_inactivityInterval) _finalizeScan();

      document.getElementById('liveDot').classList.add('done');
      document.getElementById('statusText').textContent = 'Disconnected';
      document.getElementById('pauseBtn').classList.add('hidden');
      document.getElementById('findingsBtn').classList.add('hidden');
      document.getElementById('stopBtn').classList.add('hidden');
      document.getElementById('addAppBtn').classList.add('hidden');
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
    use_proxy: document.getElementById('useProxy').checked,
    interaction_level: document.getElementById('interactionLevel')?.value || 'standard'
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
  document.getElementById('addAppBtn').classList.remove('hidden');
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
    _startInactivityTimer();
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
  if (_inactivityInterval) { clearInterval(_inactivityInterval); _inactivityInterval = null; }
  document.getElementById('inactivityBar').classList.add('hidden');
  _sendSaveScan();
  stopTimer();
  document.getElementById('liveDot').classList.add('done');
  document.getElementById('statusText').textContent = 'Stopped';
  document.getElementById('pauseBtn').classList.add('hidden');
  document.getElementById('findingsBtn').classList.add('hidden');
  document.getElementById('stopBtn').classList.add('hidden');
  document.getElementById('addAppBtn').classList.add('hidden');
  document.getElementById('newScanBtn').classList.remove('hidden');
  document.getElementById('domainIndicator').classList.add('hidden');
  addLog('', 'Scan terminated by user', '');
}

function newScan() {
  // Reset inactivity / done state
  _doneMsg = null;
  _backendDone = false;
  if (_inactivityInterval) { clearInterval(_inactivityInterval); _inactivityInterval = null; }
  _inactivityElapsed = 0;
  document.getElementById('inactivityBar').classList.add('hidden');

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
  appState.gitFindings = null;
  appState.mobileEndpoints = {};
  appState._mobileCards = {};
  appState.serviceMeshDescriptions = null;
  appState.crawlComplete = false;
  appState.mobileAnalysisTriggered = false;
  appState.mobileAnalysisComplete = false;
  _subdomainsActivityDone = false;
  _mobileDomainFilter = 'all';
  _mobileCategoryFilter = 'all';
  _mobileAppFilter = 'all';
  _mobileStatusFilter = 'all';
  _mobileKnownCategories.clear();
  _mobileKnownApps.clear();
  _mobileSeenEndpoints.clear();
  Object.keys(_mobileTrafficResults).forEach(k => delete _mobileTrafficResults[k]);

  // Remove dynamically created mobile tab + view
  const mobileTab = document.getElementById('tabMobile');
  if (mobileTab) mobileTab.remove();
  const mobileView = document.getElementById('mobileEndpointsView');
  if (mobileView) mobileView.remove();

  // Remove dynamically created git specs tab + view
  const gitSpecsTab = document.getElementById('tabGitSpecs');
  if (gitSpecsTab) gitSpecsTab.remove();
  const gitSpecsView = document.getElementById('gitSpecsView');
  if (gitSpecsView) gitSpecsView.remove();

  // Remove dynamically created headers sub-tab button; reset content
  const evtHeaders = document.getElementById('evtHeaders');
  if (evtHeaders) evtHeaders.remove();
  const headersContentEl = document.getElementById('headersContent');
  if (headersContentEl) headersContentEl.innerHTML = '';
  appState.headerAnalysis = { responseHeaderMap: {}, requestHeaderMap: {}, findings: {}, score: null, endpointsAnalyzed: 0 };
  _headersSubTab = 'heatmap';
  _headersHeatmapShowAll = false;

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
  document.getElementById('apkAnalysisLog').innerHTML = '';
  switchLogTab('activity');
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
  document.getElementById('addAppBtn').classList.add('hidden');
  _androidToastApps = [];

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

  // Reset service mesh view and toggle back to table
  document.getElementById('serviceMeshContent').innerHTML = `
    <div class="subdomain-placeholder">
      <div class="icon">🕸</div>
      <div>Start a scan to visualize the service mesh</div>
    </div>`;
  switchEndpointSubView('table');

  switchView('endpoints');

  // Show the start form
  document.getElementById('startOverlay').classList.remove('hidden');
  const domainInput = document.getElementById('domain');
  domainInput.value = '';
  domainInput.focus();
}

function switchView(view) {
  const endpointsView = document.getElementById('endpointsView');
  const subdomainsView = document.getElementById('subdomainsView');
  const mobileView = document.getElementById('mobileEndpointsView');
  const gitSpecsView = document.getElementById('gitSpecsView');
  const tabEndpoints = document.getElementById('tabEndpoints');
  const tabSubdomains = document.getElementById('tabSubdomains');
  const tabMobile = document.getElementById('tabMobile');
  const tabGitSpecs = document.getElementById('tabGitSpecs');

  // Hide all views
  endpointsView.style.display = 'none';
  subdomainsView.style.display = 'none';
  if (mobileView) mobileView.style.display = 'none';
  if (gitSpecsView) gitSpecsView.style.display = 'none';

  // Deactivate all tabs
  tabEndpoints.classList.remove('active');
  tabSubdomains.classList.remove('active');
  if (tabMobile) tabMobile.classList.remove('active');
  if (tabGitSpecs) tabGitSpecs.classList.remove('active');

  if (view === 'subdomains') {
    subdomainsView.style.display = '';
    tabSubdomains.classList.add('active');
    if (appState.subdomainViewMode === 'map' && appState.subdomainMapInstance) {
      setTimeout(() => appState.subdomainMapInstance.invalidateSize(), 100);
    }
  } else if (view === 'mobile' && mobileView) {
    mobileView.style.display = '';
    if (tabMobile) tabMobile.classList.add('active');
  } else if (view === 'gitspecs' && gitSpecsView) {
    gitSpecsView.style.display = '';
    if (tabGitSpecs) tabGitSpecs.classList.add('active');
  } else {
    endpointsView.style.display = '';
    tabEndpoints.classList.add('active');
  }
}

// Toggle between Table and Mesh sub-views within Web Endpoints
function switchEndpointSubView(subView) {
  const tableView = document.getElementById('endpointTableView');
  const meshView = document.getElementById('serviceMeshView');
  const headersSubView = document.getElementById('headersSubView');
  const webSocketView = document.getElementById('webSocketView');
  const btnTable = document.getElementById('evtTable');
  const btnMesh = document.getElementById('evtMesh');
  const btnHeaders = document.getElementById('evtHeaders');
  const btnWebSocket = document.getElementById('evtWebSocket');

  btnTable.classList.toggle('active', subView === 'table');
  btnMesh.classList.toggle('active', subView === 'mesh');
  if (btnHeaders) btnHeaders.classList.toggle('active', subView === 'headers');
  if (btnWebSocket) btnWebSocket.classList.toggle('active', subView === 'websocket');

  tableView.style.display = 'none';
  meshView.style.display = 'none';
  if (headersSubView) headersSubView.style.display = 'none';
  if (webSocketView) webSocketView.style.display = 'none';

  if (subView === 'mesh') {
    meshView.style.display = '';
    renderServiceMesh();
  } else if (subView === 'headers' && headersSubView) {
    headersSubView.style.display = '';
    renderHeadersView();
  } else if (subView === 'websocket' && webSocketView) {
    webSocketView.style.display = '';
    renderWebSocketView();
  } else {
    tableView.style.display = '';
  }
}

// Waiting status helper — shows what activities are still pending
let _subdomainsActivityDone = false;
function updateWaitingStatus() {
  if (!appState.crawlComplete) return; // crawl hasn't finished yet
  const pending = [];
  if (!_subdomainsActivityDone) pending.push('subdomain discovery');
  if (appState.mobileAnalysisTriggered && !appState.mobileAnalysisComplete) pending.push('mobile analysis');
  if (pending.length > 0) {
    document.getElementById('statusText').textContent =
      `Browsing complete, waiting for ${pending.join(' and ')}...`;
  }
  // If nothing is pending, the composite 'done' event will update the status
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

        // Show WebSocket tab if this is a WebSocket endpoint
        if (msg.method === 'WEBSOCKET') {
          const wsTab = document.getElementById('evtWebSocket');
          if (wsTab && wsTab.style.display === 'none') {
            wsTab.style.display = '';
          }
          // Update WebSocket view count
          const wsView = document.getElementById('webSocketView');
          if (wsView && wsView.style.display !== 'none') {
            renderWebSocketView();
          }
        }

        // Special logging for WebSocket with security indicator
        if (msg.method === 'WEBSOCKET') {
          const isSecure = msg.full_url.startsWith('wss://');
          const protocol = isSecure ? 'WSS' : 'WS';
          const securityClass = isSecure ? 'endpoint' : 'warning';
          const icon = isSecure ? '🔌' : '⚠️';
          const securityNote = isSecure ? '' : ' (INSECURE - no TLS)';
          addLog(icon, `${protocol} ${msg.host}${msg.path}${securityNote}`, securityClass);
        } else {
          addLog('', `${msg.method} ${msg.host}${msg.path}`, 'endpoint');
        }
      } else {
        appState.endpoints.push(msg);
        appState.hosts.add(msg.host);
      }
      updateHeaderAnalysis(msg);
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

    case 'git_findings': {
      const dur = msg.scan_duration_secs ? ` (${msg.scan_duration_secs.toFixed(1)}s)` : '';
      if (msg.findings && msg.findings.length > 0) {
        addLog('', `Git scan: found ${msg.findings.length} API spec(s) in public repos${dur}`, 'endpoint');
        msg.findings.forEach(f => {
          addLog('', `  ${f.source}: ${f.repo} \u2014 ${f.spec_type} (${f.discovery_method})`, '');
        });
        appState.gitFindings = msg;
        handleGitFindings(msg);
      } else {
        addLog('', `Git scan: no API specs found in public repos${dur}`, '');
      }
      if (msg.errors && msg.errors.length > 0) {
        msg.errors.forEach(err => {
          addLog('', `Git scan warning: ${err}`, 'warning');
        });
      }
      break;
    }

    case 'mobile_endpoints':
      handleMobileEndpoints(msg);
      break;

    case 'mobile_traffic':
      handleMobileTraffic(msg);
      break;

    case 'ws_message':
      handleWsMessage(msg);
      break;
      break;

    case 'android_apps':
      showAndroidToast(msg.apps);
      break;

    case 'android_not_found':
      showNotifyToast(`No mobile app detected for ${msg.domain} — mobile endpoints won't be available`, 'info');
      break;

    case 'apk_publish_failed':
      showNotifyToast('Mobile endpoint analysis could not start — check Activity log for details', 'warning');
      break;

    case 'apk_status':
      addApkLog(msg);
      if (/flutter/i.test(msg.message || '') && /not supported/i.test(msg.message || '')) {
        showNotifyToast(`The Android app "${msg.package_name || 'detected app'}" is a Flutter-based app, which we can't analyze yet. Mobile endpoints won't be available for this app.`, 'warning');
      } else if ((msg.level || '').toUpperCase() === 'ERROR') {
        showNotifyToast('Mobile endpoint analysis encountered an issue — check Activity log for details', 'warning');
      }
      break;

    case 'activity_complete':
      if (msg.activity === 'crawl') {
        appState.crawlComplete = true;
        if (msg.technologies) {
          appState.detectedTechnologies = msg.technologies;
        }
        updateWaitingStatus();
      } else if (msg.activity === 'subdomains') {
        _subdomainsActivityDone = true;
        updateWaitingStatus();
      } else if (msg.activity === 'mobile') {
        appState.mobileAnalysisComplete = true;
        if (msg.timed_out) {
          addLog('', 'Mobile analysis timed out — proceeding with available results', 'warning');
        }
        updateWaitingStatus();
      }
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

      // Intermediate status — final "Completed" deferred to inactivity timer
      document.getElementById('statusText').textContent =
        'Browsing complete \u2014 analyzing subdomains\u2026';
      document.getElementById('pauseBtn').classList.add('hidden');
      document.getElementById('findingsBtn').classList.add('hidden');
      document.getElementById('stopBtn').classList.add('hidden');
      document.getElementById('addAppBtn').classList.add('hidden');
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

      document.getElementById('piStatus').textContent = 'Analyzing\u2026';
      document.getElementById('piTarget').textContent = appState.targetDomain;

      document.getElementById('previewLabel').textContent = 'Summary';
      document.getElementById('previewLive').classList.add('hidden');
      document.getElementById('previewSummary').classList.remove('hidden');

      const scanDuration = appState.scanStartTime ? (Date.now() - appState.scanStartTime) / 1000 : Infinity;
      if (scanDuration < 60) {
        switchView('subdomains');
      }

      // Resolve any remaining security spinners after a grace period
      setTimeout(resolveStaleSecuritySpinners, 90000);

      // Mark backend done and reset inactivity countdown for post-crawl analysis
      _doneMsg = msg;
      _backendDone = true;
      _resetInactivityTimer();   // fresh 120s window for post-crawl analysis
      break;
  }
}

// Mobile Endpoints helpers
function classifyMobileUrl(url, baseUrl, targetDomain) {
  if (!targetDomain) return false;
  const td = targetDomain.toLowerCase().replace(/^www\./, '');

  function hostMatchesDomain(host) {
    const h = host.replace(/^www\./, '');
    return h === td || h.endsWith('.' + td);
  }

  // If base_url is present and parseable, it determines the domain
  if (baseUrl) {
    try {
      const baseHost = new URL(baseUrl).hostname.toLowerCase();
      return hostMatchesDomain(baseHost);
    } catch(e) { /* not a valid URL, fall through */ }
  }

  // Check the URL itself
  if (url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return hostMatchesDomain(host);
    } catch(e) {
      // Not a valid absolute URL — relative paths belong to the domain (no base_url to say otherwise)
      if (!url.includes('://') && !url.match(/^\d+\.\d+\.\d+\.\d+/)) return true;
    }
  }

  return false;
}

let _mobileDomainFilter = 'all';
let _mobileCategoryFilter = 'all';
let _mobileAppFilter = 'all';
let _mobileStatusFilter = 'all';
const _mobileKnownCategories = new Set();
const _mobileSeenEndpoints = new Set();
const _mobileKnownApps = new Map(); // pkg → appName

// Mobile traffic test results: key "pkg|METHOD|normUrl" → traffic payload
const _mobileTrafficResults = {};

function setMobileDomainFilter(filter) {
  _mobileDomainFilter = filter;
  ['All', 'Domain', 'External'].forEach(f => {
    const btn = document.getElementById('mobileFilter' + f);
    if (btn) btn.classList.toggle('active', f.toLowerCase() === filter);
  });
  applyMobileDomainFilter();
}

function setMobileCategoryFilter(cat) {
  _mobileCategoryFilter = cat;
  // Sync dropdown trigger text
  const dd = document.getElementById('mobileCategoryDropdown');
  if (dd) {
    const item = dd.querySelector(`[data-value="${CSS.escape(cat)}"]`);
    const label = item ? item.textContent : cat;
    dd.querySelector('.salt-dropdown-trigger').textContent = label;
    dd.querySelectorAll('.salt-dropdown-item').forEach(i => i.classList.toggle('active', i.dataset.value === cat));
  }
  applyMobileDomainFilter();
}

function setMobileAppFilter(pkg) {
  _mobileAppFilter = pkg;
  // Sync dropdown trigger text
  const dd = document.getElementById('mobileAppDropdown');
  if (dd) {
    const item = dd.querySelector(`[data-value="${CSS.escape(pkg)}"]`);
    const label = item ? item.textContent : pkg;
    dd.querySelector('.salt-dropdown-trigger').textContent = label;
    dd.querySelectorAll('.salt-dropdown-item').forEach(i => i.classList.toggle('active', i.dataset.value === pkg));
  }
  applyMobileDomainFilter();
}

function setMobileStatusFilter(val) {
  _mobileStatusFilter = val;
  applyMobileDomainFilter();
}

// Salt-styled custom dropdown helpers
function toggleSaltDropdown(id) {
  const dd = document.getElementById(id);
  if (!dd) return;
  const wasOpen = dd.classList.contains('open');
  // Close all open dropdowns first
  document.querySelectorAll('.salt-dropdown.open').forEach(d => d.classList.remove('open'));
  if (!wasOpen) dd.classList.add('open');
}

function selectSaltDropdown(id, value, label, callback) {
  const dd = document.getElementById(id);
  if (!dd) return;
  dd.querySelector('.salt-dropdown-trigger').textContent = label;
  dd.querySelectorAll('.salt-dropdown-item').forEach(item => {
    item.classList.toggle('active', item.dataset.value === value);
  });
  dd.classList.remove('open');
  if (callback) callback(value);
}

function addSaltDropdownOption(id, value, label, callback) {
  const dd = document.getElementById(id);
  if (!dd) return;
  const menu = dd.querySelector('.salt-dropdown-menu');
  if (!menu) return;
  // Skip if already exists
  if (menu.querySelector(`[data-value="${CSS.escape(value)}"]`)) return;
  const item = document.createElement('div');
  item.className = 'salt-dropdown-item';
  item.dataset.value = value;
  item.textContent = label;
  item.onclick = () => selectSaltDropdown(id, value, label, callback);
  menu.appendChild(item);
}

// Close dropdowns on outside click
document.addEventListener('click', function(e) {
  if (!e.target.closest('.salt-dropdown')) {
    document.querySelectorAll('.salt-dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

function applyMobileDomainFilter() {
  const tbody = document.getElementById('mobileEndpointsTbody');
  if (!tbody) return;
  const searchEl = document.getElementById('mobileSearchInput');
  const query = searchEl ? searchEl.value.toLowerCase() : '';
  let visibleIdx = 0;
  for (const row of tbody.rows) {
    const domTag = row.dataset.mobileDomain;
    const domainOk = _mobileDomainFilter === 'all' || domTag === _mobileDomainFilter;
    const catText = (row.cells[4] && row.cells[4].textContent || '').trim().toLowerCase();
    const categoryOk = _mobileCategoryFilter === 'all' || catText === _mobileCategoryFilter.toLowerCase();
    const appOk = _mobileAppFilter === 'all' || row.dataset.mobilePkg === _mobileAppFilter;
    let statusOk = true;
    if (_mobileStatusFilter !== 'all') {
      const key = row.dataset.mobileKey || '';
      const traffic = _mobileTrafficResults[key];
      if (_mobileStatusFilter === 'tested') {
        statusOk = !!traffic;
      } else if (_mobileStatusFilter === 'untested') {
        statusOk = !traffic;
      } else if (traffic) {
        const sc = traffic.status_code || 0;
        if (_mobileStatusFilter === '2xx') statusOk = sc >= 200 && sc < 300;
        else if (_mobileStatusFilter === '3xx') statusOk = sc >= 300 && sc < 400;
        else if (_mobileStatusFilter === '4xx') statusOk = sc >= 400 && sc < 500;
        else if (_mobileStatusFilter === '5xx') statusOk = sc >= 500;
        else if (_mobileStatusFilter === 'err') statusOk = sc === 0;
        else statusOk = false;
      } else {
        statusOk = false;
      }
    }
    let searchOk = true;
    if (query) {
      const method = (row.cells[1] && row.cells[1].textContent || '').toLowerCase();
      const path = (row.cells[2] && row.cells[2].textContent || '').toLowerCase();
      const desc = (row.cells[3] && row.cells[3].textContent || '').toLowerCase();
      searchOk = method.includes(query) || path.includes(query) || desc.includes(query);
    }
    const show = domainOk && categoryOk && appOk && statusOk && searchOk;
    row.style.display = show ? '' : 'none';
    if (show) {
      visibleIdx++;
      row.cells[0].textContent = visibleIdx;
    }
  }
  updateMobileFilterCounts();
}

function updateMobileFilterCounts() {
  const tbody = document.getElementById('mobileEndpointsTbody');
  const countsEl = document.getElementById('mobileFilterCounts');
  if (!tbody || !countsEl) return;
  let domainCount = 0, externalCount = 0, visibleCount = 0;
  for (const row of tbody.rows) {
    if (row.dataset.mobileDomain === 'domain') domainCount++;
    else externalCount++;
    if (row.style.display !== 'none') visibleCount++;
  }
  const total = domainCount + externalCount;
  const filtered = visibleCount < total ? `${visibleCount} shown · ` : '';
  countsEl.textContent = `${filtered}${domainCount} domain · ${externalCount} external · ${total} total`;
}

// Mobile Endpoint Detail Drawer
function openMobileDrawer(finding, pkg) {
  const drawer = document.getElementById('detailDrawer');
  const content = document.getElementById('drawerContent');
  const appData = appState.mobileEndpoints[pkg] || {};

  const method = finding.method || 'GET';
  const url = finding.url || '';
  const badgeClass = 'badge-' + method;

  const isDomain = classifyMobileUrl(url, finding.base_url || '', appState.targetDomain);
  const domainBadge = isDomain
    ? '<span class="mobile-domain-badge mobile-domain-yes">Domain</span>'
    : '<span class="mobile-domain-badge mobile-domain-no">External</span>';

  let html = '';

  // 1 — HTTP Method
  html += `<div class="detail-section"><div class="detail-label">HTTP Method</div><div class="detail-value"><span class="badge ${badgeClass}">${escHtml(method)}</span></div></div>`;

  // 2 — Full URL
  html += `<div class="detail-section"><div class="detail-label">Full URL</div><div class="detail-value" style="word-break:break-all">${escHtml(url)}</div></div>`;

  // 3 — Base URL (conditional)
  if (finding.base_url) {
    html += `<div class="detail-section"><div class="detail-label">Base URL</div><div class="detail-value" style="word-break:break-all">${escHtml(finding.base_url)}</div></div>`;
  }

  // 3b — Base URL Candidates (conditional)
  if (finding.base_url_candidates && finding.base_url_candidates.length > 0) {
    html += `<div class="detail-section"><div class="detail-label">Base URL Candidates</div><div class="detail-value"><ul class="mobile-base-url-list">`;
    for (const c of finding.base_url_candidates) {
      html += `<li>${escHtml(c)}</li>`;
    }
    html += `</ul></div></div>`;
  }

  // 4 — Domain Classification
  html += `<div class="detail-section"><div class="detail-label">Domain Classification</div><div class="detail-value">${domainBadge}</div></div>`;

  // 5 — Description (conditional)
  if (finding.context) {
    html += `<div class="detail-section"><div class="detail-label">Description</div><div class="detail-value">${escHtml(finding.context)}</div></div>`;
  }

  // 6 — Category (conditional)
  if (finding.category) {
    html += `<div class="detail-section"><div class="detail-label">Category</div><div class="detail-value"><span class="mobile-category">${escHtml(finding.category)}</span></div></div>`;
  }

  // 7 — Source Class (conditional)
  if (finding.source_class) {
    html += `<div class="detail-section"><div class="detail-label">Source Class</div><div class="detail-value" style="word-break:break-all;font-family:monospace;font-size:0.85rem">${escHtml(finding.source_class)}</div></div>`;
  }

  // 8 — Confidence (conditional)
  if (finding.confidence != null) {
    html += `<div class="detail-section"><div class="detail-label">Confidence</div><div class="detail-value">${finding.confidence}%</div></div>`;
  }

  // 9 — Code Evidence (conditional, collapsible)
  if (finding.evidence) {
    html += `<div class="detail-section"><div class="detail-label" style="cursor:pointer" onclick="this.nextElementSibling.classList.toggle('collapsed')">Code Evidence ▾</div><pre class="drawer-body-pre">${escHtml(finding.evidence)}</pre></div>`;
  }

  // — Traffic Test section (conditional)
  const _trafficNormUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  const _trafficKey = `${pkg}|${method}|${_trafficNormUrl}`;
  const _trafficData = _mobileTrafficResults[_trafficKey];
  if (_trafficData) {
    html += `<div class="detail-section" style="border-top:1px solid var(--border);margin-top:0.75rem;padding-top:0.75rem"><div class="detail-label" style="font-weight:700;font-size:0.9rem">Traffic Test</div></div>`;

    // Status Code badge
    const _tsc = _trafficData.status_code || 0;
    let _tBadgeClass, _tBadgeText;
    if (_tsc === 0) { _tBadgeClass = 'mobile-traffic-err'; _tBadgeText = 'ERR'; }
    else if (_tsc >= 200 && _tsc < 300) { _tBadgeClass = 'mobile-traffic-2xx'; _tBadgeText = String(_tsc); }
    else if (_tsc >= 300 && _tsc < 400) { _tBadgeClass = 'mobile-traffic-3xx'; _tBadgeText = String(_tsc); }
    else if (_tsc >= 400 && _tsc < 500) { _tBadgeClass = 'mobile-traffic-4xx'; _tBadgeText = String(_tsc); }
    else { _tBadgeClass = 'mobile-traffic-5xx'; _tBadgeText = String(_tsc); }
    html += `<div class="detail-section"><div class="detail-label">Status Code</div><div class="detail-value"><span class="mobile-traffic-badge ${_tBadgeClass}">${_tBadgeText}</span></div></div>`;

    // Confidence
    if (_trafficData.confidence != null) {
      const _conf = _trafficData.confidence;
      const _confCls = _conf >= 80 ? 'conf-high' : _conf >= 40 ? 'conf-med' : 'conf-low';
      html += `<div class="detail-section"><div class="detail-label">Endpoint Confidence</div><div class="detail-value"><span class="mobile-traffic-conf ${_confCls}">${_conf}%</span></div></div>`;
    }

    // Verification probes (conditional)
    const _v = _trafficData.verification;
    if (_v) {
      let _vRows = '';
      if (_v.waf_detected) {
        _vRows += `<tr><td>WAF Detected</td><td><span class="mobile-traffic-waf">${escHtml(_v.waf_detected)}</span></td></tr>`;
      }
      if (_v.options_allowed) {
        _vRows += `<tr><td>OPTIONS Allowed</td><td style="font-family:monospace;font-size:0.85rem">${escHtml(_v.options_allowed)}</td></tr>`;
      }
      if (_v.options_cors) {
        _vRows += `<tr><td>CORS Enabled</td><td><span style="color:var(--green)">Yes</span></td></tr>`;
      }
      if (_v.malformed_status) {
        _vRows += `<tr><td>Malformed Path Status</td><td>${_v.malformed_status}${_v.malformed_differs ? ' <span style="color:var(--green)">(differs)</span>' : ' <span style="color:var(--text-muted)">(same)</span>'}</td></tr>`;
      }
      if (_v.parent_status) {
        _vRows += `<tr><td>Parent Path Status</td><td>${_v.parent_status}${_v.parent_differs ? ' <span style="color:var(--green)">(differs)</span>' : ' <span style="color:var(--text-muted)">(same)</span>'}</td></tr>`;
      }
      if (_vRows) {
        html += `<div class="detail-section"><div class="detail-label" style="cursor:pointer" onclick="this.nextElementSibling.classList.toggle('collapsed')">Verification Probes ▾</div><table class="verification-table">${_vRows}</table></div>`;
      }
    }

    if (_trafficData.full_url) {
      html += `<div class="detail-section"><div class="detail-label">Full URL Tested</div><div class="detail-value" style="word-break:break-all;font-family:monospace;font-size:0.85rem">${escHtml(_trafficData.full_url)}</div></div>`;
    }
    if (_trafficData.base_url_used) {
      html += `<div class="detail-section"><div class="detail-label">Base URL Used</div><div class="detail-value" style="word-break:break-all;font-family:monospace;font-size:0.85rem">${escHtml(_trafficData.base_url_used)}</div></div>`;
    }
    if (_trafficData.latency_ms) {
      html += `<div class="detail-section"><div class="detail-label">Latency</div><div class="detail-value">${_trafficData.latency_ms.toLocaleString()} ms</div></div>`;
    }
    if (_trafficData.response_size) {
      const _sz = _trafficData.response_size;
      const _szFmt = _sz >= 1024 ? `${(_sz / 1024).toFixed(1)} KB` : `${_sz} bytes`;
      html += `<div class="detail-section"><div class="detail-label">Response Size</div><div class="detail-value">${_szFmt}</div></div>`;
    }
    if (_trafficData.content_type) {
      html += `<div class="detail-section"><div class="detail-label">Content-Type</div><div class="detail-value" style="font-family:monospace;font-size:0.85rem">${escHtml(_trafficData.content_type)}</div></div>`;
    }
    html += `<div class="detail-section"><div class="detail-label">TLS</div><div class="detail-value">${_trafficData.tls ? '<span style="color:var(--green)">Yes</span>' : '<span style="color:var(--text-muted)">No</span>'}</div></div>`;
    if (_trafficData.redirect_url) {
      html += `<div class="detail-section"><div class="detail-label">Redirect URL</div><div class="detail-value" style="word-break:break-all;font-family:monospace;font-size:0.85rem">${escHtml(_trafficData.redirect_url)}</div></div>`;
    }
    if (_trafficData.error) {
      html += `<div class="detail-section"><div class="detail-label">Error</div><div class="detail-value" style="color:var(--red)">${escHtml(_trafficData.error)}</div></div>`;
    }
    if (_trafficData.response_headers && typeof _trafficData.response_headers === 'object' && Object.keys(_trafficData.response_headers).length > 0) {
      let _rhRows = '';
      for (const [_hk, _hv] of Object.entries(_trafficData.response_headers)) {
        _rhRows += `<tr><td style="font-weight:500;white-space:nowrap">${escHtml(_hk)}</td><td style="word-break:break-all">${escHtml(String(_hv))}</td></tr>`;
      }
      html += `<div class="detail-section"><div class="detail-label" style="cursor:pointer" onclick="this.nextElementSibling.classList.toggle('collapsed')">Response Headers ▾</div><table class="verification-table collapsed">${_rhRows}</table></div>`;
    }
    if (_trafficData.response_body) {
      const _bodyPreview = _trafficData.response_body.length > 2000 ? _trafficData.response_body.slice(0, 2000) + '\n… (truncated)' : _trafficData.response_body;
      html += `<div class="detail-section"><div class="detail-label" style="cursor:pointer" onclick="this.nextElementSibling.classList.toggle('collapsed')">Response Body ▾</div><pre class="drawer-body-pre collapsed">${escHtml(_bodyPreview)}</pre></div>`;
    }
  }

  // — App Information separator
  html += `<div class="detail-section" style="border-top:1px solid var(--border);margin-top:0.75rem;padding-top:0.75rem"><div class="detail-label" style="font-weight:700;font-size:0.9rem">App Information</div></div>`;

  // 9 — App Name
  const cleanAppName = (() => { const t = document.createElement('textarea'); t.innerHTML = appData.app_name || pkg; return t.value; })();
  html += `<div class="detail-section"><div class="detail-label">App Name</div><div class="detail-value">${escHtml(cleanAppName)}</div></div>`;

  // 10 — Package Name
  html += `<div class="detail-section"><div class="detail-label">Package Name</div><div class="detail-value" style="font-family:monospace;font-size:0.85rem">${escHtml(pkg)}</div></div>`;

  // 11 — Target Domain
  const domain = appData.domain || appState.targetDomain || '';
  html += `<div class="detail-section"><div class="detail-label">Target Domain</div><div class="detail-value">${escHtml(domain)}</div></div>`;

  // 12 — App Version (conditional, skip if 'unknown')
  if (appData.app_version && appData.app_version !== 'unknown') {
    html += `<div class="detail-section"><div class="detail-label">App Version</div><div class="detail-value">${escHtml(appData.app_version)}</div></div>`;
  }

  // 13 — Google Play (conditional)
  if (appData.play_url) {
    html += `<div class="detail-section"><div class="detail-label">Google Play</div><div class="detail-value"><a href="${escHtml(appData.play_url)}" target="_blank" rel="noopener" style="color:var(--link)">${escHtml(appData.play_url)} ↗</a></div></div>`;
  }

  // 14 — Decompiled Classes (conditional)
  if (appData.decompiled_classes) {
    html += `<div class="detail-section"><div class="detail-label">Decompiled Classes</div><div class="detail-value">${appData.decompiled_classes.toLocaleString()}</div></div>`;
  }

  // 15 — Analyzed Classes (conditional)
  if (appData.analyzed_classes) {
    html += `<div class="detail-section"><div class="detail-label">Analyzed Classes</div><div class="detail-value">${appData.analyzed_classes.toLocaleString()}</div></div>`;
  }

  // 16 — Scan Duration (conditional)
  if (appData.scan_duration_secs) {
    html += `<div class="detail-section"><div class="detail-label">Scan Duration</div><div class="detail-value">${appData.scan_duration_secs.toFixed(1)}s</div></div>`;
  }

  content.innerHTML = html;
  document.querySelector('#detailDrawer .drawer-header h3').textContent = 'Mobile Endpoint Details';
  drawer.classList.add('open');
}

// Mobile Traffic test result handler
function handleMobileTraffic(msg) {
  _resetInactivityTimer();
  const pkg = msg.package_name || 'unknown';
  const method = (msg.method || 'GET').toUpperCase();
  const rawUrl = msg.url || '';
  const normUrl = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
  const key = `${pkg}|${method}|${normUrl}`;

  _mobileTrafficResults[key] = msg;

  // Find matching row and inject status badge
  const row = document.querySelector(`[data-mobile-key="${CSS.escape(key)}"]`);
  if (row) {
    const methodCell = row.cells[1];
    // Remove any existing traffic badge
    const old = methodCell.querySelector('.mobile-traffic-badge');
    if (old) old.remove();

    const sc = msg.status_code || 0;
    let badgeClass, badgeText;
    if (sc === 0) {
      badgeClass = 'mobile-traffic-err';
      badgeText = 'ERR';
    } else if (sc >= 200 && sc < 300) {
      badgeClass = 'mobile-traffic-2xx';
      badgeText = String(sc);
    } else if (sc >= 300 && sc < 400) {
      badgeClass = 'mobile-traffic-3xx';
      badgeText = String(sc);
    } else if (sc >= 400 && sc < 500) {
      badgeClass = 'mobile-traffic-4xx';
      badgeText = String(sc);
    } else {
      badgeClass = 'mobile-traffic-5xx';
      badgeText = String(sc);
    }

    const badge = document.createElement('span');
    badge.className = `mobile-traffic-badge ${badgeClass}`;
    badge.textContent = badgeText;
    methodCell.appendChild(badge);

    // Flash the row
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  }

  addLog('', `Traffic: ${method} ${normUrl} → ${msg.status_code || 'ERR'} (${msg.confidence}%)`, '');
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
    addLog('', `Mobile: 0 endpoints from ${pkg} (${cleanAppName})`, '');
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
        <input class="search-input" id="mobileSearchInput" placeholder="Filter mobile APIs..." oninput="applyMobileDomainFilter()">
        <div class="filter-section">
          <span class="filter-label">Domain:</span>
          <span class="filter-btn active" id="mobileFilterAll" onclick="setMobileDomainFilter('all')">All</span>
          <span class="filter-btn" id="mobileFilterDomain" onclick="setMobileDomainFilter('domain')">Domain</span>
          <span class="filter-btn" id="mobileFilterExternal" onclick="setMobileDomainFilter('external')">External</span>
        </div>
        <div class="filter-section">
          <span class="filter-label">App:</span>
          <div class="salt-dropdown" id="mobileAppDropdown">
            <div class="salt-dropdown-trigger" onclick="toggleSaltDropdown('mobileAppDropdown')">All</div>
            <div class="salt-dropdown-menu">
              <div class="salt-dropdown-item active" data-value="all" onclick="selectSaltDropdown('mobileAppDropdown','all','All',setMobileAppFilter)">All</div>
            </div>
          </div>
        </div>
        <div class="filter-section">
          <span class="filter-label">Category:</span>
          <div class="salt-dropdown" id="mobileCategoryDropdown">
            <div class="salt-dropdown-trigger" onclick="toggleSaltDropdown('mobileCategoryDropdown')">All</div>
            <div class="salt-dropdown-menu">
              <div class="salt-dropdown-item active" data-value="all" onclick="selectSaltDropdown('mobileCategoryDropdown','all','All',setMobileCategoryFilter)">All</div>
            </div>
          </div>
        </div>
        <div class="filter-section">
          <span class="filter-label">Status:</span>
          <div class="salt-dropdown" id="mobileStatusDropdown">
            <div class="salt-dropdown-trigger" onclick="toggleSaltDropdown('mobileStatusDropdown')">All</div>
            <div class="salt-dropdown-menu">
              <div class="salt-dropdown-item active" data-value="all" onclick="selectSaltDropdown('mobileStatusDropdown','all','All',setMobileStatusFilter)">All</div>
              <div class="salt-dropdown-item" data-value="tested" onclick="selectSaltDropdown('mobileStatusDropdown','tested','Tested',setMobileStatusFilter)">Tested</div>
              <div class="salt-dropdown-item" data-value="untested" onclick="selectSaltDropdown('mobileStatusDropdown','untested','Not tested',setMobileStatusFilter)">Not tested</div>
              <div class="salt-dropdown-item" data-value="2xx" onclick="selectSaltDropdown('mobileStatusDropdown','2xx','2xx OK',setMobileStatusFilter)">2xx OK</div>
              <div class="salt-dropdown-item" data-value="3xx" onclick="selectSaltDropdown('mobileStatusDropdown','3xx','3xx Redirect',setMobileStatusFilter)">3xx Redirect</div>
              <div class="salt-dropdown-item" data-value="4xx" onclick="selectSaltDropdown('mobileStatusDropdown','4xx','4xx Client Err',setMobileStatusFilter)">4xx Client Err</div>
              <div class="salt-dropdown-item" data-value="5xx" onclick="selectSaltDropdown('mobileStatusDropdown','5xx','5xx Server Err',setMobileStatusFilter)">5xx Server Err</div>
              <div class="salt-dropdown-item" data-value="err" onclick="selectSaltDropdown('mobileStatusDropdown','err','Connection Err',setMobileStatusFilter)">Connection Err</div>
            </div>
          </div>
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

  // Populate App filter dropdown on first encounter of this package
  if (!_mobileKnownApps.has(pkg)) {
    _mobileKnownApps.set(pkg, cleanAppName);
    addSaltDropdownOption('mobileAppDropdown', pkg, cleanAppName, setMobileAppFilter);
  }

  // Card content is updated after dedup loop below
  const _cardMeta = { playUrl: msg.play_url || `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`, cleanAppName, msg };

  // Append rows
  const tbody = document.getElementById('mobileEndpointsTbody');
  const startIdx = tbody.rows.length;

  const targetDomain = appState.targetDomain;

  // Sort by confidence descending (highest first), nulls last
  const sortedFindings = [...findings].sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));

  sortedFindings.forEach((f, i) => {
    const method = f.method || 'GET';
    const url = f.url || '';
    const normUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    const dedupKey = `${pkg}|${method}|${normUrl}`;
    if (_mobileSeenEndpoints.has(dedupKey)) return;
    _mobileSeenEndpoints.add(dedupKey);

    // Insert at correct position to maintain global confidence sort (descending)
    const conf = f.confidence ?? -1;
    let insertIdx = tbody.rows.length; // default: append
    for (let r = 0; r < tbody.rows.length; r++) {
      if ((parseFloat(tbody.rows[r].dataset.confidence) || -1) < conf) {
        insertIdx = r;
        break;
      }
    }
    const row = tbody.insertRow(insertIdx);
    row.classList.add('flash');
    row.dataset.confidence = String(conf);
    row.dataset.mobileKey = dedupKey;

    const badgeClass = `badge-${method}`;

    // Domain relevance: relative paths or URLs containing the target domain = "domain", else "external"
    const isDomain = classifyMobileUrl(url, f.base_url || '', targetDomain);
    row.dataset.mobileDomain = isDomain ? 'domain' : 'external';
    row.dataset.mobilePkg = pkg;

    const domainBadge = isDomain
      ? '<span class="mobile-domain-badge mobile-domain-yes">Domain</span>'
      : '<span class="mobile-domain-badge mobile-domain-no">External</span>';

    row.innerHTML =
      `<td class="row-number" style="text-align:center;color:var(--text-muted);font-size:0.85rem;">${tbody.rows.length}</td>` +
      `<td><span class="badge ${badgeClass}" title="${escHtml((f.source_class ? f.source_class + '\n' : '') + (f.evidence || ''))}">${escHtml(method)}</span></td>` +
      `<td class="path-cell" title="${escHtml(url)}">${escHtml(trimPath(url))}</td>` +
      `<td class="reason-cell" title="${escHtml(f.context || '')}">${escHtml(f.context ? f.context.charAt(0).toUpperCase() + f.context.slice(1) : '')}</td>` +
      `<td>${f.category ? `<span class="mobile-category">${escHtml(f.category)}</span>` : ''}</td>` +
      `<td>${domainBadge}</td>`;

    row.style.cursor = 'pointer';
    row.onclick = () => openMobileDrawer(f, pkg);

    if (f.category && !_mobileKnownCategories.has(f.category)) {
      _mobileKnownCategories.add(f.category);
      addSaltDropdownOption('mobileCategoryDropdown', f.category, f.category, setMobileCategoryFilter);
    }
  });

  // Update card with deduplicated count
  const dedupCount = [...document.getElementById('mobileEndpointsTbody').rows].filter(r => r.dataset.mobilePkg === pkg).length;
  card.dataset.endpointCount = String(dedupCount);
  const playLink = `<a href="${escHtml(_cardMeta.playUrl)}" target="_blank" rel="noopener" class="mobile-play-link">Google Play ↗</a>`;
  card.innerHTML =
    `<div class="mobile-app-info">` +
      `<strong>${escHtml(_cardMeta.cleanAppName)}</strong>` +
      `<span class="mobile-app-pkg">${escHtml(pkg)}</span>` +
      (_cardMeta.msg.app_version && _cardMeta.msg.app_version !== 'unknown' ? `<span class="mobile-app-version">v${escHtml(_cardMeta.msg.app_version)}</span>` : '') +
      playLink +
    `</div>` +
    `<div class="mobile-app-stats">` +
      `<span>${dedupCount} endpoint${dedupCount !== 1 ? 's' : ''}</span>` +
      (_cardMeta.msg.analyzed_classes ? `<span>${_cardMeta.msg.analyzed_classes} classes analyzed</span>` : '') +
      (_cardMeta.msg.scan_duration_secs ? `<span>${_cardMeta.msg.scan_duration_secs.toFixed(1)}s</span>` : '') +
    `</div>`;

  applyMobileDomainFilter();
  document.getElementById('mobileEmptyState').style.display = findings.length === 0 ? 'block' : 'none';

  // Log
  addLog('', `Mobile: ${dedupCount} endpoints from ${pkg} (${_cardMeta.cleanAppName})`, '');
}

// ─── Git Findings / OpenAPI Specs Tab ───

function _updateGitSpecsCount() {
  const tbody = document.getElementById('gitSpecsTbody');
  if (!tbody) return;
  const visibleRows = Array.from(tbody.rows).filter(r => r.style.display !== 'none');
  // Re-number visible rows
  visibleRows.forEach((r, idx) => {
    const numCell = r.querySelector('.row-number');
    if (numCell) numCell.textContent = idx + 1;
  });
  // Update header count
  const headerDiv = document.getElementById('gitSpecsHeader');
  if (headerDiv) {
    const countEls = headerDiv.querySelectorAll('.mobile-app-pkg, .mobile-app-stats span:first-child');
    countEls.forEach(el => {
      el.textContent = el.textContent.replace(/\d+ spec/, `${visibleRows.length} spec`);
    });
  }
  // Hide the tab entirely if nothing left
  if (visibleRows.length === 0) {
    const tab = document.getElementById('tabGitSpecs');
    if (tab) tab.style.display = 'none';
  }
}

function handleWsMessage(msg) {
  // msg = { host, path, message: { direction, payload, truncated, size, timestamp } }
  const host = msg.host;
  const path = msg.path;
  const message = msg.message;

  // Find matching endpoint in appState
  const endpoint = appState.endpoints.find(ep =>
    ep.method === 'WEBSOCKET' && ep.host === host && ep.path === path
  );

  if (!endpoint) return;

  // Add message to endpoint
  if (!endpoint.websocket_messages) endpoint.websocket_messages = [];
  endpoint.websocket_messages.push(message);

  // Update WebSocket tab count
  const wsTab = document.getElementById('evtWebSocket');
  if (wsTab) {
    const wsCount = appState.endpoints.filter(ep => ep.method === 'WEBSOCKET').length;
    wsTab.textContent = `WebSocket (${wsCount})`;
  }

  // If accordion is open for this endpoint, append new message
  const tbody = document.getElementById('webSocketTbody');
  if (!tbody) return;

  // Find row for this endpoint
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const matchingRow = rows.find(tr => {
    const nextRow = tr.nextElementSibling;
    return tr.dataset.wsExpanded === 'true' &&
           nextRow && nextRow.classList.contains('ws-chat-row');
  });

  if (!matchingRow) return;

  // Check if this row matches endpoint
  const rowCells = matchingRow.querySelectorAll('td');
  const rowHost = rowCells[3]?.textContent.trim();
  const rowPath = rowCells[2]?.textContent.trim();

  if (rowHost !== host || rowPath !== path) return;

  // Append message to accordion
  const chatRow = matchingRow.nextElementSibling;
  const chatContainer = chatRow.querySelector('div[style*="max-height"]');
  if (!chatContainer) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `ws-message ws-message-${message.direction}`;

  const time = new Date(message.timestamp).toLocaleTimeString();
  const sizeStr = message.size >= 1024 ? `${(message.size/1024).toFixed(1)}KB` : `${message.size}B`;

  msgDiv.innerHTML = `
    <div class="ws-message-meta">
      <span class="ws-message-direction">${message.direction === 'sent' ? '→ Sent' : '← Received'}</span>
      <span>${time}</span>
      <span>${sizeStr}</span>
      <button class="ws-explain-btn" onclick="explainWsPayload(event)" style="margin-left:auto;padding:0.2rem 0.5rem;font-size:0.7rem;background:rgba(0,0,0,0.6);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:3px;cursor:pointer;font-weight:500">Explain</button>
    </div>
    <div class="ws-message-body">${escHtml(message.payload)}</div>
    ${message.truncated ? '<div class="ws-message-truncated">⚠️ Truncated to 1KB</div>' : ''}
    <div class="ws-explanation" style="display:none;margin-top:0.5rem;padding:0.75rem;background:var(--bg);border-radius:4px;border-left:3px solid var(--primary)"></div>
  `;

  // Store raw payload data on button (not in HTML attribute to avoid escaping issues)
  const btn = msgDiv.querySelector('.ws-explain-btn');
  btn._payload = message.payload;
  btn._host = host;
  btn._path = path;

  chatContainer.appendChild(msgDiv);

  // Auto-scroll only if user was already at bottom (not reading old messages)
  const isAtBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 100;
  if (isAtBottom) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

function handleGitFindings(msg) {
  const findings = msg.findings || [];
  if (findings.length === 0) return;

  // Derive primary source for header card
  const sourceCounts = {};
  findings.forEach(f => {
    const s = f.source || 'Unknown';
    sourceCounts[s] = (sourceCounts[s] || 0) + 1;
  });
  const primarySource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0][0];

  // Create tab + view (idempotent)
  if (!document.getElementById('tabGitSpecs')) {
    const tabContainer = document.querySelector('.view-tabs');
    const tabBtn = document.createElement('button');
    tabBtn.className = 'view-tab';
    tabBtn.id = 'tabGitSpecs';
    tabBtn.onclick = () => switchView('gitspecs');
    tabBtn.textContent = 'OpenAPI Specs';
    tabContainer.appendChild(tabBtn);

    const rightPanel = document.querySelector('.right-panel');
    const viewDiv = document.createElement('div');
    viewDiv.id = 'gitSpecsView';
    viewDiv.style.display = 'none';
    viewDiv.innerHTML = `
      <div id="gitSpecsList">
        <div id="gitSpecsHeader" class="mobile-apps-header"></div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th style="width:35px">#</th>
                <th style="width:80px">Source</th>
                <th style="width:25%">Repository</th>
                <th style="width:30%">File</th>
                <th style="width:100px">Spec Type</th>
                <th style="width:25%">Description</th>
              </tr>
            </thead>
            <tbody id="gitSpecsTbody"></tbody>
          </table>
        </div>
      </div>
      <div id="gitSpecsDetail" style="display:none">
        <div class="git-specs-detail-header" id="gitSpecsDetailHeader"></div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th style="width:35px">#</th>
                <th style="width:70px">Method</th>
                <th style="width:40%">Path</th>
                <th style="width:35%">Description</th>
              </tr>
            </thead>
            <tbody id="gitSpecsEndpointsTbody"></tbody>
          </table>
        </div>
      </div>`;
    rightPanel.appendChild(viewDiv);
  }

  // Header card
  const headerDiv = document.getElementById('gitSpecsHeader');
  const dur = msg.scan_duration_secs ? `${msg.scan_duration_secs.toFixed(1)}s` : '';
  headerDiv.innerHTML = `
    <div class="mobile-app-card">
      <div class="mobile-app-info">
        <strong>${escHtml(primarySource)} API Specs</strong>
        <span class="mobile-app-pkg">${findings.length} spec${findings.length !== 1 ? 's' : ''} discovered</span>
      </div>
      <div class="mobile-app-stats">
        <span>${findings.length} spec${findings.length !== 1 ? 's' : ''}</span>
        ${dur ? `<span>${dur}</span>` : ''}
      </div>
    </div>`;

  // Populate specs table (Level 1)
  const tbody = document.getElementById('gitSpecsTbody');
  tbody.innerHTML = '';
  findings.forEach((f, i) => {
    const row = tbody.insertRow();
    row.classList.add('flash');
    row.style.cursor = 'pointer';

    const fileName = (f.file_path || '').split('/').pop() || f.file_path || '';
    const specBadge = f.spec_type || 'Unknown';

    const repoUrl = f.repo ? (f.source === 'GitHub' ? `https://github.com/${f.repo}` : f.file_url || '') : '';
    row.innerHTML =
      `<td class="row-number" style="text-align:center;color:var(--text-muted);font-size:0.85rem">${i + 1}</td>` +
      `<td>${escHtml(f.source || '')}</td>` +
      `<td class="path-cell" title="${escHtml(f.repo || '')}">${repoUrl ? `<a href="${escHtml(repoUrl)}" target="_blank" rel="noopener" style="color:var(--link)" onclick="event.stopPropagation()">${escHtml(f.repo)}</a>` : escHtml(f.repo || '')}</td>` +
      `<td class="path-cell">${f.file_url ? `<a href="${escHtml(f.file_url)}" target="_blank" rel="noopener" style="color:var(--link)" onclick="event.stopPropagation()">${escHtml(fileName)} &#8599;</a>` : escHtml(fileName)}<span class="git-spec-badge-count" id="gitSpecBadge${i}" style="display:none;margin-left:6px;font-size:0.75rem;background:var(--accent);color:#fff;padding:1px 6px;border-radius:8px"></span></td>` +
      `<td><span class="mobile-category">${escHtml(specBadge)}</span></td>` +
      `<td class="reason-cell" title="${escHtml(f.description || '')}">${escHtml(f.description || '')}</td>`;

    row.dataset.findingIdx = String(i);
    row.onclick = () => showGitSpecEndpoints(f);

    // Auto-fetch spec in background
    if (f.raw_url) {
      fetch(`/api/fetch-spec?url=${encodeURIComponent(f.raw_url)}`)
        .then(r => r.json())
        .then(data => {
          f._parsedSpec = data;
          const badge = document.getElementById(`gitSpecBadge${i}`);
          if (data.endpoints && data.endpoints.length > 0) {
            if (badge) {
              badge.textContent = `${data.endpoints.length} endpoints`;
              badge.style.display = 'inline';
            }
          } else {
            row.style.display = 'none';
            _updateGitSpecsCount();
          }
        })
        .catch(() => {});
    }
  });
}

// Strip HTML tags from a string (for spec descriptions that contain markup)
function stripHtml(str) {
  if (!str) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = str;
  return tmp.textContent || tmp.innerText || '';
}

// Level 2: show endpoints for a single spec
function showGitSpecEndpoints(finding) {
  const listEl = document.getElementById('gitSpecsList');
  const detailEl = document.getElementById('gitSpecsDetail');
  const headerEl = document.getElementById('gitSpecsDetailHeader');
  const tbody = document.getElementById('gitSpecsEndpointsTbody');

  const parsed = finding._parsedSpec;
  const specTitle = (parsed && parsed.title) || finding.file_path || 'Spec';
  const specVersion = (parsed && parsed.spec_version) || '';
  const endpoints = (parsed && parsed.endpoints) || [];

  // Render header bar with back button + title + source link
  const sourceLink = finding.file_url
    ? `<a href="${escHtml(finding.file_url)}" target="_blank" rel="noopener" style="margin-left:10px;font-size:0.8rem;color:var(--link);text-decoration:none;border:1px solid var(--link);padding:2px 8px;border-radius:4px">View Source &#8599;</a>`
    : '';
  headerEl.innerHTML =
    `<button class="git-specs-back-btn" onclick="showGitSpecsList()">&#8592; Back</button>` +
    `<span class="git-specs-detail-title">${escHtml(specTitle)}</span>` +
    (specVersion ? `<span class="mobile-category" style="margin-left:8px">${escHtml(specVersion)}</span>` : '') +
    `<span style="color:var(--text-muted);font-size:0.85rem;margin-left:8px">${endpoints.length} endpoint${endpoints.length !== 1 ? 's' : ''}</span>` +
    sourceLink;

  // Populate endpoints table
  tbody.innerHTML = '';

  if (!parsed) {
    // Spec not fetched yet — show spinner and retry
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-muted)"><div class="spinner" style="margin:0 auto 8px"></div>Loading spec endpoints...</td></tr>`;
    listEl.style.display = 'none';
    detailEl.style.display = '';
    // Poll until parsed
    const pollId = setInterval(() => {
      if (finding._parsedSpec) {
        clearInterval(pollId);
        showGitSpecEndpoints(finding);
      }
    }, 500);
    return;
  }

  if (endpoints.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-muted)">No endpoints found in this spec</td></tr>`;
  } else {
    endpoints.forEach((ep, i) => {
      const row = tbody.insertRow();
      const badgeClass = `badge-${ep.method}`;
      const hasDetails = (ep.parameters && ep.parameters.length > 0) || ep.request_body || (ep.responses && Object.keys(ep.responses).length > 0);

      const cleanDesc = stripHtml(ep.description || '');

      row.innerHTML =
        `<td class="row-number" style="text-align:center;color:var(--text-muted);font-size:0.85rem">${i + 1}</td>` +
        `<td><span class="badge ${badgeClass}" style="min-width:55px;text-align:center">${escHtml(ep.method)}</span></td>` +
        `<td class="path-cell" style="font-family:monospace;font-size:0.85rem" title="${escHtml(ep.path)}">${escHtml(ep.path)}</td>` +
        `<td class="reason-cell" title="${escHtml(cleanDesc)}">${escHtml(cleanDesc)}</td>`;

      if (hasDetails) {
        row.style.cursor = 'pointer';
        row.onclick = () => openGitEndpointDrawer(finding, ep);
      }
    });
  }

  listEl.style.display = 'none';
  detailEl.style.display = '';
}

// Navigate back to specs list (Level 1)
function showGitSpecsList() {
  document.getElementById('gitSpecsList').style.display = '';
  document.getElementById('gitSpecsDetail').style.display = 'none';
}

// Level 3: endpoint detail drawer
function openGitEndpointDrawer(finding, endpoint) {
  const drawer = document.getElementById('detailDrawer');
  const content = document.getElementById('drawerContent');
  document.querySelector('#detailDrawer .drawer-header h3').textContent = 'Endpoint Details';

  const badgeClass = `badge-${endpoint.method}`;
  let html = '';

  // Method
  html += `<div class="detail-section"><div class="detail-label">Method</div><div class="detail-value"><span class="badge ${badgeClass}">${escHtml(endpoint.method)}</span></div></div>`;

  // Path
  html += `<div class="detail-section"><div class="detail-label">Path</div><div class="detail-value" style="font-family:monospace;font-size:0.9rem;word-break:break-all">${escHtml(endpoint.path)}</div></div>`;

  // Description
  if (endpoint.description) {
    html += `<div class="detail-section"><div class="detail-label">Description</div><div class="detail-value">${escHtml(stripHtml(endpoint.description))}</div></div>`;
  }

  // ── Spec Info separator
  html += `<div class="detail-section" style="border-top:1px solid var(--border);margin-top:0.75rem;padding-top:0.75rem"><div class="detail-label" style="font-weight:700;font-size:0.9rem">Spec Info</div></div>`;

  html += `<div class="detail-section"><div class="detail-label">Source</div><div class="detail-value">${escHtml(finding.source || '')}${finding.discovery_method ? ` <span style="color:var(--text-muted);font-size:0.85rem">(${escHtml(finding.discovery_method)})</span>` : ''}</div></div>`;

  if (finding.repo) {
    const repoUrl = finding.repo_url || (finding.source === 'GitHub' ? `https://github.com/${finding.repo}` : '');
    html += `<div class="detail-section"><div class="detail-label">Repository</div><div class="detail-value">${repoUrl ? `<a href="${escHtml(repoUrl)}" target="_blank" rel="noopener" style="color:var(--link)">${escHtml(finding.repo)} ↗</a>` : escHtml(finding.repo)}</div></div>`;
  }

  if (finding.file_path) {
    html += `<div class="detail-section"><div class="detail-label">File Path</div><div class="detail-value" style="font-family:monospace;font-size:0.85rem">${finding.file_url ? `<a href="${escHtml(finding.file_url)}" target="_blank" rel="noopener" style="color:var(--link)">${escHtml(finding.file_path)} ↗</a>` : escHtml(finding.file_path)}</div></div>`;
  }

  if (finding.spec_type) {
    const parsed = finding._parsedSpec;
    const versionStr = parsed && parsed.spec_version ? ` ${parsed.spec_version}` : '';
    html += `<div class="detail-section"><div class="detail-label">Spec Type</div><div class="detail-value"><span class="mobile-category">${escHtml(finding.spec_type)}${escHtml(versionStr)}</span></div></div>`;
  }

  // ── Parameters
  if (endpoint.parameters && endpoint.parameters.length > 0) {
    html += `<div class="detail-section" style="border-top:1px solid var(--border);margin-top:0.75rem;padding-top:0.75rem"><div class="detail-label" style="font-weight:700;font-size:0.9rem">Parameters (${endpoint.parameters.length})</div></div>`;
    html += `<table style="width:100%;font-size:0.8rem"><thead><tr><th style="text-align:left;padding:2px 6px">Name</th><th style="text-align:left;padding:2px 6px">In</th><th style="text-align:left;padding:2px 6px">Type</th><th style="text-align:left;padding:2px 6px">Required</th><th style="text-align:left;padding:2px 6px">Description</th></tr></thead><tbody>`;
    endpoint.parameters.forEach(p => {
      html += `<tr><td style="padding:2px 6px;font-family:monospace">${escHtml(p.name)}</td><td style="padding:2px 6px">${escHtml(p.in)}</td><td style="padding:2px 6px">${escHtml(p.type || '')}</td><td style="padding:2px 6px">${p.required ? '✓' : ''}</td><td style="padding:2px 6px;color:var(--text-muted)">${escHtml(p.description || '')}</td></tr>`;
    });
    html += `</tbody></table>`;
  }

  // ── Request Body (collapsible)
  if (endpoint.request_body) {
    html += `<div class="detail-section" style="border-top:1px solid var(--border);margin-top:0.75rem;padding-top:0.75rem"><div class="detail-label" style="font-weight:700;font-size:0.9rem;cursor:pointer" onclick="this.parentElement.nextElementSibling.classList.toggle('collapsed')">Request Body ▾</div></div>`;
    html += `<pre class="drawer-body-pre" style="max-height:300px;overflow:auto">${escHtml(JSON.stringify(endpoint.request_body, null, 2))}</pre>`;
  }

  // ── Responses (collapsible per status code)
  if (endpoint.responses && Object.keys(endpoint.responses).length > 0) {
    html += `<div class="detail-section" style="border-top:1px solid var(--border);margin-top:0.75rem;padding-top:0.75rem"><div class="detail-label" style="font-weight:700;font-size:0.9rem">Responses</div></div>`;
    Object.entries(endpoint.responses).forEach(([status, resp]) => {
      html += `<div class="detail-section"><div class="detail-label" style="cursor:pointer" onclick="this.nextElementSibling.classList.toggle('collapsed')"><span style="font-weight:600">${escHtml(status)}</span>${resp.description ? ` — <span style="color:var(--text-muted)">${escHtml(resp.description)}</span>` : ''} ▾</div>`;
      if (resp.schema) {
        html += `<pre class="drawer-body-pre" style="max-height:200px;overflow:auto">${escHtml(JSON.stringify(resp.schema, null, 2))}</pre>`;
      }
      html += `</div>`;
    });
  }

  content.innerHTML = html;
  drawer.classList.add('open');
}

// Android App Toast
let _androidToastApps = [];

function _updateAndroidToastTitle() {
  const total = _androidToastApps.length;
  const checked = document.querySelectorAll('#androidToastBody input[type="checkbox"]:checked').length;
  document.getElementById('androidToastTitle').textContent = total > 0
    ? `\u{1F4F1} Android Apps (${checked}/${total})`
    : '\u{1F4F1} Add Android App';
}

function showAndroidToast(apps) {
  _androidToastApps = apps;
  const toast = document.getElementById('androidToast');
  const body = document.getElementById('androidToastBody');
  // Clear manual input and error
  document.getElementById('manualPlayUrl').value = '';
  document.getElementById('manualPlayError').textContent = '';

  if (apps.length === 0) {
    body.innerHTML = '<div class="android-toast-empty">No apps auto-detected. Add one below.</div>';
  } else {
    // Reverse domain parts: example.com → com.example
    const domainPrefix = (appState.targetDomain || '').split('.').reverse().join('.').toLowerCase();
    // Sort: checked (relevant) entries first
    const sorted = apps.map((a, i) => ({ app: a, idx: i, relevant: domainPrefix && (a.package_name || '').toLowerCase().includes(domainPrefix) }));
    sorted.sort((a, b) => (b.relevant ? 1 : 0) - (a.relevant ? 1 : 0));
    body.innerHTML = sorted.map(({ app: a, idx, relevant }) => {
      return `<label class="android-toast-app">` +
        `<input type="checkbox" ${relevant ? 'checked' : ''} data-idx="${idx}" onchange="_updateAndroidToastTitle()">` +
        `<div class="app-info"><span class="app-name">${escHtml(a.app_name)}</span>` +
        `<span class="app-pkg">${escHtml(a.package_name)}</span></div>` +
        `<a class="app-play-link" href="${escHtml(a.play_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Google Play ↗</a>` +
      `</label>`;
    }).join('');
  }
  _updateAndroidToastTitle();
  toast.classList.add('show');
}

function openManualAppDialog() {
  showAndroidToast(_androidToastApps);
}

function addManualApp() {
  const input = document.getElementById('manualPlayUrl');
  const errorEl = document.getElementById('manualPlayError');
  const url = input.value.trim();
  errorEl.textContent = '';

  const match = url.match(/[?&]id=([a-zA-Z0-9_.]+)/);
  if (!match) {
    errorEl.textContent = 'Invalid Google Play URL — must contain ?id=package.name';
    return;
  }
  const packageName = match[1];

  // Check for duplicates
  if (_androidToastApps.some(a => a.package_name === packageName)) {
    errorEl.textContent = `Package "${packageName}" is already in the list`;
    return;
  }

  const playUrl = `https://play.google.com/store/apps/details?id=${packageName}`;
  const app = { package_name: packageName, app_name: packageName, play_url: playUrl };
  const idx = _androidToastApps.length;
  _androidToastApps.push(app);

  // Remove empty-state placeholder if present
  const body = document.getElementById('androidToastBody');
  const empty = body.querySelector('.android-toast-empty');
  if (empty) empty.remove();

  // Append new row (pre-checked)
  const row = document.createElement('label');
  row.className = 'android-toast-app';
  row.innerHTML =
    `<input type="checkbox" checked data-idx="${idx}" onchange="_updateAndroidToastTitle()">` +
    `<div class="app-info"><span class="app-name">${escHtml(app.app_name)}</span>` +
    `<span class="app-pkg">${escHtml(app.package_name)}</span></div>` +
    `<a class="app-play-link" href="${escHtml(app.play_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Google Play ↗</a>`;
  body.appendChild(row);

  _updateAndroidToastTitle();
  input.value = '';
}

function confirmAndroidApps() {
  const checkboxes = document.querySelectorAll('#androidToastBody input[type="checkbox"]');
  const selected = [];
  checkboxes.forEach(cb => {
    if (cb.checked) selected.push(_androidToastApps[parseInt(cb.dataset.idx)]);
  });
  if (selected.length > 0 && appState.ws && appState.ws.readyState === WebSocket.OPEN) {
    appState.ws.send(JSON.stringify({ action: 'publish_apk', apps: selected }));
    appState.mobileAnalysisTriggered = true;
    addLog('', `Queued ${selected.length} app(s) for APK analysis`, '');
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

// Deep-link: ?domain=X&scan=Y → open history modal with that scan
(function checkDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const domain = params.get('domain');
  const scanId = params.get('scan');
  if (!domain || !scanId) return;

  document.getElementById('startOverlay').classList.add('hidden');
  openHistoryModal();
  viewScanDetail(domain, scanId);
})();

// Detect browser LLM capability on page load
(async () => {
  try {
    const detected = await browserLLM.detect();
    if (detected) {
      console.log('✓ Browser LLM available');
    } else {
      console.log('ℹ Browser LLM not available, will use backend');
    }
  } catch (error) {
    console.warn('Browser LLM detection failed:', error);
  }
})();

// Restore web drawer header when opening a web endpoint
const _originalOpenDrawer = openDrawer;
openDrawer = function(ep) {
  _originalOpenDrawer(ep);
  document.querySelector('#detailDrawer .drawer-header h3').textContent = 'Endpoint Details';
};

// WebSocket modal functions moved to endpoints.js (loaded earlier)
