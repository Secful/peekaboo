const endpoints = [];
const hosts = new Set();
const activeFilters = new Set();
let sortCol = null, sortAsc = true;
let ws = null;
let targetDomain = '';
let includeSubdomains = true;
let domainFilter = 'all'; // 'all', 'subdomain', or 'external'
let currentPage = 1;
const itemsPerPage = 50;
let uiPaused = false; // Track if UI updates are paused
let scanStartTime = null; // Track scan start time for duration calculation
let timerInterval = null; // Timer interval for updating scan time display
let capturedScreenshots = []; // Store up to 5 screenshots for report carousel
let myScanId = null; // Assigned by server to identify this client's scan
let detectedTechnologies = null; // Technologies detected from endpoints (file extensions & headers)
let subdomainResults = null; // Subdomain discovery results from Lambda
let lastScreenshotBase64 = null; // Last screenshot for summary view
const subdomainApis = {}; // Per-subdomain API results from "Even Deeper" analysis

// Human-friendly HTTP status code explanations
const statusExplanations = {
  200: "Everything worked perfectly! The request was successful.",
  201: "Success! A new resource was created (like a new account or post).",
  202: "Request accepted and is being processed in the background.",
  204: "Request succeeded, but there's no content to show.",

  301: "This resource has permanently moved to a new location.",
  302: "Temporarily redirected to another location - the original will be back.",
  304: "You already have the latest version - nothing has changed.",
  307: "Temporarily redirected - try the new location for now.",
  308: "Permanently moved - update your bookmarks to the new location.",

  400: "The request was invalid or couldn't be understood by the server.",
  401: "Authentication required - you need to log in or provide credentials.",
  403: "Access denied - you don't have permission to view this resource.",
  404: "Not found - the requested resource doesn't exist at this location.",
  405: "This HTTP method (GET, POST, etc.) is not allowed for this resource.",
  406: "The server can't provide content in the format you requested.",
  408: "The request took too long and timed out.",
  409: "Conflict - the request conflicts with the current state of the resource.",
  410: "Gone - this resource used to exist but has been permanently removed.",
  429: "Too many requests - you're being rate limited for making requests too quickly.",

  500: "Internal server error - something went wrong on the server side.",
  501: "Not implemented - the server doesn't support this functionality yet.",
  502: "Bad gateway - the server received an invalid response from an upstream server.",
  503: "Service unavailable - the server is temporarily down or overloaded.",
  504: "Gateway timeout - an upstream server didn't respond in time.",
};

function getStatusExplanation(statusCode) {
  return statusExplanations[statusCode] || `HTTP status code ${statusCode}`;
}

// Human-friendly HTTP method explanations
const methodExplanations = {
  'GET': "Retrieve data - like viewing a webpage or downloading information (read-only).",
  'POST': "Send new data - like submitting a form, creating an account, or uploading a file.",
  'PUT': "Update data - replace an entire resource with new information.",
  'PATCH': "Partially update data - modify just specific parts of a resource.",
  'DELETE': "Remove data - delete a resource from the server.",
  'HEAD': "Get metadata only - like GET but returns just headers, no content (useful for checking if something exists).",
  'OPTIONS': "Ask what's allowed - find out which HTTP methods are supported for this resource.",
  'CONNECT': "Establish a tunnel - typically used for secure connections through a proxy.",
  'TRACE': "Echo the request - used for debugging to see what the server receives.",
  'GET*': "Any GET-like request - includes regular GET and similar read operations.",
};

function getMethodExplanation(method) {
  return methodExplanations[method] || `${method} - HTTP method for interacting with this resource.`;
}

// Helper function to update scan timer display
function updateTimer() {
  if (!scanStartTime) {
    document.getElementById('statTimer').textContent = '00:00';
    return;
  }

  const elapsed = Math.floor((Date.now() - scanStartTime) / 1000); // seconds
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  document.getElementById('statTimer').textContent = formattedTime;
}

// Start the scan timer
function startTimer() {
  scanStartTime = Date.now();
  updateTimer();
  // Update every second
  timerInterval = setInterval(updateTimer, 1000);
}

// Stop the scan timer
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Reset the scan timer
function resetTimer() {
  stopTimer();
  scanStartTime = null;
  document.getElementById('statTimer').textContent = '00:00';
}

// Update the live preview info table
function updatePreviewInfo() {
  const apiCount = endpoints.filter(ep =>
    ep.api_confidence === 'API' || ep.method === 'GET*'
  ).length;
  const pages = document.getElementById('statPages').textContent;
  document.getElementById('piPages').textContent = pages;
  document.getElementById('piApis').textContent = apiCount;
  if (scanStartTime) {
    const elapsed = Math.floor((Date.now() - scanStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    document.getElementById('piDuration').textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
}

// Helper function to check if an endpoint belongs to target domain or subdomain
function isDomainEndpoint(endpoint) {
  if (!endpoint || !endpoint.host || !targetDomain) return false;
  const host = endpoint.host.toLowerCase();
  const domain = targetDomain.toLowerCase();

  // Check if it's exact match or a subdomain
  return host === domain || host.endsWith('.' + domain);
}

// Helper function to update endpoint counter with friendly message
function updateEndpointCounter() {
  const totalCount = endpoints.length;
  // Count confirmed APIs + GET* endpoints that belong to domain/subdomain
  const domainCount = endpoints.filter(ep =>
    isDomainEndpoint(ep) &&
    (ep.api_confidence === 'API' || ep.method === 'GET*')
  ).length;

  const totalElement = document.getElementById('statEndpointsTotal');
  const domainElement = document.getElementById('statEndpointsDomain');
  const friendlyMsgElement = document.getElementById('friendlyMsg');

  totalElement.textContent = totalCount;
  domainElement.textContent = domainCount;

  // Update friendly message based on domain count (the more important metric)
  if (domainCount === 0) {
    friendlyMsgElement.textContent = '🔍 Nothing so far... keep watching!';
    friendlyMsgElement.style.display = 'block';
  } else if (domainCount === 1) {
    friendlyMsgElement.textContent = '🎉 First domain API found!';
    friendlyMsgElement.style.display = 'block';
  } else if (domainCount < 5) {
    friendlyMsgElement.textContent = `🚀 ${domainCount} domain APIs discovered!`;
    friendlyMsgElement.style.display = 'block';
  } else if (domainCount < 20) {
    friendlyMsgElement.textContent = `⚡ ${domainCount} domain endpoints and counting...`;
    friendlyMsgElement.style.display = 'block';
  } else if (domainCount < 50) {
    friendlyMsgElement.textContent = `💪 ${domainCount} domain APIs - great progress!`;
    friendlyMsgElement.style.display = 'block';
  } else {
    friendlyMsgElement.textContent = `🔥 Excellent! ${domainCount} domain endpoints found!`;
    friendlyMsgElement.style.display = 'block';
  }
}

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

function ensureWebSocket() {
  /**
   * Ensure a WebSocket connection exists and is open.
   * Returns a Promise that resolves when the connection is ready.
   * Reuses the existing connection if still open.
   */
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    ws = new WebSocket(`ws://${location.host}/ws`);

    ws.onopen = () => resolve();

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      handleEvent(msg);
    };

    ws.onclose = () => {
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

      ws = null;
      myScanId = null;
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      addLog('⚠️', 'Connection error', 'error');
      reject(err);
    };
  });
}

async function startScan(event) {
  event.preventDefault();

  const domain = document.getElementById('domain').value.trim();
  if (!domain) {
    alert('Please enter a domain name');
    return;
  }

  // Start scan timer
  startTimer();

  const apiFilter = document.querySelector('input[name="apiFilter"]:checked').value;

  const params = {
    domain: domain,
    max_pages: parseInt(document.getElementById('maxPages').value) || 50,
    max_depth: parseInt(document.getElementById('maxDepth').value) || 3,
    timeout: parseInt(document.getElementById('timeout').value) || 30000,
    include_subdomains: document.getElementById('includeSubdomains').checked,
    api_filter: apiFilter,
    concurrent_pages: parseInt(document.getElementById('concurrentPages').value) || 5,
    fast_mode: document.getElementById('fastMode').checked,
    use_proxy: document.getElementById('useProxy').checked
  };

  // Store target domain and settings for UI filtering
  targetDomain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  includeSubdomains = params.include_subdomains;

  // Hide the overlay and show controls
  document.getElementById('startOverlay').classList.add('hidden');
  document.getElementById('statusText').textContent = 'Connecting...';
  document.getElementById('pauseBtn').classList.remove('hidden');
  document.getElementById('findingsBtn').classList.remove('hidden');
  document.getElementById('stopBtn').classList.remove('hidden');
  document.getElementById('newScanBtn').classList.add('hidden');
  uiPaused = false; // Reset pause state

  // Show domain indicator
  const domainIndicator = document.getElementById('domainIndicator');
  domainIndicator.textContent = `🎯 ${targetDomain}`;
  domainIndicator.classList.remove('hidden');

  try {
    await ensureWebSocket();
    document.getElementById('statusText').textContent = 'Starting scan...';
    addLog('🚀', `Starting scan of ${params.domain}...`, 'page');
    ws.send(JSON.stringify(params));
  } catch (err) {
    document.getElementById('statusText').textContent = 'Connection failed';
  }
}

function togglePause() {
  uiPaused = !uiPaused;
  const btn = document.getElementById('pauseBtn');
  const statusText = document.getElementById('statusText');

  if (uiPaused) {
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
    document.getElementById('statHosts').textContent = hosts.size;

    // Rebuild the table with all endpoints
    const tbody = document.getElementById('tbody');
    tbody.innerHTML = '';
    endpoints.forEach(ep => addEndpointRow(ep, false));
    updateMethodFilters();
    applyFilters();

    addLog('▶️', `UI updates resumed - displaying ${endpoints.length} endpoints`, 'info');
  }
}

function stopScan() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: 'stop' }));
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
  endpoints.length = 0;
  hosts.clear();
  activeFilters.clear();
  domainFilter = 'all';
  targetDomain = '';
  currentPage = 1; // Reset pagination
  uiPaused = false; // Reset pause state
  resetTimer(); // Reset scan timer
  capturedScreenshots = []; // Clear screenshots
  subdomainResults = null; // Clear subdomain results

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
  document.getElementById('previewLive').classList.remove('hidden');
  document.getElementById('previewSummary').classList.add('hidden');
  lastScreenshotBase64 = null;
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
  } else {
    endpointsView.style.display = '';
    subdomainsView.classList.add('hidden');
    tabEndpoints.classList.add('active');
    tabSubdomains.classList.remove('active');
  }
}

