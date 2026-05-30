/* Endpoint detail drawer */

function decodePayloadIfBase64(payload) {
  if (!payload || typeof payload !== 'string') return payload;

  // Check if looks like base64: alphanumeric + / + = and no spaces
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  if (!base64Regex.test(payload) || payload.length < 20) return payload;

  try {
    const decoded = atob(payload);
    // Check if decoded contains mostly printable ASCII
    const printable = /^[\x20-\x7E\n\r\t]*$/.test(decoded);
    if (printable) {
      return `[Base64 decoded]\n${decoded}`;
    }
    return payload; // Binary data, show original
  } catch (e) {
    return payload; // Not valid base64
  }
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
          Generate API Description
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

    ${(() => {
      if (ep.api_confidence !== 'API') return '';
      const sources = [
        { label: 'Query', text: (ep.query_params || []).join(' '), jsonKeys: false },
        { label: 'Request Body', text: ep.request_body || '', jsonKeys: true },
        { label: 'Response Body', text: ep.response_body || '', jsonKeys: true },
      ];
      const piiHits = sources.flatMap(s => getPiiMatches(s.text, s.jsonKeys).map(kw => ({ source: s.label, keyword: kw })));
      if (!piiHits.length) return '';
      let html = '<div class="detail-section"><div class="detail-label">Detection Evidence</div><div class="detail-value">';
      html += '<div><strong style="color:#ef4444">PII:</strong> ' + piiHits.map(h => `<span class="query-param" style="background:rgba(220,38,38,0.08);color:#dc2626;border:1px solid rgba(220,38,38,0.2)">${escHtml(h.keyword)} <span style="color:var(--text-muted);font-size:0.7rem">(${escHtml(h.source)})</span></span>`).join('') + '</div>';
      html += '</div></div>';
      return html;
    })()}

    ${ep.api_confidence === 'API' ? `
    <div class="detail-section">
      <div class="detail-label drawer-collapsible-toggle" onclick="this.nextElementSibling.classList.toggle('collapsed');this.querySelector('.chevron').textContent=this.nextElementSibling.classList.contains('collapsed')?'▶':'▼'">
        Request Body <span class="chevron">▼</span>
      </div>
      <pre class="detail-value drawer-body-pre">${ep.request_body ? escHtml(tryPrettyJson(ep.request_body)) : '<span style="color:var(--text-muted);font-style:italic">Not captured (only available for POST/PUT/PATCH)</span>'}</pre>
    </div>
    <div class="detail-section">
      <div class="detail-label drawer-collapsible-toggle" onclick="this.nextElementSibling.classList.toggle('collapsed');this.querySelector('.chevron').textContent=this.nextElementSibling.classList.contains('collapsed')?'▶':'▼'">
        Response Body <span class="chevron">▼</span>
      </div>
      <pre class="detail-value drawer-body-pre">${ep.response_body ? escHtml(tryPrettyJson(ep.response_body)) : '<span style="color:var(--text-muted);font-style:italic">Not captured</span>'}</pre>
    </div>` : ''}

    ${ep.method === 'WEBSOCKET' && ep.websocket_messages && ep.websocket_messages.length > 0 ? `
    <div class="detail-section">
      <div class="detail-label drawer-collapsible-toggle" onclick="this.nextElementSibling.classList.toggle('collapsed');this.querySelector('.chevron').textContent=this.nextElementSibling.classList.contains('collapsed')?'▶':'▼'">
        WebSocket Messages (${ep.websocket_messages.length} sampled) <span class="chevron">▼</span>
      </div>
      <div class="detail-value drawer-body-pre" style="max-height:400px;overflow-y:auto">
        ${ep.websocket_messages.map((msg, idx) => `
          <div style="margin-bottom:1rem;padding:0.75rem;background:var(--bg-secondary);border-radius:4px;border-left:3px solid ${msg.direction === 'sent' ? '#3b82f6' : '#10b981'}">
            <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;font-size:0.75rem;color:var(--text-muted)">
              <span style="color:${msg.direction === 'sent' ? '#3b82f6' : '#10b981'};font-weight:600">${msg.direction === 'sent' ? '→ SENT' : '← RECEIVED'}</span>
              <span>${new Date(msg.timestamp).toLocaleTimeString()}</span>
              <span>${msg.size} bytes${msg.truncated ? ' (truncated to 1KB)' : ''}</span>
            </div>
            <pre style="margin:0;font-size:0.75rem;white-space:pre-wrap;word-break:break-all">${escHtml(decodePayloadIfBase64(msg.payload))}</pre>
          </div>
        `).join('')}
      </div>
    </div>` : ''}
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
