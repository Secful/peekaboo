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
      const msg = JSON.parse(e.data);
      handleEvent(msg);
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
        addLog('⚠️', `Scan incomplete - ${queueSize} URLs remaining in queue`, 'warning');
      }

      // Clear stale queue stats
      document.getElementById('statQueue').textContent = '0';

      appState.ws = null;
      appState.myScanId = null;
    };

    appState.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      addLog('⚠️', 'Connection error', 'error');
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
  domainIndicator.textContent = `🎯 ${appState.targetDomain}`;
  domainIndicator.classList.remove('hidden');

  try {
    await ensureWebSocket();
    document.getElementById('statusText').textContent = 'Starting scan...';
    addLog('🚀', `Starting scan of ${params.domain}...`, 'page');
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
    btn.innerHTML = '▶️ Resume Scan';
    btn.style.background = 'var(--green)';
    btn.style.color = 'var(--navy)';
    statusText.textContent = 'Paused (scan running in background)';
    addLog('⏸', 'UI updates paused - scan continues in background', 'info');
  } else {
    btn.innerHTML = '⏸ Pause Scan';
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

    addLog('▶️', `UI updates resumed - displaying ${appState.endpoints.length} endpoints`, 'info');
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
  addLog('⏹', 'Scan terminated by user', '');
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
  pauseBtn.innerHTML = '⏸ Pause Scan';
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
  document.getElementById('previewThumb').innerHTML = '<div class="idle-icon">👀</div>';
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
  const tabEndpoints = document.getElementById('tabEndpoints');
  const tabSubdomains = document.getElementById('tabSubdomains');

  if (view === 'subdomains') {
    endpointsView.style.display = 'none';
    subdomainsView.classList.remove('hidden');
    tabEndpoints.classList.remove('active');
    tabSubdomains.classList.add('active');
    if (appState.subdomainViewMode === 'map' && appState.subdomainMapInstance) {
      setTimeout(() => appState.subdomainMapInstance.invalidateSize(), 100);
    }
  } else {
    endpointsView.style.display = '';
    subdomainsView.classList.add('hidden');
    tabEndpoints.classList.add('active');
    tabSubdomains.classList.remove('active');
  }
}

// Event dispatcher
function handleEvent(msg) {
  switch(msg.type) {
    case 'status':
      if (!appState.uiPaused) {
        addLog('ℹ️', msg.message, '');
      }
      break;

    case 'error':
      addLog('⚠️', msg.message, 'error');
      document.getElementById('statusText').textContent = 'Error';
      break;

    case 'crawl_start':
      if (!appState.uiPaused) {
        document.getElementById('statPages').textContent = msg.pages_visited;
        document.getElementById('statQueue').textContent = msg.pages_remaining;
        updateEndpointCounter();
        document.getElementById('currentUrl').textContent = msg.url;
        addLog('📄', `Crawling: ${shortenUrl(msg.url)}`, 'page');
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
        addLog('🎯', `${msg.method} ${msg.host}${msg.path}`, 'endpoint');
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
      document.getElementById('subdomainContent').innerHTML = `
        <div class="subdomain-loading">
          <div class="spinner"></div>
          <div class="loading-text">Discovering subdomains...</div>
          <div class="loading-subtext">This may take up to 2 minutes</div>
        </div>`;
      addLog('🌐', 'Subdomain discovery started...', '');
      break;

    case 'subdomains':
      appState.subdomainResults = msg.data;
      renderSubdomainTable(msg.data);
      {
        const subs = normalizeSubdomains(msg.data);
        addLog('🌐', `Subdomain discovery complete: ${subs.length} found`, 'endpoint');
      }
      break;

    case 'subdomains_error':
      appState.subdomainResults = null;
      document.getElementById('subdomainContent').innerHTML = `
        <div class="subdomain-error">${escHtml(msg.message)}</div>`;
      addLog('⚠️', msg.message, 'error');
      break;

    case 'crawl_error':
      addLog('⚠️', `Error on ${shortenUrl(msg.url)}: ${msg.error}`, 'error');
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
      addLog('✅', `Scan complete. ${msg.total_endpoints} endpoints across ${msg.pages_visited} pages.${skippedMsg}`, '');

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

      const scanDuration = appState.scanStartTime ? (Date.now() - appState.scanStartTime) / 1000 : Infinity;
      if (scanDuration < 60) {
        switchView('subdomains');
      }
      break;
  }
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