function renderSubdomainTable(data) {
  const container = document.getElementById('subdomainContent');

  // data is the Lambda response — expect an array of subdomain objects
  const subdomains = Array.isArray(data) ? data : (data.subdomains || data.results || []);

  if (subdomains.length === 0) {
    container.innerHTML = `
      <div class="subdomain-placeholder">
        <div class="icon">🔍</div>
        <div>No subdomains discovered</div>
      </div>`;
    return;
  }

  // Count stats
  const liveCount = subdomains.filter(s => s.status_code && s.status_code >= 200 && s.status_code < 400).length;
  const crawlableCount = subdomains.filter(s => s.can_crawl).length;

  let html = `
    <div class="subdomain-summary">
      <div class="subdomain-summary-stat"><strong>${subdomains.length}</strong> subdomains found</div>
      <div class="subdomain-summary-stat"><strong>${liveCount}</strong> live (2xx/3xx)</div>
      <div class="subdomain-summary-stat"><strong>${crawlableCount}</strong> crawlable</div>
    </div>
    <table class="subdomain-table">
      <thead>
        <tr>
          <th style="width:50px">#</th>
          <th>Subdomain</th>
          <th style="width:60px">Status</th>
          <th>Title</th>
          <th>Technologies</th>
          <th style="width:90px">Screenshot</th>
        </tr>
      </thead>
      <tbody>`;

  for (let idx = 0; idx < subdomains.length; idx++) {
    const sub = subdomains[idx];
    const name = sub.subdomain || sub.domain || sub.host || '—';
    const status = sub.status_code || sub.status || 0;
    const title = sub.title || '—';
    const server = sub.web_server || sub.server || '—';
    const screenshot = sub.screenshot || sub.screenshot_url || '';
    const techs = sub.technologies || [];
    const crawlable = !!sub.can_crawl;

    // Status badge class
    let statusCls = 'subdomain-status-0';
    if (status >= 200 && status < 300) statusCls = 'subdomain-status-2xx';
    else if (status >= 300 && status < 400) statusCls = 'subdomain-status-3xx';
    else if (status >= 400 && status < 500) statusCls = 'subdomain-status-4xx';
    else if (status >= 500) statusCls = 'subdomain-status-5xx';

    // Technology tags
    const techHtml = techs.length > 0
      ? `<div class="subdomain-techs-wrap">${techs.map(t => `<span class="subdomain-tech-tag">${escHtml(t)}</span>`).join('')}</div>`
      : '<span style="color:var(--muted);font-size:0.75rem;">—</span>';

    // Screenshot is raw base64 JPEG from Lambda — add data URI prefix
    let thumbHtml = '<span style="color:var(--muted);font-size:0.75rem;">—</span>';
    if (screenshot && screenshot.length > 100) {
      const thumbSrc = screenshot.startsWith('data:') ? screenshot : `data:image/jpeg;base64,${screenshot}`;
      thumbHtml = `<img class="subdomain-thumb" src="${thumbSrc}" alt="${escHtml(name)}">`;
    }

    // Crawl button inline with subdomain name
    const crawlBtnHtml = crawlable
      ? ` <button class="crawl-btn" id="crawl-btn-${idx}" onclick="crawlSubdomain(event, ${idx}, '${escHtml(name)}')">🔍 Look deeper</button>`
      : '';

    html += `
      <tr id="sub-row-${idx}">
        <td style="text-align:center;color:var(--text-muted);font-size:0.85rem;">${idx + 1}</td>
        <td class="subdomain-name"><span id="crawl-td-${idx}">${escHtml(name)}${crawlBtnHtml}</span></td>
        <td><span class="subdomain-status ${statusCls}">${status || '—'}</span></td>
        <td class="subdomain-title" title="${escHtml(title)}">${escHtml(title)}</td>
        <td class="subdomain-techs">${techHtml}</td>
        <td>${thumbHtml}</td>
      </tr>`;

    // Expandable row for crawled URLs (initially empty, populated after crawl)
    if (crawlable) {
      html += `
      <tr id="crawled-row-${idx}" class="crawled-urls-row hidden">
        <td colspan="6" class="crawled-urls-cell">
          <div class="crawled-urls-list" id="crawled-list-${idx}"></div>
        </td>
      </tr>`;
    }
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

function isApiOrJsUrl(url) {
  const lower = url.toLowerCase();
  if (!/\.js(\?|$)/.test(lower)) return false;
  // Drop common JS libraries / frameworks
  const skip = [
    'jquery', 'bootstrap', 'popper', 'angular', 'react', 'react-dom',
    'vue', 'lodash', 'underscore', 'moment', 'axios', 'backbone',
    'ember', 'handlebars', 'mustache', 'knockout', 'd3', 'chart',
    'highcharts', 'three', 'gsap', 'tween', 'anime', 'velocity',
    'modernizr', 'polyfill', 'babel', 'core-js', 'regenerator',
    'runtime', 'webpack', 'chunk', 'vendor', 'commons',
    'fontawesome', 'fa-', 'ionicons', 'material-icons',
    'recaptcha', 'gtag', 'gtm', 'analytics', 'hotjar', 'sentry',
    'datadog', 'newrelic', 'segment', 'pixel', 'fbevents',
    'cloudflare', 'cdn-cgi', 'cookie', 'consent', 'onetrust',
    'swiper', 'slick', 'owl', 'lightbox', 'fancybox', 'magnific',
    'select2', 'chosen', 'flatpickr', 'datepicker', 'tinymce',
    'ckeditor', 'quill', 'codemirror', 'ace-editor',
    'socket.io', 'sockjs', 'stomp', 'signalr',
    'lazysizes', 'lazyload', 'intersection-observer',
    'crypto-js', 'jsencrypt', 'forge',
    'zone.js', 'rxjs', 'tslib',
  ];
  const fname = lower.split('/').pop().split('?')[0];
  return !skip.some(lib => fname.includes(lib));
}

async function crawlSubdomain(event, idx, subdomain) {
  event.stopPropagation();
  const wrapper = document.getElementById(`crawl-td-${idx}`);
  const expandRow = document.getElementById(`crawled-row-${idx}`);
  const listDiv = document.getElementById(`crawled-list-${idx}`);

  // Replace crawl button with spinner, keep subdomain name
  wrapper.innerHTML = `${escHtml(subdomain)} <span class="crawl-spinner"><span class="crawl-spin-icon"></span> Looking deeper...</span>`;

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        wrapper.innerHTML = `${escHtml(subdomain)} <span class="crawl-spinner"><span class="crawl-spin-icon"></span> Retry ${attempt}/${maxRetries}...</span>`;
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }

      const resp = await fetch(`/api/crawl-subdomain?crawl=${encodeURIComponent(subdomain)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      const rawUrls = data.crawled_urls || data.urls || (Array.isArray(data) ? data : []);
      const urls = rawUrls.filter(isApiOrJsUrl);
      // Find JS files in both filtered and raw lists
      const jsUrls = rawUrls.filter(u => /\.js(\?|#|$)/i.test(u));
      if (urls.length > 0) {
        // Show pill with count next to name, plus "Even Deeper" if JS files exist
        const evenDeeperBtn = jsUrls.length > 0
          ? ` <button class="even-deeper-btn" id="even-deeper-btn-${idx}" onclick="analyzeJsDeeper(event, ${idx}, '${escHtml(subdomain)}')">🔬 Hunt for API's</button>`
          : '';
        wrapper.innerHTML = `${escHtml(subdomain)} <span class="crawled-urls-pill" onclick="toggleUrlList(event, 'url-list-${idx}')">${urls.length} resources</span>${evenDeeperBtn}`;
        // Store JS URLs as data attribute for the analyzer
        const expandRow2 = document.getElementById(`crawled-row-${idx}`);
        if (expandRow2) expandRow2.dataset.jsUrls = JSON.stringify(jsUrls);
        // Populate expandable row with collapsible URL list + separate API results area
        const urlItems = urls.map(u => {
          let display = u;
          try {
            const parsed = new URL(u);
            display = parsed.pathname + parsed.search;
            if (display.length > 90) display = display.slice(0, 80) + '…';
          } catch {}
          return `<div class="crawled-url-item"><a href="${escHtml(u)}" target="_blank" rel="noopener" title="${escHtml(u)}">${escHtml(display)}</a></div>`;
        }).join('');
        listDiv.innerHTML = `<div id="even-deeper-results-${idx}" class="even-deeper-results"></div>`
          + `<div id="url-list-${idx}" class="url-list-collapsible collapsed">${urlItems}</div>`;
        // Keep row hidden — it will show when user expands URL list or APIs are found
      } else {
        // No API URLs but still might have JS files in raw list
        const jsOnly = rawUrls.filter(u => /\.js(\?|#|$)/i.test(u));
        if (jsOnly.length > 0) {
          const expandRow2 = document.getElementById(`crawled-row-${idx}`);
          if (expandRow2) expandRow2.dataset.jsUrls = JSON.stringify(jsOnly);
          wrapper.innerHTML = `${escHtml(subdomain)} <button class="even-deeper-btn" id="even-deeper-btn-${idx}" onclick="analyzeJsDeeper(event, ${idx}, '${escHtml(subdomain)}')">🔬 Hunt for API's</button>`;
          listDiv.innerHTML = `<div id="even-deeper-results-${idx}" class="even-deeper-results"></div>`;
        } else {
          wrapper.innerHTML = `${escHtml(subdomain)} <span class="crawl-done-empty">Nothing interesting here</span>`;
        }
      }
      return; // Success — exit the retry loop
    } catch (err) {
      if (attempt === maxRetries) {
        wrapper.innerHTML = `${escHtml(subdomain)} <span class="crawl-error" title="${escHtml(err.message)}">Failed</span>`;
      }
    }
  }
}

async function analyzeJsDeeper(event, idx, subdomain) {
  event.stopPropagation();
  const btn = document.getElementById(`even-deeper-btn-${idx}`);
  const resultsDiv = document.getElementById(`even-deeper-results-${idx}`);

  // Collect JS URLs from stored data attribute
  const expandRow = document.getElementById(`crawled-row-${idx}`);
  let jsUrls = [];
  try { jsUrls = JSON.parse(expandRow.dataset.jsUrls || '[]'); } catch {};

  if (jsUrls.length === 0) return;

  // Replace button with spinner
  btn.outerHTML = `<span class="crawl-spinner" id="even-deeper-spinner-${idx}"><span class="crawl-spin-icon"></span> Hunting for APIs...</span>`;

  // Show inline loading state
  if (resultsDiv) resultsDiv.innerHTML = '';

  const maxRetries = 2;
  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const spinnerEl = document.getElementById(`even-deeper-spinner-${idx}`);
        if (spinnerEl) spinnerEl.innerHTML = `<span class="crawl-spin-icon"></span> Retry ${attempt}/${maxRetries}...`;
        if (resultsDiv) resultsDiv.innerHTML = '';
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }

      const resp = await fetch('/api/analyze-js', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({urls: jsUrls})
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const apis = data.apis || [];

      // Remove spinner, add API count pill
      const spinner = document.getElementById(`even-deeper-spinner-${idx}`);

      // Filter out variable names (url must contain at least one '/') and deduplicate
      const staticExts = /\.(js|css|html|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|map|xml|json)(\?|#|$)/i;
      const dedupSeen = new Set();
      const dedupApis = apis.filter(a => {
        const url = a.url || '';
        if (!url.includes('/')) return false;
        if (staticExts.test(url.split('/').pop())) return false;
        const k = `${(a.method || 'GET').toUpperCase()}|${url}|${a.source_file || ''}`;
        if (dedupSeen.has(k)) return false;
        dedupSeen.add(k);
        return true;
      });

      if (dedupApis.length > 0) {
        // Store deduplicated results for the drawer
        subdomainApis[idx] = { subdomain, apis: dedupApis, jsUrls };

        const apiLabel = `<span class="api-count-pill has-apis" onclick="openApiDrawer(${idx})">${dedupApis.length} APIs</span>`;
        if (spinner) spinner.outerHTML = apiLabel;

        // Clear inline results area — APIs now live in the drawer
        if (resultsDiv) resultsDiv.innerHTML = '';

        // Collapse the JS file list
        const urlListFound = document.getElementById(`url-list-${idx}`);
        if (urlListFound) urlListFound.classList.add('collapsed');
        const wrapperFound = document.getElementById(`crawl-td-${idx}`);
        if (wrapperFound) {
          const pillEl = wrapperFound.querySelector('.crawled-urls-pill');
          if (pillEl) pillEl.classList.remove('active');
        }

        // Auto-open the drawer
        openApiDrawer(idx);
      } else {
        const apiLabel = `<span class="api-count-pill no-apis">No APIs here..</span>`;
        if (spinner) spinner.outerHTML = apiLabel;
        // Hide the expandable row entirely
        const expandRowEl = document.getElementById(`crawled-row-${idx}`);
        if (expandRowEl) expandRowEl.classList.add('hidden');
      }
      return; // Success — exit the retry loop
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) {
        const spinner = document.getElementById(`even-deeper-spinner-${idx}`);
        if (spinner) spinner.outerHTML = `<span class="crawl-error" title="${escHtml(err.message)}">Analysis failed</span>`;
        if (resultsDiv) resultsDiv.innerHTML = `<div class="even-deeper-error">Analysis failed: ${escHtml(err.message)}</div>`;
      }
    }
  }
}

