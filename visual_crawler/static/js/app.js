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
let capturedScreenshots = []; // Store up to 5 screenshots for report carousel

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

function startScan(event) {
  event.preventDefault();

  const domain = document.getElementById('domain').value.trim();
  if (!domain) {
    alert('Please enter a domain name');
    return;
  }

  // Track scan start time
  scanStartTime = Date.now();

  const apiFilter = document.querySelector('input[name="apiFilter"]:checked').value;

  const params = {
    domain: domain,
    max_pages: parseInt(document.getElementById('maxPages').value) || 50,
    max_depth: parseInt(document.getElementById('maxDepth').value) || 3,
    timeout: parseInt(document.getElementById('timeout').value) || 30000,
    include_subdomains: document.getElementById('includeSubdomains').checked,
    api_filter: apiFilter,
    concurrent_pages: parseInt(document.getElementById('concurrentPages').value) || 5,
    fast_mode: document.getElementById('fastMode').checked
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

  // Connect WebSocket and send params
  ws = new WebSocket(`ws://${location.host}/ws`);

  ws.onopen = () => {
    document.getElementById('statusText').textContent = 'Starting scan...';
    addLog('🚀', `Connected. Starting scan of ${params.domain}...`, 'page');
    ws.send(JSON.stringify(params));
  };

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
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    addLog('⚠️', 'Connection error', 'error');
  };
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
    document.getElementById('statEndpoints').textContent = endpoints.length;
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
  if (ws) {
    ws.close();
    ws = null;
  }
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
  scanStartTime = null; // Reset scan timer
  capturedScreenshots = []; // Clear screenshots

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
  document.getElementById('statEndpoints').textContent = '0';
  document.getElementById('statPages').textContent = '0';
  document.getElementById('statHosts').textContent = '0';
  document.getElementById('statQueue').textContent = '0';
  document.getElementById('screenshotBox').innerHTML = `
    <div class="placeholder">
      <div class="placeholder-logo">👀</div>
      <div class="placeholder-subtitle">Peekaboo is watching...</div>
    </div>
  `;
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

  // Show the start form
  document.getElementById('startOverlay').classList.remove('hidden');
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
        document.getElementById('statEndpoints').textContent = msg.total_endpoints;
        document.getElementById('currentUrl').textContent = msg.url;
        addLog('📄', `Crawling: ${shortenUrl(msg.url)}`, 'page');
      }
      break;

    case 'screenshot':
      // Store up to 5 screenshots for report carousel
      if (capturedScreenshots.length < 5) {
        capturedScreenshots.push({
          image: msg.image,
          url: msg.url
        });
      }
      if (!uiPaused) {
        const box = document.getElementById('screenshotBox');
        box.innerHTML = `<img src="data:image/jpeg;base64,${msg.image}" alt="screenshot">`;
        document.getElementById('currentUrl').textContent = msg.url;
      }
      break;

    case 'endpoint':
      if (!uiPaused) {
        endpoints.push(msg);
        hosts.add(msg.host);
        document.getElementById('statEndpoints').textContent = endpoints.length;
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

    case 'crawl_error':
      // Always show errors even when paused
      addLog('⚠️', `Error on ${shortenUrl(msg.url)}: ${msg.error}`, 'error');
      break;

    case 'crawl_end':
      break;

    case 'done':
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
        document.getElementById('statEndpoints').textContent = endpoints.length;
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
    if (isMatching) rowIndex++;
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

  // Group endpoints by API confidence
  const apiEndpoints = endpoints.filter(ep => ep.api_confidence === 'API');
  const maybeApiEndpoints = endpoints.filter(ep => ep.api_confidence === 'Maybe API');
  const otherEndpoints = endpoints.filter(ep => !ep.api_confidence || ep.api_confidence === 'Not API');

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
      height: 2.5rem;
      width: auto;
      min-width: 12rem;
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
      background: linear-gradient(transparent, rgba(0,0,0,0.8));
      padding: 2rem 1rem 1rem;
      color: #00ff88;
      font-size: 0.85rem;
      text-align: center;
      font-family: 'JetBrains Mono', monospace;
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
        <svg class="salt-logo" version="1.1" viewBox="0 0 152.63 40.25" xmlns="http://www.w3.org/2000/svg">
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
          <path d="m125.63 31.99h13.84v-2.9h-10.27v-23.57h-3.57z" fill="#fff"></path>
          <path d="m150.39 5.52h-13.58v2.9h4.99v23.57h3.57v-23.57h5.02z" fill="#fff"></path>
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
      <div class="screenshot-header">
        📸 Application Screenshots (${capturedScreenshots.length})
      </div>
      <div class="carousel-container">
        <div class="carousel-wrapper">
          <div class="carousel-slides" id="carouselSlides">
            ${capturedScreenshots.map((screenshot, index) => `
              <div class="carousel-slide">
                <img src="data:image/jpeg;base64,${screenshot.image}" alt="Screenshot ${index + 1} of ${targetDomain}">
                <div class="carousel-slide-caption">${screenshot.url}</div>
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
          ${externals.map(domain => `<div class="domain-tag external" data-domain="${domain.toLowerCase()}">${domain}</div>`).join('')}
        </div>
      ` : '<div class="empty-state">No external domains discovered</div>'}
    </div>

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
              const methodClass = 'method-' + (ep.method || 'default');
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
              const methodClass = 'method-' + (ep.method || 'default');
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

function showAbout() {
  document.getElementById('aboutOverlay').classList.add('show');
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
