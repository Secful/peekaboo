/* Endpoint table management: addEndpointRow, updateEndpointCounter, renderActiveScans, addLog */

function updateEndpointCounter() {
  // Exclude WebSocket endpoints from main counter (they have dedicated tab)
  const totalCount = appState.endpoints.filter(ep => ep.method !== 'WEBSOCKET').length;
  // Count confirmed APIs + GET* endpoints that belong to domain/subdomain
  const domainCount = appState.endpoints.filter(ep =>
    ep.method !== 'WEBSOCKET' &&
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
    friendlyMsgElement.textContent = 'No domain endpoints discovered yet';
    friendlyMsgElement.style.display = 'block';
  } else if (domainCount === 1) {
    friendlyMsgElement.textContent = '1 domain endpoint discovered';
    friendlyMsgElement.style.display = 'block';
  } else {
    friendlyMsgElement.textContent = `${domainCount} domain endpoints discovered`;
    friendlyMsgElement.style.display = 'block';
  }
}

function addEndpointRow(ep, flash=false) {
  // Skip WebSocket endpoints - they only appear in WebSocket tab
  if (ep.method === 'WEBSOCKET') {
    return;
  }

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
    typeBadge = '<span style="display:inline-block;padding:0.15rem 0.4rem;background:rgba(6,182,212,0.1);color:#0891b2;border:1px solid rgba(6,182,212,0.25);border-radius:3px;font-size:0.7rem;font-weight:600;margin-right:0.5rem;">API</span>';
  } else if (ep.api_confidence === 'Maybe API') {
    typeBadge = '<span style="display:inline-block;padding:0.15rem 0.4rem;background:rgba(217,119,6,0.1);color:#d97706;border:1px solid rgba(217,119,6,0.25);border-radius:3px;font-size:0.7rem;font-weight:600;margin-right:0.5rem;">Maybe</span>';
  }

  // PII badges — only for confirmed APIs on domain/subdomains
  let pathSuffixBadges = '';
  if (ep.api_confidence === 'API' && isDomainEndpoint(ep)) {
    const piiSources = [
      { label: 'query', text: (ep.query_params || []).join(' '), jsonKeys: false },
      { label: 'request', text: ep.request_body || '', jsonKeys: true },
      { label: 'response', text: ep.response_body || '', jsonKeys: true },
    ];
    const piiDetails = [];
    for (const src of piiSources) {
      const matches = getPiiMatches(src.text, src.jsonKeys);
      if (matches.length) piiDetails.push(`${src.label}: ${matches.join(', ')}`);
    }
    if (piiDetails.length) pathSuffixBadges += ` <span class="api-pii-badge" title="PII — ${escHtml(piiDetails.join(' | '))}" style="font-size:0.6rem;vertical-align:middle;">PII</span>`;
  }

  // Method with tooltip
  const methodTitle = escHtml(getMethodExplanation(ep.method));

  // Status code with tooltip
  const statusDisplay = ep.response_status || '—';
  const statusTitle = ep.response_status ? escHtml(getStatusExplanation(ep.response_status)) : '';

  tr.innerHTML = `
    <td class="row-number" style="text-align:center;color:var(--text-muted);font-size:0.85rem;"></td>
    <td><span class="badge ${badgeClass}" style="cursor:help;" title="${methodTitle}">${ep.method}</span></td>
    <td class="path-cell" title="${escHtml(ep.path)}">${typeBadge}${escHtml(trimPath(ep.path))}${pathSuffixBadges}</td>
    <td class="host-cell" title="${escHtml(ep.host)}">${escHtml(ep.host)}</td>
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
  const others = scans.filter(s => s && s.scan_id && s.scan_id !== appState.myScanId);

  if (others.length === 0) {
    badge.classList.add('hidden');
    badge.textContent = '';
    return;
  }

  const fullText = `${others.length} other scan${others.length > 1 ? 's' : ''} active: ${others.map(s => s.domain || 'unknown').join(', ')}`;
  badge.textContent = `${others.length} scan${others.length > 1 ? 's' : ''} active`;
  badge.title = fullText;
  badge.classList.remove('hidden');
}

function addLog(icon, message, cls) {
  _resetInactivityTimer();
  const log = document.getElementById('activityLog');
  const div = document.createElement('div');
  div.className = `log-entry ${cls}`;
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  div.innerHTML = `<span class="log-ts" style="color:var(--text-muted);font-size:0.85rem;margin-right:0.4rem">${ts}</span><span class="icon">${icon}</span><span class="msg">${escHtml(message)}</span>`;
  log.insertBefore(div, log.firstChild);
  // Keep log manageable
  while (log.children.length > 200) log.removeChild(log.lastChild);
}

function renderWebSocketView() {
  const tbody = document.getElementById('webSocketTbody');
  const emptyState = document.getElementById('webSocketEmptyState');
  const wsTab = document.getElementById('evtWebSocket');

  // Filter endpoints to only WebSocket
  const wsEndpoints = appState.endpoints.filter(ep => ep.method === 'WEBSOCKET');

  // Update tab label with count
  if (wsTab) {
    wsTab.textContent = `WebSocket (${wsEndpoints.length})`;
  }

  if (wsEndpoints.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';
  tbody.innerHTML = '';

  wsEndpoints.forEach((ep, idx) => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.dataset.wsExpanded = 'false';
    tr.onclick = () => toggleWsTraffic(tr, ep);

    // Security check: ws: vs wss:
    const isSecure = ep.full_url.startsWith('wss://');
    const protocol = isSecure ? 'WSS' : 'WS';
    const badgeClass = isSecure ? 'badge-websocket' : 'badge-websocket-insecure';
    const securityIcon = isSecure ? '' : ' ⚠️';

    const queryDisplay = ep.query_params && ep.query_params.length > 0
      ? ep.query_params.slice(0, 2).join(', ') + (ep.query_params.length > 2 ? '...' : '')
      : '—';

    tr.innerHTML = `
      <td style="text-align:center;color:var(--text-muted)">${idx + 1}</td>
      <td><span class="badge ${badgeClass}">${protocol}${securityIcon}</span></td>
      <td class="path-cell">${escHtml(ep.path)}</td>
      <td class="host-cell">${escHtml(ep.host)}</td>
      <td class="reason-cell">${escHtml(queryDisplay)}</td>
    `;

    tbody.appendChild(tr);
  });
}

function toggleWsTraffic(clickedRow, ep) {
  const expanded = clickedRow.dataset.wsExpanded === 'true';

  if (expanded) {
    // Collapse: remove chat row
    const chatRow = clickedRow.nextElementSibling;
    if (chatRow && chatRow.classList.contains('ws-chat-row')) {
      chatRow.remove();
    }
    clickedRow.dataset.wsExpanded = 'false';
  } else {
    // Expand: insert chat row below
    const chatRow = document.createElement('tr');
    chatRow.classList.add('ws-chat-row');
    chatRow.innerHTML = `<td colspan="5" style="padding:0;background:var(--bg-secondary)"></td>`;

    const chatContainer = document.createElement('div');
    chatContainer.style.cssText = 'max-height:400px;overflow-y:auto;padding:1rem;';

    const messages = ep.websocket_messages || [];

    if (messages.length === 0) {
      chatContainer.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:2rem">No messages captured</div>';
    } else {
      messages.forEach(msg => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `ws-message ws-message-${msg.direction}`;

        const time = new Date(msg.timestamp).toLocaleTimeString();
        const sizeStr = msg.size >= 1024 ? `${(msg.size/1024).toFixed(1)}KB` : `${msg.size}B`;

        msgDiv.innerHTML = `
          <div class="ws-message-meta">
            <span class="ws-message-direction">${msg.direction === 'sent' ? '→ Sent' : '← Received'}</span>
            <span>${time}</span>
            <span>${sizeStr}</span>
          </div>
          <div class="ws-message-body">${escHtml(msg.payload)}</div>
          ${msg.truncated ? '<div class="ws-message-truncated">⚠️ Truncated to 1KB</div>' : ''}
        `;

        chatContainer.appendChild(msgDiv);
      });
    }

    chatRow.firstElementChild.appendChild(chatContainer);
    clickedRow.insertAdjacentElement('afterend', chatRow);
    clickedRow.dataset.wsExpanded = 'true';

    // Scroll chat to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