function apiHostBelongsToDomain(apiUrl) {
  if (!targetDomain) return false;
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

function openApiDrawer(idx) {
  const data = subdomainApis[idx];
  if (!data) return;

  const drawer = document.getElementById('apiDrawer');
  const title = document.getElementById('apiDrawerTitle');
  const subtitle = document.getElementById('apiDrawerSubtitle');
  const content = document.getElementById('apiDrawerContent');

  title.textContent = data.subdomain;

  // Classify APIs as domain or external
  const classified = data.apis.map(api => {
    const url = api.url || '';
    const isDomain = apiHostBelongsToDomain(url);
    return { api, isDomain };
  });

  // Sort: domain APIs first
  classified.sort((a, b) => (b.isDomain ? 1 : 0) - (a.isDomain ? 1 : 0));

  const domainCount = classified.filter(c => c.isDomain).length;
  const externalCount = classified.length - domainCount;
  subtitle.textContent = `${classified.length} API${classified.length !== 1 ? 's' : ''} found — ${domainCount} domain, ${externalCount} external`;

  let html = '';
  for (const { api, isDomain } of classified) {
    const method = (api.method || 'GET').toUpperCase();
    const mCls = 'method-' + method;
    const srcName = api.source_file || '';
    const srcBaseName = srcName.split('/').pop().split('?')[0].toLowerCase();
    const srcUrl = srcName ? (
      data.jsUrls.find(u => u.endsWith(srcName) || u.includes('/' + srcName)) ||
      data.jsUrls.find(u => { const uBase = u.split('/').pop().split('?')[0].toLowerCase(); return uBase === srcBaseName; }) ||
      data.jsUrls.find(u => srcBaseName && u.toLowerCase().includes(srcBaseName)) ||
      '') : '';
    const srcHtml = srcUrl
      ? `<a href="${escHtml(srcUrl)}" target="_blank" rel="noopener">${escHtml(srcName)}</a>`
      : escHtml(srcName);
    const originCls = isDomain ? 'api-card-domain' : 'api-card-external';
    const originTag = isDomain
      ? '<span class="api-origin-tag domain">Domain</span>'
      : '<span class="api-origin-tag external">External</span>';
    const evidence = api.evidence || '';
    const evidenceHtml = evidence
      ? `<div class="api-card-evidence-toggle" onclick="this.nextElementSibling.classList.toggle('collapsed');this.querySelector('span').textContent=this.nextElementSibling.classList.contains('collapsed')?'▶':'▼'"><span>▶</span> Evidence</div><pre class="api-card-evidence collapsed">${escHtml(evidence)}</pre>`
      : '';
    html += `<div class="api-card ${originCls}">
      <div class="api-card-top">
        <span class="api-card-method ${mCls}">${escHtml(method)}</span>
        <span class="api-card-endpoint">${escHtml(api.url || '')}</span>
        ${originTag}
      </div>
      <div class="api-card-bottom">
        <span class="api-card-ctx">${escHtml(api.context || '')}</span>
        <span class="api-card-src">${srcHtml}</span>
      </div>
      ${evidenceHtml}
    </div>`;
  }

  content.innerHTML = html;
  drawer.classList.add('open');
}

function closeApiDrawer() {
  document.getElementById('apiDrawer').classList.remove('open');
}

function toggleCrawledUrls(event, rowId) {
  event.stopPropagation();
  const row = document.getElementById(rowId);
  const pill = event.currentTarget;
  if (row.classList.contains('hidden')) {
    row.classList.remove('hidden');
    pill.classList.add('active');
  } else {
    row.classList.add('hidden');
    pill.classList.remove('active');
  }
}

function toggleUrlList(event, listId) {
  event.stopPropagation();
  const list = document.getElementById(listId);
  const pill = event.currentTarget;
  // Find the parent expandable row
  const expandRow = list ? list.closest('.crawled-urls-row') : null;
  if (list.classList.contains('collapsed')) {
    list.classList.remove('collapsed');
    pill.classList.add('active');
    if (expandRow) expandRow.classList.remove('hidden');
  } else {
    list.classList.add('collapsed');
    pill.classList.remove('active');
    // Hide the row if no other visible content (e.g. no API results showing)
    if (expandRow) {
      const results = expandRow.querySelector('.even-deeper-results');
      if (!results || !results.innerHTML.trim()) expandRow.classList.add('hidden');
    }
  }
}

function handleEvent(msg) {
  switch(msg.type) {
    case 'status':
      if (!uiPaused) {
        addLog('ℹ️', msg.message, '');
      }
      break;

    case 'error':
      // Always show errors even when paused
      addLog('⚠️', msg.message, 'error');
      document.getElementById('statusText').textContent = 'Error';
      break;

    case 'crawl_start':
      if (!uiPaused) {
        document.getElementById('statPages').textContent = msg.pages_visited;
        document.getElementById('statQueue').textContent = msg.pages_remaining;
        updateEndpointCounter();
        document.getElementById('currentUrl').textContent = msg.url;
        addLog('📄', `Crawling: ${shortenUrl(msg.url)}`, 'page');
      }
      break;

    case 'heartbeat':
      // Update stats from heartbeat to keep WebSocket alive and show progress
      if (msg.scan_id && msg.scan_id === myScanId) {
        document.getElementById('statPages').textContent = msg.pages_visited || 0;
        document.getElementById('statQueue').textContent = msg.queue_size || 0;
      }
      break;

    case 'screenshot':
      // Only process screenshots from OUR scan
      if (msg.scan_id && msg.scan_id !== myScanId) {
        break;  // Ignore screenshots from other scans
      }

      // Store up to 5 screenshots for report carousel
      if (capturedScreenshots.length < 5) {
        capturedScreenshots.push({
          image: msg.image,
          url: msg.url
        });
      }
      if (!uiPaused) {
        document.getElementById('previewThumb').innerHTML = `<img src="data:image/jpeg;base64,${msg.image}" alt="screenshot">`;
        document.getElementById('currentUrl').textContent = msg.url;
        lastScreenshotBase64 = msg.image;
      }
      break;

    case 'endpoint':
      if (!uiPaused) {
        endpoints.push(msg);
        hosts.add(msg.host);
        updateEndpointCounter();
        document.getElementById('statHosts').textContent = hosts.size;
        document.getElementById('emptyState').style.display = 'none';
        addEndpointRow(msg, true);
        updateMethodFilters();
        addLog('🎯', `${msg.method} ${msg.host}${msg.path}`, 'endpoint');
      } else {
        // Still add to endpoints array even when paused, just don't update UI
        endpoints.push(msg);
        hosts.add(msg.host);
      }
      break;

    case 'active_scans':
      // Always update scan ID if provided (handles reconnections)
      if (msg.your_scan_id) {
        myScanId = msg.your_scan_id;
      }
      renderActiveScans(msg.scans);
      break;

    case 'subdomains_loading':
      subdomainResults = null;
      document.getElementById('subdomainContent').innerHTML = `
        <div class="subdomain-loading">
          <div class="spinner"></div>
          <div class="loading-text">Discovering subdomains...</div>
          <div class="loading-subtext">This may take up to 2 minutes</div>
        </div>`;
      addLog('🌐', 'Subdomain discovery started...', '');
      break;

    case 'subdomains':
      subdomainResults = msg.data;
      renderSubdomainTable(msg.data);
      {
        const subs = Array.isArray(msg.data) ? msg.data : (msg.data.subdomains || msg.data.results || []);
        addLog('🌐', `Subdomain discovery complete: ${subs.length} found`, 'endpoint');
      }
      break;

    case 'subdomains_error':
      subdomainResults = null;
      document.getElementById('subdomainContent').innerHTML = `
        <div class="subdomain-error">${escHtml(msg.message)}</div>`;
      addLog('⚠️', msg.message, 'error');
      break;

    case 'crawl_error':
      // Always show errors even when paused
      addLog('⚠️', `Error on ${shortenUrl(msg.url)}: ${msg.error}`, 'error');
      break;

    case 'crawl_end':
      break;

    case 'done':
      // Stop the timer
      stopTimer();

      // Store detected technologies
      if (msg.technologies) {
        detectedTechnologies = msg.technologies;
        console.log('Technologies detected:', detectedTechnologies);
      }

      // Always handle completion even when paused
      document.getElementById('liveDot').classList.add('done');
      document.getElementById('statusText').textContent =
        `Done — ${msg.total_endpoints} endpoints found`;
      document.getElementById('pauseBtn').classList.add('hidden');
      document.getElementById('findingsBtn').classList.add('hidden');
      document.getElementById('stopBtn').classList.add('hidden');
      document.getElementById('newScanBtn').classList.remove('hidden');
      document.getElementById('statQueue').textContent = '0';  // Clear queue count
      const skippedMsg = msg.pages_skipped > 0 ? ` (${msg.pages_skipped} queued pages skipped)` : '';
      addLog('✅', `Scan complete. ${msg.total_endpoints} endpoints across ${msg.pages_visited} pages.${skippedMsg}`, '');

      // If UI was paused, refresh the display with all endpoints
      if (uiPaused) {
        uiPaused = false;
        updateEndpointCounter();
        document.getElementById('statHosts').textContent = hosts.size;
        // Rebuild the table with all endpoints
        const tbody = document.getElementById('tbody');
        tbody.innerHTML = '';
        endpoints.forEach(ep => addEndpointRow(ep, false));
        updateMethodFilters();
        applyFilters();
      }

      // Show "No records found" if scan completed with no endpoints
      if (msg.total_endpoints === 0) {
        const emptyState = document.getElementById('emptyState');
        emptyState.innerHTML = '<div class="icon">🔍</div><div>No records found</div>';
        emptyState.style.display = 'block';
      }

      // Switch Live Preview from screenshot to summary table
      const duration = scanStartTime ? Math.round((Date.now() - scanStartTime) / 1000) : 0;
      const mins = Math.floor(duration / 60);
      const secs = duration % 60;
      const durText = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      const apiFound = endpoints.filter(ep => ep.api_confidence === 'API' || ep.method === 'GET*').length;

      // Populate summary table
      document.getElementById('piStatus').textContent = 'Complete';
      document.getElementById('piStatus').style.color = 'var(--green)';
      document.getElementById('piTarget').textContent = targetDomain;
      document.getElementById('piPages').textContent = msg.pages_visited;
      document.getElementById('piApis').textContent = apiFound;
      document.getElementById('piApis').className = apiFound > 0 ? 'pi-value highlight' : 'pi-value';
      document.getElementById('piDuration').textContent = durText;

      // Toggle views: hide live, show summary
      document.getElementById('previewLive').classList.add('hidden');
      document.getElementById('previewSummary').classList.remove('hidden');

      // Show scan summary modal
      showScanSummary(msg);
      break;
  }
}

function addEndpointRow(ep, flash=false) {
  const tbody = document.getElementById('tbody');
  const tr = document.createElement('tr');
  if (flash) tr.classList.add('flash');
  tr.dataset.method = ep.method;
  tr.dataset.path = ep.path;
  tr.dataset.host = ep.host;
  tr.dataset.endpoint = JSON.stringify(ep); // Store full endpoint data
  tr.onclick = () => openDrawer(ep);

  const statusClass = ep.response_status ? `status-${Math.floor(ep.response_status/100)}xx` : '';
  const badgeClass = `badge-${ep.method.replace('*','\\\\*')}`;

  // API confidence badge (inline with path)
  let typeBadge = '';
  if (ep.api_confidence === 'API') {
    typeBadge = '<span style="display:inline-block;padding:0.15rem 0.4rem;background:rgba(34,211,238,0.15);color:#22d3ee;border:1px solid rgba(34,211,238,0.3);border-radius:3px;font-size:0.7rem;font-weight:600;margin-right:0.5rem;">API</span>';
  } else if (ep.api_confidence === 'Maybe API') {
    typeBadge = '<span style="display:inline-block;padding:0.15rem 0.4rem;background:rgba(251,191,36,0.15);color:#fbbf24;border:1px solid rgba(251,191,36,0.3);border-radius:3px;font-size:0.7rem;font-weight:600;margin-right:0.5rem;">Maybe</span>';
  }

  // Method with tooltip
  const methodTitle = escHtml(getMethodExplanation(ep.method));

  // Status code with tooltip
  const statusDisplay = ep.response_status || '—';
  const statusTitle = ep.response_status ? escHtml(getStatusExplanation(ep.response_status)) : '';

  tr.innerHTML = `
    <td class="row-number" style="text-align:center;color:var(--text-muted);font-size:0.85rem;"></td>
    <td><span class="badge ${badgeClass}" style="cursor:help;" title="${methodTitle}">${ep.method}</span></td>
    <td class="path-cell" title="${escHtml(ep.path)}">${typeBadge}${escHtml(trimPath(ep.path))}</td>
    <td class="host-cell">${escHtml(ep.host)}</td>
    <td class="${statusClass}" style="font-weight:600;font-size:0.8rem;cursor:help;" title="${statusTitle}">${statusDisplay}</td>
    <td class="reason-cell">${escHtml(ep.detection_reason)}</td>
  `;

  // Insert at top for most recent (always add to DOM - model contains ALL endpoints)
  tbody.insertBefore(tr, tbody.firstChild);

  // Apply filters to update visibility (view layer)
  applyFilters();
}

function renderActiveScans(scans) {
  const badge = document.getElementById('otherScans');

  // Null check: ensure badge element exists
  if (!badge) {
    console.warn('otherScans badge element not found');
    return;
  }

  // Validate data: ensure scans is an array
  if (!Array.isArray(scans)) {
    console.warn('Invalid scans data received:', scans);
    badge.classList.add('hidden');
    return;
  }

  // Filter out current scan and validate scan objects
  const others = scans.filter(s => s && s.scan_id && s.scan_id !== myScanId);

  if (others.length === 0) {
    badge.classList.add('hidden');
    badge.textContent = '';
    return;
  }

  // Build domain list with validation
  const domains = others
    .map(s => s.domain || 'unknown')
    .join(', ');

  badge.textContent = `${others.length} other scan${others.length > 1 ? 's' : ''} active: ${domains}`;
  badge.classList.remove('hidden');
}

function addLog(icon, message, cls) {
  const log = document.getElementById('activityLog');
  const div = document.createElement('div');
  div.className = `log-entry ${cls}`;
  div.innerHTML = `<span class="icon">${icon}</span><span class="msg">${escHtml(message)}</span>`;
  log.insertBefore(div, log.firstChild);
  // Keep log manageable
  while (log.children.length > 200) log.removeChild(log.lastChild);
}

function updateMethodFilters() {
  const methods = [...new Set(endpoints.map(e => e.method))].sort();
  const container = document.getElementById('methodFilters');
  container.innerHTML = '';
  methods.forEach(m => {
    const btn = document.createElement('span');
    btn.className = 'filter-btn' + (activeFilters.has(m) ? ' active' : '');
    btn.textContent = m;
    btn.onclick = () => {
      activeFilters.has(m) ? activeFilters.delete(m) : activeFilters.add(m);
      currentPage = 1; // Reset to first page when filter changes
      applyFilters();
      updateMethodFilters();
    };
    container.appendChild(btn);
  });
}

function isSubdomainEndpoint(host) {
  if (!host || !targetDomain) return false;
  const hostLower = host.toLowerCase();
  const target = targetDomain.toLowerCase();
  // Check if host matches target domain or is a subdomain
  // Must match exactly OR end with ".{domain}"
  return hostLower === target || hostLower.endsWith(`.${target}`);
}

function setDomainFilter(filter) {
  domainFilter = filter;
  // Update button states
  ['All', 'Subdomain', 'External'].forEach(f => {
    const btn = document.getElementById(`domain${f}`);
    if (btn) {
      btn.classList.toggle('active', f.toLowerCase() === filter);
    }
  });
  currentPage = 1; // Reset to first page when filter changes
  applyFilters();
}

let apiFilter = 'all';
function setApiFilter(filter) {
  apiFilter = filter;
  // Update button states
  ['All', 'Confirmed', 'Maybe', 'None'].forEach(f => {
    const btn = document.getElementById(`api${f}`);
    if (btn) {
      btn.classList.toggle('active', f.toLowerCase() === filter);
    }
  });
  currentPage = 1; // Reset to first page when filter changes
  applyFilters();
}

let statusFilter = 'all';
function setStatusFilter(filter) {
  statusFilter = filter;
  // Update button states
  ['All', '2xx', '3xx', '4xx', '5xx', 'None'].forEach(f => {
    const btn = document.getElementById(`status${f}`);
    if (btn) {
      btn.classList.toggle('active', f.toLowerCase() === filter);
    }
  });
  currentPage = 1; // Reset to first page when filter changes
  applyFilters();
}

function applyFilters() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const matchingRows = [];

  // First pass: determine which rows match filters
  document.querySelectorAll('#tbody tr').forEach(tr => {
    const text = `${tr.dataset.method} ${tr.dataset.path} ${tr.dataset.host}`.toLowerCase();
    const matchQ = !q || text.includes(q);
    const matchM = activeFilters.size === 0 || activeFilters.has(tr.dataset.method);

    // Domain filter
    let matchD = true;
    if (domainFilter !== 'all' && targetDomain) {
      const isSubdomain = isSubdomainEndpoint(tr.dataset.host);
      matchD = (domainFilter === 'subdomain' && isSubdomain) ||
               (domainFilter === 'external' && !isSubdomain);
    }

    // API confidence filter
    let matchAPI = true;
    if (apiFilter !== 'all') {
      const ep = JSON.parse(tr.dataset.endpoint);
      if (apiFilter === 'confirmed') {
        matchAPI = ep.api_confidence === 'API';
      } else if (apiFilter === 'maybe') {
        matchAPI = ep.api_confidence === 'Maybe API';
      } else if (apiFilter === 'none') {
        matchAPI = !ep.api_confidence || (ep.api_confidence !== 'API' && ep.api_confidence !== 'Maybe API');
      }
    }

    // Status code filter
    let matchStatus = true;
    if (statusFilter !== 'all') {
      const ep = JSON.parse(tr.dataset.endpoint);
      const status = ep.response_status;
      if (statusFilter === '2xx') {
        matchStatus = status >= 200 && status < 300;
      } else if (statusFilter === '3xx') {
        matchStatus = status >= 300 && status < 400;
      } else if (statusFilter === '4xx') {
        matchStatus = status >= 400 && status < 500;
      } else if (statusFilter === '5xx') {
        matchStatus = status >= 500 && status < 600;
      } else if (statusFilter === 'none') {
        matchStatus = !status;
      }
    }

    const matches = matchQ && matchM && matchD && matchAPI && matchStatus;
    if (matches) {
      matchingRows.push(tr);
    }
  });

  // Calculate pagination
  const totalMatching = matchingRows.length;
  const totalPages = Math.ceil(totalMatching / itemsPerPage);

  // Ensure current page is valid
  if (currentPage > totalPages && totalPages > 0) {
    currentPage = totalPages;
  }
  if (currentPage < 1) {
    currentPage = 1;
  }

  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;

  // Second pass: show/hide rows based on filters and pagination
  let rowIndex = 0;
  document.querySelectorAll('#tbody tr').forEach(tr => {
    const isMatching = matchingRows.includes(tr);
    const isInPage = isMatching && rowIndex >= startIdx && rowIndex < endIdx;
    tr.style.display = isInPage ? '' : 'none';

    // Update row number for visible rows
    if (isMatching) {
      const rowNumber = rowIndex + 1; // 1-based numbering
      const rowNumberCell = tr.querySelector('.row-number');
      if (rowNumberCell) {
        rowNumberCell.textContent = rowNumber;
      }
      rowIndex++;
    }
  });

  // Show/hide empty state
  const emptyState = document.getElementById('emptyState');
  const tbody = document.getElementById('tbody');
  if (tbody.children.length === 0) {
    emptyState.innerHTML = '<div class="icon">📡</div><div>Waiting for API endpoints to appear...</div>';
    emptyState.style.display = 'block';
  } else if (totalMatching === 0) {
    emptyState.innerHTML = '<div class="icon">🔍</div><div>No records found</div>';
    emptyState.style.display = 'block';
  } else {
    emptyState.style.display = 'none';
  }

  // Update pagination UI
  updatePagination(totalMatching, totalPages);
}

function updatePagination(totalMatching, totalPages) {
  const pagination = document.getElementById('pagination');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const pageNumbers = document.getElementById('pageNumbers');

  // Show pagination only if more than itemsPerPage endpoints
  if (totalMatching > itemsPerPage) {
    pagination.style.display = 'flex';

    // Update button states
    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage === totalPages;

    // Render page numbers (show max 7 page buttons)
    pageNumbers.innerHTML = '';
    const maxButtons = 7;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    // Adjust start if we're near the end
    if (endPage - startPage < maxButtons - 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    // First page button
    if (startPage > 1) {
      const btn = createPageButton(1);
      pageNumbers.appendChild(btn);
      if (startPage > 2) {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.padding = '0.4rem 0.5rem';
        ellipsis.style.color = 'var(--text-muted)';
        pageNumbers.appendChild(ellipsis);
      }
    }

    // Page number buttons
    for (let i = startPage; i <= endPage; i++) {
      const btn = createPageButton(i);
      pageNumbers.appendChild(btn);
    }

    // Last page button
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.padding = '0.4rem 0.5rem';
        ellipsis.style.color = 'var(--text-muted)';
        pageNumbers.appendChild(ellipsis);
      }
      const btn = createPageButton(totalPages);
      pageNumbers.appendChild(btn);
    }
  } else {
    pagination.style.display = 'none';
  }
}

function createPageButton(pageNum) {
  const btn = document.createElement('span');
  btn.className = 'page-num' + (pageNum === currentPage ? ' active' : '');
  btn.textContent = pageNum;
  btn.onclick = () => {
    currentPage = pageNum;
    applyFilters();
  };
  return btn;
}

function changePage(delta) {
  currentPage += delta;
  applyFilters();
}

function sortBy(col) {
  if (sortCol === col) sortAsc = !sortAsc;
  else { sortCol = col; sortAsc = true; }
  const colIdx = {method:0,path:1,host:2,status:3,reason:4}[col];
  const tbody = document.getElementById('tbody');
  const rows = [...tbody.querySelectorAll('tr')];
  rows.sort((a,b) => {
    const av = a.children[colIdx].textContent.trim();
    const bv = b.children[colIdx].textContent.trim();
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  rows.forEach(r => tbody.appendChild(r));
  applyFilters(); // Re-apply filters and pagination after sorting
}

function shortenUrl(u) {
  try { return new URL(u).pathname; } catch { return u; }
}
function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function trimPath(path, maxLength = 80) {
  if (path.length <= maxLength) return path;
  const start = Math.floor(maxLength * 0.4);
  const end = Math.floor(maxLength * 0.4);
  return path.substring(0, start) + '...' + path.substring(path.length - end);
}

function openDrawer(ep) {
  const drawer = document.getElementById('detailDrawer');
  const content = document.getElementById('drawerContent');

  // Format timestamp
  const timestamp = ep.timestamp ? new Date(ep.timestamp).toLocaleString() : 'N/A';

  // Determine detection method
  const detectionMethod = ep.method.endsWith('*') ? 'Source Code (HTML)' : 'Network Traffic (JavaScript)';

  content.innerHTML = `
    ${ep.api_confidence === 'API' ? `
    <div class="detail-section" style="border-bottom: 2px solid var(--border);">
      ${ep.llm_description ? `
        <div class="api-description-section">
          <div class="api-description-header" onclick="toggleDescription()">
            <h4>📋 API Description</h4>
            <button class="collapse-toggle" id="collapseToggle">▼</button>
          </div>
          <div class="api-description-content" id="apiDescriptionContent">
            ${formatAPIDescription(ep.llm_description)}
          </div>
        </div>
      ` : `
        <button class="generate-description-btn" onclick="generateDescription('${escHtml(ep.method)}', '${escHtml(ep.path)}', '${escHtml(ep.host)}', ${ep.response_status || 'null'})">
          📋 Generate API Description
        </button>
        <div id="apiDescriptionResult"></div>
      `}
    </div>
    ` : ''}

    <div class="detail-section">
      <div class="detail-label">HTTP Method</div>
      <div class="detail-value large">
        <span class="badge badge-${ep.method.replace('*','\\\\*')}">${ep.method.replace('*', '')}</span>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-label">Full URL</div>
      <div class="detail-value">${escHtml(ep.full_url)}</div>
    </div>

    <div class="detail-section">
      <div class="detail-label">Host</div>
      <div class="detail-value">${escHtml(ep.host)}</div>
    </div>

    <div class="detail-section">
      <div class="detail-label">Path</div>
      <div class="detail-value">${escHtml(ep.path)}</div>
    </div>

    ${ep.query_params && ep.query_params.length > 0 ? `
    <div class="detail-section">
      <div class="detail-label">Query Parameters</div>
      <div class="detail-value">
        ${ep.query_params.map(p => `<span class="query-param">${escHtml(p)}</span>`).join('')}
      </div>
    </div>
    ` : ''}

    ${ep.response_status ? `
    <div class="detail-section">
      <div class="detail-label">Response Status</div>
      <div class="detail-value large status-${Math.floor(ep.response_status/100)}xx">${ep.response_status}</div>
    </div>
    ` : ''}

    ${ep.content_type ? `
    <div class="detail-section">
      <div class="detail-label">Content-Type</div>
      <div class="detail-value">${escHtml(ep.content_type)}</div>
    </div>
    ` : ''}

    <div class="detail-section">
      <div class="detail-label">Detection Method</div>
      <div class="detail-value">${detectionMethod}</div>
    </div>

    ${ep.source_location ? `
    <div class="detail-section">
      <div class="detail-label">Source Location</div>
      <div class="detail-value">${escHtml(ep.source_location)}</div>
    </div>
    ` : ''}

    ${ep.resource_type ? `
    <div class="detail-section">
      <div class="detail-label">Resource Type</div>
      <div class="detail-value">${escHtml(ep.resource_type)}</div>
    </div>
    ` : ''}

    <div class="detail-section">
      <div class="detail-label">Detection Reason</div>
      <div class="detail-value">${escHtml(ep.detection_reason)}</div>
    </div>

    <div class="detail-section">
      <div class="detail-label">Found On Page</div>
      <div class="detail-value">${escHtml(ep.found_on_page)}</div>
    </div>

    <div class="detail-section">
      <div class="detail-label">Discovered At</div>
      <div class="detail-value">${timestamp}</div>
    </div>
  `;

  drawer.classList.add('open');

  // Store endpoint data for description generation
  drawer.dataset.endpoint = JSON.stringify(ep);
}

function closeDrawer() {
  document.getElementById('detailDrawer').classList.remove('open');
}

function toggleDescription() {
  const content = document.getElementById('apiDescriptionContent');
  const toggle = document.getElementById('collapseToggle');

  if (content && toggle) {
    content.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed');
  }
}

function showScanSummary(msg) {
  // Calculate duration
  const duration = scanStartTime ? Math.round((Date.now() - scanStartTime) / 1000) : 0;
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const durationText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  // Calculate rate
  const pagesPerMin = minutes > 0 ? Math.round(msg.pages_visited / (duration / 60)) : 0;

  // Count API endpoints
  const apiCount = endpoints.filter(ep => ep.api_confidence === 'API').length;

  // Count subdomains
  const hostArray = Array.from(hosts);
  const subdomainCount = hostArray.filter(h => h !== targetDomain && h.endsWith(`.${targetDomain}`)).length;

  // Update modal content
  document.getElementById('summaryEndpoints').textContent = msg.total_endpoints;
  document.getElementById('summaryApiCount').textContent = `${apiCount} confirmed APIs`;
  document.getElementById('summaryPages').textContent = msg.pages_visited;
  document.getElementById('summarySkipped').textContent = msg.pages_skipped > 0 ? `${msg.pages_skipped} skipped` : '';
  document.getElementById('summaryDuration').textContent = durationText;
  document.getElementById('summaryRate').textContent = pagesPerMin > 0 ? `${pagesPerMin} pages/min` : '';
  // Count external domains
  const externalCount = hostArray.filter(h => h !== targetDomain && !h.endsWith(`.${targetDomain}`)).length;

  document.getElementById('summaryHosts').textContent = hosts.size;
  document.getElementById('summarySubdomains').textContent = `${subdomainCount} subdomains, ${externalCount} external`;

  // Separate subdomains from external domains
  const subdomains = [];
  const externalDomains = [];
  const sortedHosts = hostArray.sort();

  sortedHosts.forEach(host => {
    if (host === targetDomain || host.endsWith(`.${targetDomain}`)) {
      subdomains.push(host);
    } else {
      externalDomains.push(host);
    }
  });

  // Populate subdomain list
  const subdomainList = document.getElementById('summarySubdomainList');
  subdomainList.innerHTML = '';
  if (subdomains.length > 0) {
    subdomains.forEach(host => {
      const tag = document.createElement('div');
      tag.className = 'summary-domain-tag';
      tag.textContent = host;
      subdomainList.appendChild(tag);
    });
  } else {
    subdomainList.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">None</span>';
  }

  // Populate external domain list
  const externalList = document.getElementById('summaryExternalList');
  externalList.innerHTML = '';
  if (externalDomains.length > 0) {
    externalDomains.forEach(host => {
      const tag = document.createElement('div');
      tag.className = 'summary-domain-tag';
      tag.textContent = host;
      externalList.appendChild(tag);
    });
  } else {
    externalList.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">None</span>';
  }

  // Update title for final results
  document.getElementById('summaryTitle').textContent = '✅ Scan Complete';

  // Show modal with animation
  setTimeout(() => {
    document.getElementById('summaryOverlay').classList.add('show');
  }, 500); // Small delay after scan completes
}

function closeSummary() {
  document.getElementById('summaryOverlay').classList.remove('show');
}


function exportSummaryToHTML() {
  // Gather data
  const scanDate = new Date().toLocaleString();
  const totalEndpoints = document.getElementById('summaryEndpoints').textContent;
  const apiCount = document.getElementById('summaryApiCount').textContent;
  const pagesVisited = document.getElementById('summaryPages').textContent;
  const duration = document.getElementById('summaryDuration').textContent;
  const hostsCount = document.getElementById('summaryHosts').textContent;
  const breakdown = document.getElementById('summarySubdomains').textContent;

  // Get subdomain and external domain lists
  const subdomainList = document.getElementById('summarySubdomainList');
  const subdomainTags = Array.from(subdomainList.querySelectorAll('.summary-domain-tag'));
  const subdomains = subdomainTags.map(tag => tag.textContent);

  const externalList = document.getElementById('summaryExternalList');
  const externalTags = Array.from(externalList.querySelectorAll('.summary-domain-tag'));
  const externals = externalTags.map(tag => tag.textContent);

  // Group endpoints by API confidence (GET* = hardcoded in source, treat as confirmed)
  const apiEndpoints = endpoints.filter(ep => ep.api_confidence === 'API' || ep.method === 'GET*');
  const maybeApiEndpoints = endpoints.filter(ep => ep.api_confidence === 'Maybe API' && ep.method !== 'GET*');
  const otherEndpoints = endpoints.filter(ep => (!ep.api_confidence || ep.api_confidence === 'Not API') && ep.method !== 'GET*');

  // Generate HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Peekaboo API Discovery Report - ${targetDomain}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: linear-gradient(135deg, #0a0e17 0%, #1a1f2e 100%);
      color: #ffffff;
      padding: 2rem;
      line-height: 1.6;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: #13161f;
      border-radius: 16px;
      padding: 3rem;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }

    .header {
      text-align: center;
      margin-bottom: 3rem;
      padding: 2.5rem 2rem;
      background: linear-gradient(135deg, rgba(74, 29, 150, 0.15), rgba(0, 255, 136, 0.05));
      border-radius: 12px;
      border: 1px solid #2a2f3f;
    }

    .header .logo-container {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 2rem;
      width: 100%;
    }

    .header .salt-logo {
      height: 1.8rem;
      width: auto;
      color: #00ff88;
    }

    .header .report-title {
      font-size: 2rem;
      color: #ffffff;
      margin-bottom: 0.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .header .report-subtitle {
      font-size: 0.95rem;
      color: #8b92a7;
      margin-bottom: 2rem;
      font-weight: 500;
    }

    .header .target-info {
      display: inline-block;
      background: rgba(0, 255, 136, 0.1);
      border: 1px solid rgba(0, 255, 136, 0.3);
      border-radius: 8px;
      padding: 1rem 2rem;
      margin: 1rem 0;
    }

    .header .target-label {
      font-size: 0.75rem;
      color: #8b92a7;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .header .target {
      font-size: 1.5rem;
      color: #00ff88;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }

    .header .meta {
      color: #6b7280;
      font-size: 0.85rem;
      margin-top: 1.5rem;
      font-style: italic;
    }

    .section {
      margin-bottom: 2.5rem;
    }

    .section-title {
      font-size: 1.5rem;
      color: #00ff88;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 700;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: #1a1e2b;
      padding: 1.5rem;
      border-radius: 12px;
      border: 1px solid #2a2f3f;
      transition: transform 0.2s;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      border-color: #4a1d96;
    }

    .stat-label {
      color: #8b92a7;
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .stat-value {
      font-size: 1.8rem;
      font-weight: 700;
      color: #00ff88;
    }

    .stat-subtext {
      color: #8b92a7;
      font-size: 0.85rem;
      margin-top: 0.25rem;
    }

    .domain-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }

    .domain-tag {
      background: #1a1e2b;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      border: 1px solid #2a2f3f;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.9rem;
      color: #ffffff;
    }

    .domain-tag.subdomain {
      border-color: #4a1d96;
      background: linear-gradient(135deg, rgba(74, 29, 150, 0.1), rgba(74, 29, 150, 0.05));
    }

    .domain-tag.external {
      border-color: #f59e0b;
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(245, 158, 11, 0.05));
    }

    .table-container {
      overflow-x: auto;
      margin-top: 1rem;
      border-radius: 8px;
      border: 1px solid #2a2f3f;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }

    thead {
      background: #4a1d96;
      color: #ffffff;
      position: sticky;
      top: 0;
    }

    th {
      padding: 1rem;
      text-align: left;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.8rem;
      letter-spacing: 0.05em;
    }

    tbody tr {
      border-bottom: 1px solid #2a2f3f;
      transition: background 0.2s;
    }

    tbody tr:hover {
      background: #1a1e2b;
    }

    td {
      padding: 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
    }

    .method-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
    }

    .method-GET { background: #00ff88; color: #0a0e17; }
    .method-POST { background: #3b82f6; color: #ffffff; }
    .method-PUT { background: #f59e0b; color: #ffffff; }
    .method-PATCH { background: #8b5cf6; color: #ffffff; }
    .method-DELETE { background: #ef4444; color: #ffffff; }
    .method-default { background: #6b7280; color: #ffffff; }

    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-weight: 600;
      font-size: 0.75rem;
    }

    .status-2xx { background: #10b981; color: #ffffff; }
    .status-3xx { background: #3b82f6; color: #ffffff; }
    .status-4xx { background: #f59e0b; color: #ffffff; }
    .status-5xx { background: #ef4444; color: #ffffff; }

    .endpoint-path {
      color: #00ff88;
      word-break: break-all;
    }

    .endpoint-host {
      color: #8b92a7;
    }

    .empty-state {
      text-align: center;
      padding: 2rem;
      color: #8b92a7;
      font-style: italic;
    }

    .footer {
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 2px solid #2a2f3f;
      text-align: center;
      color: #8b92a7;
      font-size: 0.9rem;
    }

    .footer strong {
      color: #00ff88;
    }

    .contact-btn {
      display: inline-block;
      margin-top: 1.5rem;
      padding: 0.75rem 2rem;
      background: linear-gradient(135deg, #00ff88, #00cc6a);
      color: #0a0e17;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 700;
      font-size: 0.95rem;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 4px 12px rgba(0, 255, 136, 0.3);
    }

    .contact-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(0, 255, 136, 0.4);
    }

    .filter-controls {
      background: #1a1e2b;
      padding: 1.5rem;
      border-radius: 12px;
      border: 1px solid #2a2f3f;
      margin-bottom: 1.5rem;
    }

    .filter-row {
      display: flex;
      gap: 1rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      align-items: center;
    }

    .filter-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: #8b92a7;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      min-width: 80px;
    }

    .search-box {
      flex: 1;
      min-width: 300px;
      padding: 0.75rem 1rem;
      background: #13161f;
      border: 1px solid #2a2f3f;
      border-radius: 8px;
      color: #ffffff;
      font-size: 0.9rem;
      font-family: 'Inter', sans-serif;
    }

    .search-box:focus {
      outline: none;
      border-color: #00ff88;
      box-shadow: 0 0 0 3px rgba(0, 255, 136, 0.1);
    }

    .filter-buttons {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .filter-btn {
      padding: 0.5rem 1rem;
      background: #13161f;
      border: 1px solid #2a2f3f;
      border-radius: 6px;
      color: #ffffff;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      text-transform: uppercase;
    }

    .filter-btn:hover {
      border-color: #4a1d96;
      background: #1a1e2b;
    }

    .filter-btn.active {
      background: #00ff88;
      color: #0a0e17;
      border-color: #00ff88;
    }

    .filter-btn.clear {
      background: #ef4444;
      border-color: #ef4444;
      color: #ffffff;
    }

    .filter-btn.clear:hover {
      background: #dc2626;
      border-color: #dc2626;
    }

    .results-count {
      color: #8b92a7;
      font-size: 0.9rem;
      padding: 0.5rem 0;
    }

    .results-count strong {
      color: #00ff88;
    }

    .domain-search {
      margin-bottom: 1rem;
    }

    .screenshot-section {
      margin: 2rem 0;
      padding: 1.5rem;
      background: #1a1e2b;
      border-radius: 12px;
      border: 1px solid #2a2f3f;
    }

    .screenshot-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
      font-size: 1.1rem;
      font-weight: 600;
      color: #00ff88;
    }

    .screenshot-container {
      position: relative;
      width: 100%;
      max-width: 800px;
      margin: 0 auto;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      border: 2px solid #2a2f3f;
    }

    .screenshot-container img {
      width: 100%;
      height: auto;
      display: block;
    }

    .screenshot-caption {
      margin-top: 0.75rem;
      text-align: center;
      font-size: 0.85rem;
      color: #8b92a7;
      font-style: italic;
    }

    .carousel-container {
      position: relative;
      width: 100%;
      max-width: 900px;
      margin: 0 auto;
      overflow: hidden;
      border-radius: 12px;
      background: #1a1e2b;
    }

    .carousel-wrapper {
      position: relative;
      width: 100%;
      padding-bottom: 56.25%; /* 16:9 aspect ratio */
    }

    .carousel-slides {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      transition: transform 0.5s ease-in-out;
    }

    .carousel-slide {
      position: relative;
      min-width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #0a0e17;
    }

    .carousel-slide img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .carousel-slide-caption {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(transparent, rgba(0,0,0,0.95));
      padding: 2.5rem 1.5rem 1.5rem;
      color: #00ff88;
      font-size: 0.9rem;
      text-align: center;
      font-family: 'JetBrains Mono', monospace;
      word-break: break-all;
      font-weight: 500;
      text-shadow: 0 2px 4px rgba(0,0,0,0.5);
      border-top: 2px solid rgba(0, 255, 136, 0.3);
    }

    .carousel-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(74, 29, 150, 0.8);
      border: none;
      color: #ffffff;
      font-size: 1.5rem;
      width: 3rem;
      height: 3rem;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.3s;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .carousel-nav:hover {
      background: rgba(0, 255, 136, 0.9);
      color: #0a0e17;
      transform: translateY(-50%) scale(1.1);
    }

    .carousel-nav.prev {
      left: 1rem;
    }

    .carousel-nav.next {
      right: 1rem;
    }

    .carousel-dots {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
      margin-top: 1rem;
    }

    .carousel-dot {
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      background: #2a2f3f;
      border: 2px solid #4a1d96;
      cursor: pointer;
      transition: all 0.3s;
    }

    .carousel-dot.active {
      background: #00ff88;
      transform: scale(1.3);
    }

    .carousel-dot:hover {
      background: #6b2fc7;
      transform: scale(1.2);
    }

    .carousel-counter {
      text-align: center;
      margin-top: 0.5rem;
      color: #8b92a7;
      font-size: 0.85rem;
    }

    .cta-section {
      margin: 3rem 0;
      padding: 3rem 2rem;
      background: linear-gradient(135deg, rgba(74, 29, 150, 0.2), rgba(0, 255, 136, 0.1));
      border-radius: 16px;
      border: 2px solid #4a1d96;
      text-align: center;
    }

    .cta-title {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 1rem;
      background: linear-gradient(135deg, #00ff88, #4a1d96);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .cta-subtitle {
      font-size: 1.1rem;
      color: #8b92a7;
      margin-bottom: 2rem;
    }

    .cta-button {
      display: inline-block;
      padding: 1rem 2.5rem;
      background: linear-gradient(135deg, #00ff88, #00cc6a);
      color: #0a0e17;
      text-decoration: none;
      border-radius: 12px;
      font-weight: 700;
      font-size: 1.1rem;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 4px 16px rgba(0, 255, 136, 0.3);
    }

    .cta-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 255, 136, 0.5);
    }

    .hidden {
      display: none !important;
    }

    @media print {
      body { background: white; color: black; }
      .container { box-shadow: none; }
      .stat-card:hover { transform: none; }
      tbody tr:hover { background: transparent; }
      .filter-controls { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-container">
        <svg style="height:1.8rem;width:auto;" version="1.1" viewBox="0 0 152.63 40.25" xmlns="http://www.w3.org/2000/svg">
          <path d="m31.09 11.7c1.2316 0 2.23-0.9984 2.23-2.23s-0.9984-2.23-2.23-2.23-2.23 0.99844-2.23 2.23 0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m23.88 11.7c1.2315 0 2.23-0.9984 2.23-2.23s-0.9985-2.23-2.23-2.23c-1.2316 0-2.23 0.99844-2.23 2.23s0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m16.66 11.7c1.2316 0 2.23-0.9984 2.23-2.23s-0.9984-2.23-2.23-2.23-2.23 0.99844-2.23 2.23 0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m9.44 11.7c1.2316 0 2.23-0.9984 2.23-2.23s-0.9984-2.23-2.23-2.23-2.23 0.99844-2.23 2.23 0.99841 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m2.23 11.7c1.2316 0 2.23-0.9984 2.23-2.23s-0.99841-2.23-2.23-2.23c-1.2316 0-2.23 0.99844-2.23 2.23s0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m9.44 26.06c1.2316 0 2.23-0.9984 2.23-2.23 0-1.2315-0.9984-2.23-2.23-2.23s-2.23 0.9985-2.23 2.23c0 1.2316 0.99841 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m2.23 18.94c1.2316 0 2.23-0.9985 2.23-2.23 0-1.2316-0.99841-2.23-2.23-2.23-1.2316 0-2.23 0.9984-2.23 2.23 0 1.2315 0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m23.88 4.46c1.2315 0 2.23-0.9984 2.23-2.23 0-1.2316-0.9985-2.23-2.23-2.23-1.2316 0-2.23 0.99841-2.23 2.23 0 1.2316 0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m16.66 4.46c1.2316 0 2.23-0.9984 2.23-2.23 0-1.2316-0.9984-2.23-2.23-2.23s-2.23 0.99841-2.23 2.23c0 1.2316 0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m9.44 4.46c1.2316 0 2.23-0.9984 2.23-2.23 0-1.2316-0.9984-2.23-2.23-2.23s-2.23 0.99841-2.23 2.23c0 1.2316 0.99841 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m2.23 33.02c1.2316 0 2.23-0.9984 2.23-2.23s-0.99841-2.23-2.23-2.23c-1.2316 0-2.23 0.9984-2.23 2.23s0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m9.44 33.02c1.2316 0 2.23-0.9984 2.23-2.23s-0.9984-2.23-2.23-2.23-2.23 0.9984-2.23 2.23 0.99841 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m16.66 33.02c1.2316 0 2.23-0.9984 2.23-2.23s-0.9984-2.23-2.23-2.23-2.23 0.9984-2.23 2.23 0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m23.88 33.02c1.2315 0 2.23-0.9984 2.23-2.23s-0.9985-2.23-2.23-2.23c-1.2316 0-2.23 0.9984-2.23 2.23s0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m31.09 33.02c1.2316 0 2.23-0.9984 2.23-2.23s-0.9984-2.23-2.23-2.23-2.23 0.9984-2.23 2.23 0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m9.44 18.94c1.2316 0 2.23-0.9985 2.23-2.23 0-1.2316-0.9984-2.23-2.23-2.23s-2.23 0.9984-2.23 2.23c0 1.2315 0.99841 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m23.88 26.06c1.2315 0 2.23-0.9984 2.23-2.23 0-1.2315-0.9985-2.23-2.23-2.23-1.2316 0-2.23 0.9985-2.23 2.23 0 1.2316 0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m23.88 18.94c1.2315 0 2.23-0.9985 2.23-2.23 0-1.2316-0.9985-2.23-2.23-2.23-1.2316 0-2.23 0.9984-2.23 2.23 0 1.2315 0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m31.09 26.06c1.2316 0 2.23-0.9984 2.23-2.23 0-1.2315-0.9984-2.23-2.23-2.23s-2.23 0.9985-2.23 2.23c0 1.2316 0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m9.44 40.25c1.2316 0 2.23-0.9985 2.23-2.23 0-1.2316-0.9984-2.2301-2.23-2.2301s-2.23 0.9985-2.23 2.2301c0 1.2315 0.99841 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m16.66 40.25c1.2316 0 2.23-0.9985 2.23-2.23 0-1.2316-0.9984-2.2301-2.23-2.2301s-2.23 0.9985-2.23 2.2301c0 1.2315 0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m23.88 40.25c1.2315 0 2.23-0.9985 2.23-2.23 0-1.2316-0.9985-2.2301-2.23-2.2301-1.2316 0-2.23 0.9985-2.23 2.2301 0 1.2315 0.9984 2.23 2.23 2.23z" fill="currentColor"></path>
          <path d="m67.28 18.85-7.33-1.1c-3.31-0.53-4.41-2.34-4.41-4.63 0-3.27 2.21-5.52 7.41-5.52 5.52 0 7.99 2.69 8.38 6.66h3.53c-0.4-5.65-4.19-9.53-11.87-9.53s-11.16 3.75-11.16 8.47c0 4.41 2.34 6.93 7.46 7.68l6.93 1.06c3.71 0.62 5.34 2.16 5.34 5.25 0 3.4-1.85 5.47-7.9 5.47-6.8 0-9.13-3.31-9.22-7.86h-3.57c0 5.78 3.27 10.72 12.8 10.72 8.16 0 11.61-3.22 11.61-8.83 0-4.72-2.78-7.02-7.99-7.86z" fill="#fff"></path>
          <path d="m89.69 5.52-11.12 29.35h3.66l2.85-7.45h10.48c1.65 0 2.99-1.33 3-2.98l3.97 10.44h3.71l-11.12-29.35h-5.43zm-3.49 18.89 6.18-16.24 6.17 16.24z" fill="#fff"></path>
          <path d="m115.53 5.52h-3.66v29.35h19.02v-2.96h-15.36z" fill="#fff"></path>
          <path d="m127.96 5.52v2.95h24.67v-2.95z" fill="#fff"></path>
          <path d="m142.14 34.86v-22.78c0-2-1.62-3.61-3.61-3.61v26.39z" fill="#fff"></path>
        </svg>
      </div>

      <div class="report-title">👀 Peekaboo API Discovery Report</div>
      <div class="report-subtitle">Revealing Hidden APIs in Plain Sight</div>

      <div class="target-info">
        <div class="target-label">Target Domain</div>
        <div class="target">${targetDomain}</div>
      </div>

      <div class="meta">Generated on ${scanDate}</div>
    </div>

    ${capturedScreenshots.length > 0 ? `
    <div class="screenshot-section">
      <div class="screenshot-header" style="cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;" onclick="toggleScreenshots()">
        <span>📸 Application Screenshots (${capturedScreenshots.length})</span>
        <span id="screenshotToggleIcon" style="font-size:1.2rem;transition:transform 0.3s ease;">▼</span>
      </div>
      <div id="screenshotCarouselContent">
      <div class="carousel-container">
        <div class="carousel-wrapper">
          <div class="carousel-slides" id="carouselSlides">
            ${capturedScreenshots.map((screenshot, index) => `
              <div class="carousel-slide">
                <img src="data:image/jpeg;base64,${screenshot.image}" alt="Screenshot ${index + 1} of ${targetDomain}">
                <div class="carousel-slide-caption">
                  <div style="font-size: 0.75rem; color: #8b92a7; margin-bottom: 0.3rem; text-transform: uppercase; letter-spacing: 0.05em;">Source URL</div>
                  ${screenshot.url}
                </div>
              </div>
            `).join('')}
          </div>
          ${capturedScreenshots.length > 1 ? `
            <button class="carousel-nav prev" onclick="moveCarousel(-1)" aria-label="Previous">‹</button>
            <button class="carousel-nav next" onclick="moveCarousel(1)" aria-label="Next">›</button>
          ` : ''}
        </div>
      </div>
      ${capturedScreenshots.length > 1 ? `
        <div class="carousel-dots" id="carouselDots">
          ${capturedScreenshots.map((_, index) => `
            <div class="carousel-dot ${index === 0 ? 'active' : ''}" onclick="goToSlide(${index})"></div>
          `).join('')}
        </div>
        <div class="carousel-counter">
          <span id="currentSlide">1</span> of ${capturedScreenshots.length}
        </div>
      ` : ''}
      </div>
    </div>
    ` : ''}

    <div class="section">
      <div class="section-title">📊 Scan Summary</div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Endpoints</div>
          <div class="stat-value">${totalEndpoints}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">API Endpoints</div>
          <div class="stat-value">${apiEndpoints.length}</div>
          <div class="stat-subtext">${apiCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Pages Visited</div>
          <div class="stat-value">${pagesVisited}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Duration</div>
          <div class="stat-value">${duration}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Hosts Discovered</div>
          <div class="stat-value">${hostsCount}</div>
          <div class="stat-subtext">${breakdown}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">🏠 Target & Subdomains (<span id="subdomainCount">${subdomains.length}</span>)</div>
      ${subdomains.length > 0 ? `
        <div class="domain-search">
          <input type="text" class="search-box" id="subdomainSearch" placeholder="Search subdomains..." onkeyup="filterDomains('subdomain')">
        </div>
        <div class="domain-grid" id="subdomainGrid">
          ${subdomains.map(domain => `<div class="domain-tag subdomain" data-domain="${domain.toLowerCase()}">${domain}</div>`).join('')}
        </div>
      ` : '<div class="empty-state">No subdomains discovered</div>'}
    </div>

    <div class="section">
      <div class="section-title">🌐 External Domains (<span id="externalCount">${externals.length}</span>)</div>
      ${externals.length > 0 ? `
        <div class="domain-search">
          <input type="text" class="search-box" id="externalSearch" placeholder="Search external domains..." onkeyup="filterDomains('external')">
        </div>
        <div class="domain-grid" id="externalGrid">
          ${externals.map((domain, index) => `<div class="domain-tag external" data-domain="${domain.toLowerCase()}" style="${index >= 5 ? 'display:none;' : ''}">${domain}</div>`).join('')}
        </div>
        ${externals.length > 5 ? `
          <div style="text-align:center;margin-top:1rem;">
            <button onclick="toggleExternalDomains()" id="showMoreExternalBtn" style="padding:0.5rem 1.5rem;background:rgba(139,146,167,0.1);border:1px solid rgba(139,146,167,0.3);border-radius:6px;color:#8b92a7;cursor:pointer;font-size:0.85rem;font-weight:500;">
              Show ${externals.length - 5} more
            </button>
          </div>
        ` : ''}
      ` : '<div class="empty-state">No external domains discovered</div>'}
    </div>

    ${detectedTechnologies ? `
    <div class="section">
      <div class="section-title">🔧 Detected Technologies</div>

      ${(() => {
        const tech = detectedTechnologies;
        const hasServerTech = Object.keys(tech.server_technologies || {}).length > 0;
        const hasWebServers = Object.keys(tech.web_servers || {}).length > 0;
        const hasCdns = Object.keys(tech.cdns || {}).length > 0;
        const hasFrameworks = Object.keys(tech.frameworks || {}).length > 0;
        const hasOther = Object.keys(tech.other_technologies || {}).length > 0;

        if (!hasServerTech && !hasWebServers && !hasCdns && !hasFrameworks && !hasOther) {
          return '<div class="empty-state">No technologies detected</div>';
        }

        let html = '';

        // Server-Side Technologies
        if (hasServerTech) {
          html += `
          <div style="margin-bottom:2rem;">
            <h3 style="font-size:1.1rem;color:#00ff88;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem;">
              <span>💻</span> Server-Side Languages
            </h3>
            <div class="stats-grid">
              ${Object.entries(tech.server_technologies).map(([name, data]) => `
                <div class="stat-card">
                  <div class="stat-label">${name}</div>
                  <div class="stat-value">${data.count}</div>
                  ${data.versions && data.versions.length > 0 ?
                    `<div class="stat-subtext">v${data.versions.join(', v')}</div>` :
                    '<div class="stat-subtext">Version unknown</div>'
                  }
                </div>
              `).join('')}
            </div>
          </div>`;
        }

        // Web Servers
        if (hasWebServers) {
          html += `
          <div style="margin-bottom:2rem;">
            <h3 style="font-size:1.1rem;color:#00ff88;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem;">
              <span>🌐</span> Web Servers
            </h3>
            <div class="stats-grid">
              ${Object.entries(tech.web_servers).map(([name, data]) => `
                <div class="stat-card">
                  <div class="stat-label">${name}</div>
                  <div class="stat-value">${data.count}</div>
                  ${data.versions && data.versions.length > 0 ?
                    `<div class="stat-subtext">v${data.versions.join(', v')}</div>` :
                    '<div class="stat-subtext">Version unknown</div>'
                  }
                </div>
              `).join('')}
            </div>
          </div>`;
        }

        // CDNs
        if (hasCdns) {
          html += `
          <div style="margin-bottom:2rem;">
            <h3 style="font-size:1.1rem;color:#00ff88;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem;">
              <span>⚡</span> Content Delivery Networks
            </h3>
            <div class="stats-grid">
              ${Object.entries(tech.cdns).map(([name, data]) => `
                <div class="stat-card">
                  <div class="stat-label">${name}</div>
                  <div class="stat-value">${data.count}</div>
                  <div class="stat-subtext">${data.count === 1 ? 'endpoint' : 'endpoints'}</div>
                </div>
              `).join('')}
            </div>
          </div>`;
        }

        // Frameworks
        if (hasFrameworks) {
          html += `
          <div style="margin-bottom:2rem;">
            <h3 style="font-size:1.1rem;color:#00ff88;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem;">
              <span>🏗️</span> Frameworks & Libraries
            </h3>
            <div class="stats-grid">
              ${Object.entries(tech.frameworks).map(([name, data]) => `
                <div class="stat-card">
                  <div class="stat-label">${name}</div>
                  <div class="stat-value">${data.count}</div>
                  <div class="stat-subtext">${data.count === 1 ? 'endpoint' : 'endpoints'}</div>
                </div>
              `).join('')}
            </div>
          </div>`;
        }

        // Other Technologies
        if (hasOther) {
          html += `
          <div style="margin-bottom:1rem;">
            <h3 style="font-size:1.1rem;color:#00ff88;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem;">
              <span>⚙️</span> Other Technologies
            </h3>
            <div class="stats-grid">
              ${Object.entries(tech.other_technologies).map(([name, data]) => `
                <div class="stat-card">
                  <div class="stat-label">${name}</div>
                  <div class="stat-value">${data.count}</div>
                  ${data.versions && data.versions.length > 0 ?
                    `<div class="stat-subtext">v${data.versions.join(', v')}</div>` :
                    '<div class="stat-subtext">' + (data.count === 1 ? 'endpoint' : 'endpoints') + '</div>'
                  }
                </div>
              `).join('')}
            </div>
          </div>`;
        }

        return html;
      })()}
    </div>
    ` : ''}

    ${(() => {
      // Filter to only show domain/subdomain endpoints
      const domainEndpoints = apiEndpoints.filter(ep => {
        const host = (ep.host || '').toLowerCase();
        return host === targetDomain || host.endsWith('.' + targetDomain);
      });

      // Limit to 5 endpoints
      const previewEndpoints = domainEndpoints.slice(0, 5);
      const hasMore = domainEndpoints.length > 5;

      return previewEndpoints.length > 0 ? `
    <div class="section">
      <div class="section-title">✅ Confirmed API Endpoints (Showing ${previewEndpoints.length} of ${domainEndpoints.length})</div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th>Host</th>
              <th>Path</th>
              <th>Status</th>
              <th>Detection</th>
            </tr>
          </thead>
          <tbody>
            ${previewEndpoints.map(ep => {
              const statusClass = ep.response_status ?
                'status-' + Math.floor(ep.response_status / 100) + 'xx' : '';
              const methodClass = 'method-' + (ep.method || 'default').replace('*', '');
              return `
                <tr>
                  <td><span class="method-badge ${methodClass}">${ep.method}</span></td>
                  <td class="endpoint-host">${ep.host}</td>
                  <td class="endpoint-path">${ep.path}</td>
                  <td>${ep.response_status ?
                    '<span class="status-badge ' + statusClass + '">' + ep.response_status + '</span>' :
                    'N/A'}</td>
                  <td>${ep.detection_reason || 'N/A'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      ${hasMore ? `
      <div class="cta-section">
        <div class="cta-title">🔍 Wanna See More?</div>
        <div class="cta-subtitle">
          This report shows a preview of ${previewEndpoints.length} API endpoints.<br>
          ${domainEndpoints.length - previewEndpoints.length} more endpoints discovered for ${targetDomain}
        </div>
        <a href="https://salt.security/contact-us" target="_blank" class="cta-button">
          📧 Contact Salt Security
        </a>
      </div>
      ` : ''}
    </div>
      ` : '';
    })()}

    ${maybeApiEndpoints.length > 0 ? `
    <div class="section">
      <div class="section-title">⚠️ Potential API Endpoints (<span id="maybeCount">${maybeApiEndpoints.length}</span>)</div>

      <div class="filter-controls">
        <div class="filter-row">
          <div class="filter-label">Search:</div>
          <input type="text" class="search-box" id="maybeSearch" placeholder="Search by host, path, or method..." onkeyup="filterEndpoints('maybe')">
        </div>

        <div class="filter-row">
          <div class="filter-label">Method:</div>
          <div class="filter-buttons">
            <button class="filter-btn" onclick="toggleMethodFilter('maybe', 'GET')">GET</button>
            <button class="filter-btn" onclick="toggleMethodFilter('maybe', 'POST')">POST</button>
            <button class="filter-btn" onclick="toggleMethodFilter('maybe', 'PUT')">PUT</button>
            <button class="filter-btn" onclick="toggleMethodFilter('maybe', 'PATCH')">PATCH</button>
            <button class="filter-btn" onclick="toggleMethodFilter('maybe', 'DELETE')">DELETE</button>
          </div>
        </div>

        <div class="filter-row">
          <button class="filter-btn clear" onclick="clearFilters('maybe')">Clear All Filters</button>
        </div>

        <div class="results-count" id="maybeResults">Showing <strong>${maybeApiEndpoints.length}</strong> of ${maybeApiEndpoints.length} endpoints</div>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th>Host</th>
              <th>Path</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="maybeTableBody">
            ${maybeApiEndpoints.map(ep => {
              const statusClass = ep.response_status ?
                'status-' + Math.floor(ep.response_status / 100) + 'xx' : '';
              const methodClass = 'method-' + (ep.method || 'default').replace('*', '');
              const statusPrefix = ep.response_status ? Math.floor(ep.response_status / 100).toString() : '';
              return `
                <tr class="endpoint-row"
                    data-method="${(ep.method || '').toUpperCase()}"
                    data-host="${(ep.host || '').toLowerCase()}"
                    data-path="${(ep.path || '').toLowerCase()}"
                    data-status="${statusPrefix}"
                    data-search="${(ep.method + ' ' + ep.host + ' ' + ep.path).toLowerCase()}">
                  <td><span class="method-badge ${methodClass}">${ep.method}</span></td>
                  <td class="endpoint-host">${ep.host}</td>
                  <td class="endpoint-path">${ep.path}</td>
                  <td>${ep.response_status ?
                    '<span class="status-badge ' + statusClass + '">' + ep.response_status + '</span>' :
                    'N/A'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

    ${(() => {
      if (!subdomainResults) return '';
      const subs = Array.isArray(subdomainResults) ? subdomainResults : (subdomainResults.subdomains || subdomainResults.results || []);
      if (subs.length === 0) return '';
      const liveCount = subs.filter(s => s.status_code && s.status_code >= 200 && s.status_code < 400).length;
      return `
    <div class="section">
      <div class="section-title">🌐 Subdomain Discovery (${subs.length} found, ${liveCount} live)</div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Subdomain</th>
              <th>Status</th>
              <th>Title</th>
              <th>Technologies</th>
              <th>Screenshot</th>
            </tr>
          </thead>
          <tbody>
            ${subs.map((sub, i) => {
              const name = sub.subdomain || sub.domain || sub.host || '—';
              const status = sub.status_code || sub.status || 0;
              const title = sub.title || '—';
              const server = sub.web_server || sub.server || '—';
              const screenshot = sub.screenshot || '';
              const techs = sub.technologies || [];
              const statusClass = status >= 200 && status < 300 ? 'status-2xx' :
                status >= 300 && status < 400 ? 'status-3xx' :
                status >= 400 && status < 500 ? 'status-4xx' :
                status >= 500 ? 'status-5xx' : '';
              const thumbHtml = screenshot && screenshot.length > 100
                ? '<img src="data:image/jpeg;base64,' + screenshot + '" style="width:120px;height:68px;object-fit:cover;border-radius:4px;border:1px solid #2a2f3f;">'
                : '<span style="color:#8b92a7;">—</span>';
              const techHtml = techs.length > 0
                ? '<div style="display:flex;flex-wrap:wrap;gap:0.25rem;">' + techs.map(t => '<span style="display:inline-block;padding:0.15rem 0.5rem;background:rgba(0,255,136,0.08);border:1px solid rgba(0,255,136,0.3);border-radius:4px;font-size:0.7rem;color:#5eead4;white-space:nowrap;line-height:1.4;">' + t + '</span>').join('') + '</div>'
                : '<span style="color:#8b92a7;">—</span>';
              // Read crawled URLs from the DOM if they were fetched
              const listEl = document.getElementById('crawled-list-' + i);
              const domUrls = listEl ? Array.from(listEl.querySelectorAll('.crawled-url-item a')).map(a => a.href) : [];
              const urlsSuffix = domUrls.length > 0
                ? ' <span style="color:#a78bfa;font-size:0.75rem;font-weight:600;">(' + domUrls.length + ' URLs)</span>'
                : '';
              return '<tr>' +
                '<td>' + (i + 1) + '</td>' +
                '<td style="color:#00ff88;font-family:JetBrains Mono,monospace;font-size:0.85rem;">' + name + urlsSuffix + '</td>' +
                '<td>' + (status ? '<span class="status-badge ' + statusClass + '">' + status + '</span>' : '—') + '</td>' +
                '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + title + '</td>' +
                '<td>' + techHtml + '</td>' +
                '<td>' + thumbHtml + '</td>' +
                '</tr>' +
                (domUrls.length > 0 ? '<tr><td colspan="6" style="padding:0;"><details style="cursor:pointer;padding:0.3rem 1rem 0.3rem 3rem;background:rgba(0,0,0,0.15);"><summary style="color:#a78bfa;font-size:0.75rem;font-weight:600;">' + domUrls.length + ' crawled URLs</summary><div style="max-height:150px;overflow-y:auto;margin-top:0.3rem;padding:0.3rem;background:rgba(0,0,0,0.2);border-radius:4px;">' + domUrls.map(u => { let d = u; try { const p = new URL(u); d = p.pathname + p.search; if (d.length > 90) d = d.slice(0,80) + '…'; } catch {} return '<div style="font-family:JetBrains Mono,monospace;font-size:0.7rem;padding:0.15rem 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><a href="' + u + '" target="_blank" style="color:#8b92a7;text-decoration:none;">' + d + '</a></div>'; }).join('') + '</div></details></td></tr>' : '');
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
    })()}

    <div class="footer">
      <p>Generated by <strong>Peekaboo</strong> - Visual API Discovery Scanner</p>
      <p>🔐 <strong>Salt Security</strong> • ${scanDate}</p>
      <p style="margin-top: 0.5rem; font-size: 0.85rem;">Protecting Modern Applications from API Attacks</p>
      <a href="https://salt.security/contact-us" target="_blank" class="contact-btn">
        📧 Contact Salt Security
      </a>
      <p style="margin-top: 1rem; font-size: 0.8rem;">
        Learn how Salt Security can help protect your digital assets
      </p>
    </div>
  </div>

  <script>
    // Filter state
    const filterState = {
      api: { methods: new Set(), statuses: new Set(), search: '' },
      maybe: { methods: new Set(), statuses: new Set(), search: '' }
    };

    // Filter domains
    function filterDomains(type) {
      const searchId = type === 'subdomain' ? 'subdomainSearch' : 'externalSearch';
      const gridId = type === 'subdomain' ? 'subdomainGrid' : 'externalGrid';
      const countId = type === 'subdomain' ? 'subdomainCount' : 'externalCount';

      const searchTerm = document.getElementById(searchId).value.toLowerCase();
      const grid = document.getElementById(gridId);
      const tags = grid.querySelectorAll('.domain-tag');

      let visibleCount = 0;
      tags.forEach(tag => {
        const domain = tag.getAttribute('data-domain');
        if (domain.includes(searchTerm)) {
          tag.classList.remove('hidden');
          visibleCount++;
        } else {
          tag.classList.add('hidden');
        }
      });

      document.getElementById(countId).textContent = visibleCount;
    }

    // Toggle method filter
    function toggleMethodFilter(type, method) {
      const btn = event.target;
      btn.classList.toggle('active');

      if (filterState[type].methods.has(method)) {
        filterState[type].methods.delete(method);
      } else {
        filterState[type].methods.add(method);
      }

      filterEndpoints(type);
    }

    // Toggle status filter
    function toggleStatusFilter(type, status) {
      const btn = event.target;
      btn.classList.toggle('active');

      if (filterState[type].statuses.has(status)) {
        filterState[type].statuses.delete(status);
      } else {
        filterState[type].statuses.add(status);
      }

      filterEndpoints(type);
    }

    // Filter endpoints
    function filterEndpoints(type) {
      const searchId = type === 'api' ? 'apiSearch' : 'maybeSearch';
      const tableId = type === 'api' ? 'apiTableBody' : 'maybeTableBody';
      const resultsId = type === 'api' ? 'apiResults' : 'maybeResults';
      const countId = type === 'api' ? 'apiCount' : 'maybeCount';

      const searchTerm = document.getElementById(searchId).value.toLowerCase();
      filterState[type].search = searchTerm;

      const tbody = document.getElementById(tableId);
      const rows = tbody.querySelectorAll('.endpoint-row');
      const totalRows = rows.length;

      let visibleCount = 0;
      rows.forEach(row => {
        const method = row.getAttribute('data-method');
        const status = row.getAttribute('data-status');
        const searchText = row.getAttribute('data-search');

        // Check method filter
        const methodMatch = filterState[type].methods.size === 0 ||
                           filterState[type].methods.has(method);

        // Check status filter
        const statusMatch = filterState[type].statuses.size === 0 ||
                           filterState[type].statuses.has(status);

        // Check search
        const searchMatch = searchTerm === '' || searchText.includes(searchTerm);

        if (methodMatch && statusMatch && searchMatch) {
          row.classList.remove('hidden');
          visibleCount++;
        } else {
          row.classList.add('hidden');
        }
      });

      document.getElementById(countId).textContent = visibleCount;
      document.getElementById(resultsId).innerHTML =
        'Showing <strong>' + visibleCount + '</strong> of ' + totalRows + ' endpoints';
    }

    // Clear all filters
    function clearFilters(type) {
      // Clear filter state
      filterState[type].methods.clear();
      filterState[type].statuses.clear();
      filterState[type].search = '';

      // Clear search box
      const searchId = type === 'api' ? 'apiSearch' : 'maybeSearch';
      document.getElementById(searchId).value = '';

      // Remove active class from all filter buttons in this section
      const section = document.getElementById(type === 'api' ? 'apiTableBody' : 'maybeTableBody')
                             .closest('.section');
      section.querySelectorAll('.filter-btn.active').forEach(btn => {
        btn.classList.remove('active');
      });

      // Re-filter to show all
      filterEndpoints(type);
    }

    // Carousel functionality
    let currentSlideIndex = 0;

    function moveCarousel(direction) {
      const slides = document.getElementById('carouselSlides');
      const totalSlides = slides.children.length;

      currentSlideIndex += direction;

      if (currentSlideIndex < 0) {
        currentSlideIndex = totalSlides - 1;
      } else if (currentSlideIndex >= totalSlides) {
        currentSlideIndex = 0;
      }

      updateCarousel();
    }

    function goToSlide(index) {
      currentSlideIndex = index;
      updateCarousel();
    }

    function updateCarousel() {
      const slides = document.getElementById('carouselSlides');
      const dots = document.querySelectorAll('.carousel-dot');
      const counter = document.getElementById('currentSlide');

      // Move slides
      slides.style.transform = 'translateX(-' + (currentSlideIndex * 100) + '%)';

      // Update dots
      dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === currentSlideIndex);
      });

      // Update counter
      if (counter) {
        counter.textContent = currentSlideIndex + 1;
      }
    }

    // Toggle screenshot carousel visibility
    let screenshotsCollapsed = false;
    function toggleScreenshots() {
      const content = document.getElementById('screenshotCarouselContent');
      const icon = document.getElementById('screenshotToggleIcon');

      screenshotsCollapsed = !screenshotsCollapsed;

      if (content) {
        content.style.display = screenshotsCollapsed ? 'none' : 'block';
      }

      if (icon) {
        icon.style.transform = screenshotsCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
        icon.textContent = screenshotsCollapsed ? '▶' : '▼';
      }
    }

    // Toggle external domains visibility
    let externalDomainsExpanded = false;
    function toggleExternalDomains() {
      const grid = document.getElementById('externalGrid');
      const btn = document.getElementById('showMoreExternalBtn');
      const allTags = Array.from(grid.querySelectorAll('.domain-tag.external'));
      const totalCount = allTags.length;

      externalDomainsExpanded = !externalDomainsExpanded;

      allTags.forEach((tag, index) => {
        if (index >= 5) {
          tag.style.display = externalDomainsExpanded ? 'inline-block' : 'none';
        }
      });

      if (btn) {
        btn.textContent = externalDomainsExpanded ? 'Show less' : \`Show \${totalCount - 5} more\`;
      }
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') moveCarousel(-1);
      if (e.key === 'ArrowRight') moveCarousel(1);
    });
  </scr` + `ipt>
</body>
</html>`;

  // Create and download the HTML file
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `peekaboo-report-${targetDomain}-${new Date().toISOString().split('T')[0]}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function startNewScan() {
  closeSummary();
  newScan();
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

function showCurrentFindings() {
  // Calculate current duration
  const duration = scanStartTime ? Math.round((Date.now() - scanStartTime) / 1000) : 0;
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const durationText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  // Calculate current rate
  const currentPages = parseInt(document.getElementById('statPages').textContent) || 0;
  const pagesPerMin = minutes > 0 ? Math.round(currentPages / (duration / 60)) : 0;

  // Count API endpoints so far
  const apiCount = endpoints.filter(ep => ep.api_confidence === 'API').length;

  // Count subdomains
  const hostArray = Array.from(hosts);
  const subdomainCount = hostArray.filter(h => h !== targetDomain && h.endsWith(`.${targetDomain}`)).length;

  // Get current queue size
  const queueSize = parseInt(document.getElementById('statQueue').textContent) || 0;

  // Update modal content with current stats
  document.getElementById('summaryEndpoints').textContent = endpoints.length;
  document.getElementById('summaryApiCount').textContent = `${apiCount} confirmed APIs`;
  document.getElementById('summaryPages').textContent = currentPages;
  document.getElementById('summarySkipped').textContent = queueSize > 0 ? `${queueSize} in queue` : '';
  document.getElementById('summaryDuration').textContent = `${durationText} (ongoing)`;
  document.getElementById('summaryRate').textContent = pagesPerMin > 0 ? `${pagesPerMin} pages/min` : '';
  // Count external domains
  const externalCount = hostArray.filter(h => h !== targetDomain && !h.endsWith(`.${targetDomain}`)).length;

  document.getElementById('summaryHosts').textContent = hosts.size;
  document.getElementById('summarySubdomains').textContent = `${subdomainCount} subdomains, ${externalCount} external`;

  // Separate subdomains from external domains
  const subdomains = [];
  const externalDomains = [];
  const sortedHosts = hostArray.sort();

  sortedHosts.forEach(host => {
    if (host === targetDomain || host.endsWith(`.${targetDomain}`)) {
      subdomains.push(host);
    } else {
      externalDomains.push(host);
    }
  });

  // Populate subdomain list
  const subdomainList = document.getElementById('summarySubdomainList');
  subdomainList.innerHTML = '';
  if (subdomains.length > 0) {
    subdomains.forEach(host => {
      const tag = document.createElement('div');
      tag.className = 'summary-domain-tag';
      tag.textContent = host;
      subdomainList.appendChild(tag);
    });
  } else {
    subdomainList.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">None</span>';
  }

  // Populate external domain list
  const externalList = document.getElementById('summaryExternalList');
  externalList.innerHTML = '';
  if (externalDomains.length > 0) {
    externalDomains.forEach(host => {
      const tag = document.createElement('div');
      tag.className = 'summary-domain-tag';
      tag.textContent = host;
      externalList.appendChild(tag);
    });
  } else {
    externalList.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">None</span>';
  }

  // Update title for interim findings
  document.getElementById('summaryTitle').textContent = '📊 Current Findings';

  // Show modal immediately
  document.getElementById('summaryOverlay').classList.add('show');
}

async function generateDescription(method, path, host, responseStatus) {
  const drawer = document.getElementById('detailDrawer');
  const resultDiv = document.getElementById('apiDescriptionResult');
  const btn = event.target;

  // Get full endpoint data from drawer
  const epData = JSON.parse(drawer.dataset.endpoint);

  // Show loading state
  btn.disabled = true;
  btn.textContent = '⏳ Generating...';
  btn.style.opacity = '0.6';
  resultDiv.innerHTML = `
    <div class="api-description-loading">
      <div class="spinner"></div>
      <div class="loading-text">Generating API Description</div>
      <div class="loading-subtext">Analyzing request and response patterns...</div>
    </div>
  `;

  try {
    // Call the generate-description API
    const response = await fetch('/api/generate-description', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: epData.method,
        path: epData.path,
        host: epData.host,
        request_body: epData.request_body,
        response_body: epData.response_body,
        response_status: epData.response_status,
        query_params: epData.query_params || []
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    // Store the description in the endpoint object
    epData.llm_description = result;

    // Update the endpoint in the global list
    const idx = endpoints.findIndex(e =>
      e.method === epData.method &&
      e.host === epData.host &&
      e.path === epData.path
    );
    if (idx !== -1) {
      endpoints[idx].llm_description = result;
    }

    // Display the result
    resultDiv.innerHTML = `
      <div class="api-description-section">
        <div class="api-description-header" onclick="toggleDescription()">
          <h4>📋 API Description</h4>
          <button class="collapse-toggle" id="collapseToggle">▼</button>
        </div>
        <div class="api-description-content" id="apiDescriptionContent">
          ${formatAPIDescription(result)}
        </div>
      </div>
    `;

    // Hide the button after successful generation
    btn.style.display = 'none';

  } catch (error) {
    console.error('Failed to generate description:', error);
    resultDiv.innerHTML = `
      <div class="api-description-error">
        ❌ Failed to generate description: ${escHtml(error.message)}
        <br><br>
        <small>Please check your AWS configuration and ensure Bedrock is enabled.</small>
      </div>
    `;
    btn.disabled = false;
    btn.textContent = '📋 Generate API Description';
  }
}

function formatAPIDescription(data) {
  if (!data) return '';

  // If data is a string, try to parse it as JSON
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      // If parsing fails, display as raw text with better formatting
      return `<pre style="white-space: pre-wrap; word-wrap: break-word; font-size: 0.85rem;">${escHtml(data)}</pre>`;
    }
  }

  if (data.error) {
    return `<p class="api-description-error">Error: ${escHtml(data.error)}</p>`;
  }

  if (data.raw_response) {
    return `<p>${escHtml(data.raw_response)}</p>`;
  }

  let html = '';

  // New condensed format
  if (data.summary) {
    html += `<p style="font-size: 0.95rem; line-height: 1.5;"><strong>${escHtml(data.summary)}</strong></p>`;
  }

  if (data.parameters && data.parameters.length > 0) {
    html += '<div style="margin-top: 0.75rem;"><strong style="font-size: 0.85rem;">Parameters:</strong><ul style="margin: 0.25rem 0 0 1.25rem;">';
    data.parameters.forEach(param => {
      html += `<li style="margin-bottom: 0.25rem;"><code style="background: var(--surface); padding: 0.15rem 0.4rem; border-radius: 3px;">${escHtml(param.name)}</code>`;
      if (param.type) html += ` <span style="color: var(--muted); font-size: 0.85rem;">${escHtml(param.type)}</span>`;
      if (param.description) html += ` - ${escHtml(param.description)}`;
      html += '</li>';
    });
    html += '</ul></div>';
  }

  if (data.returns) {
    html += `<p style="margin-top: 0.75rem;"><strong style="font-size: 0.85rem;">Returns:</strong> ${escHtml(data.returns)}</p>`;
  }

  if (data.notes) {
    html += `<p style="margin-top: 0.75rem; font-size: 0.85rem; color: var(--muted); font-style: italic;">${escHtml(data.notes)}</p>`;
  }

  // Fallback to old verbose format if new format not present
  if (!html && data.description) {
    html += `<p><strong>Description:</strong> ${escHtml(data.description)}</p>`;
    if (data.purpose) {
      html += `<p><strong>Purpose:</strong> ${escHtml(data.purpose)}</p>`;
    }
  }

  return html || '<p>No description available</p>';
}
