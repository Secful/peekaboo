/* Service Mesh — D3 force-directed spoke-hub visualization */

// Track in-flight describe call to avoid duplicates
let _describeInFlight = false;

// Known multi-part TLD suffixes
const _MULTI_TLDS = new Set([
  'co.uk','org.uk','ac.uk','co.jp','or.jp','ne.jp','co.kr','or.kr',
  'com.au','net.au','org.au','com.br','org.br','net.br',
  'co.in','net.in','org.in','co.za','co.nz','com.mx','com.ar',
  'com.cn','com.tw','com.hk','co.il','com.sg','com.tr','com.pk',
]);

function getRegistrableDomain(host) {
  const h = host.toLowerCase().replace(/\.$/, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  if (_MULTI_TLDS.has(last2)) {
    return parts.length >= 3 ? parts.slice(-3).join('.') : h;
  }
  return parts.slice(-2).join('.');
}

function getServiceMeshData() {
  const hostMap = {};
  appState.endpoints.forEach(ep => {
    const h = ep.host;
    if (!h) return;
    if (!hostMap[h]) hostMap[h] = { count: 0, endpoints: [] };
    hostMap[h].count++;
    if (hostMap[h].endpoints.length < 50) hostMap[h].endpoints.push(ep);
  });

  let hubHost = appState.targetDomain || '';
  let hubCount = 0;
  const mergedMap = {};

  Object.keys(hostMap).forEach(host => {
    if (isDomainHost(host)) {
      hubCount += hostMap[host].count;
    } else {
      const parent = getRegistrableDomain(host);
      if (!mergedMap[parent]) mergedMap[parent] = { count: 0, subdomains: new Set(), endpoints: [] };
      mergedMap[parent].count += hostMap[host].count;
      mergedMap[parent].subdomains.add(host);
      const room = 50 - mergedMap[parent].endpoints.length;
      if (room > 0) mergedMap[parent].endpoints.push(...hostMap[host].endpoints.slice(0, room));
    }
  });

  const spokes = Object.keys(mergedMap).map(parent => ({
    host: parent,
    count: mergedMap[parent].count,
    subdomains: [...mergedMap[parent].subdomains].sort(),
    endpoints: mergedMap[parent].endpoints,
  }));
  spokes.sort((a, b) => b.count - a.count);

  return { hub: { host: hubHost, count: hubCount }, spokes };
}

function truncateHost(host, maxLen) {
  if (host.length <= maxLen) return host;
  return host.substring(0, maxLen - 1) + '\u2026';
}

// ── D3 Force-directed rendering ──────────────────────────────────────

let _meshSimulation = null; // keep reference to stop on re-render

function renderServiceMesh() {
  const container = document.getElementById('serviceMeshContent');
  if (!container) return;

  // Stop any previous simulation
  if (_meshSimulation) { _meshSimulation.stop(); _meshSimulation = null; }

  const data = getServiceMeshData();

  if (appState.endpoints.length === 0) {
    container.innerHTML = '<div class="subdomain-placeholder"><div class="icon">\uD83D\uDD78</div><div>Start a scan to visualize the service mesh</div></div>';
    return;
  }
  if (data.spokes.length === 0) {
    container.innerHTML = '<div class="subdomain-placeholder"><div class="icon">\uD83D\uDD78</div><div>No external domains detected</div></div>';
    return;
  }

  const MAX_SPOKES = 40;
  const overflow = data.spokes.length > MAX_SPOKES ? data.spokes.length - MAX_SPOKES : 0;
  const visibleSpokes = data.spokes.slice(0, MAX_SPOKES);
  const maxCount = Math.max(...visibleSpokes.map(s => s.count), 1);

  // Header
  let headerHtml = '<div class="servicemesh-header"><div class="servicemesh-stats">';
  headerHtml += `<span>${visibleSpokes.length}${overflow > 0 ? '+' : ''} external service${visibleSpokes.length !== 1 ? 's' : ''}</span>`;
  headerHtml += `<span>${data.hub.count} domain endpoint${data.hub.count !== 1 ? 's' : ''}</span>`;
  headerHtml += '</div>';
  headerHtml += '<span class="servicemesh-zoom-hint">Scroll to zoom \u00b7 drag nodes \u00b7 double-click to reset</span>';
  headerHtml += '</div>';

  container.innerHTML = headerHtml + '<div class="servicemesh-graph-container" id="meshGraphContainer"></div>';

  // Defer SVG creation to next frame so the container has its computed dimensions
  requestAnimationFrame(() => _buildMeshGraph(data, visibleSpokes, maxCount, overflow));
}

function _buildMeshGraph(data, visibleSpokes, maxCount, overflow) {
  const graphEl = document.getElementById('meshGraphContainer');
  if (!graphEl) return;
  const width = graphEl.clientWidth || 900;
  const height = graphEl.clientHeight || 600;

  // Build nodes and links for D3
  const nodes = [];
  const links = [];

  // Hub node (index 0)
  nodes.push({
    id: '__hub__',
    label: truncateHost(data.hub.host, 30),
    count: data.hub.count,
    isHub: true,
    r: 26,
  });

  visibleSpokes.forEach(spoke => {
    const subLabel = spoke.subdomains && spoke.subdomains.length > 1 ? ` (${spoke.subdomains.length})` : '';
    const r = Math.max(8, Math.min(18, 8 + (spoke.count / maxCount) * 10));
    nodes.push({
      id: spoke.host,
      label: truncateHost(spoke.host, 22) + subLabel,
      fullHost: spoke.host,
      count: spoke.count,
      isHub: false,
      r: r,
    });
    links.push({
      source: '__hub__',
      target: spoke.host,
      value: spoke.count,
    });
  });

  // Create SVG with D3
  const svg = d3.select(graphEl)
    .append('svg')
    .attr('class', 'servicemesh-svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${width} ${height}`);

  // Zoom layer
  const g = svg.append('g');

  const zoom = d3.zoom()
    .scaleExtent([0.2, 5])
    .on('zoom', (event) => g.attr('transform', event.transform));

  svg.call(zoom);

  // Double-click to reset
  svg.on('dblclick.zoom', () => {
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  });

  // Links
  const linkSel = g.selectAll('.mesh-link')
    .data(links)
    .join('line')
    .attr('class', 'mesh-link')
    .attr('stroke', '#e5e7eb')
    .attr('stroke-opacity', 0.6)
    .attr('stroke-width', d => Math.max(1, Math.min(5, (d.value / maxCount) * 5)));

  // Node groups
  const nodeSel = g.selectAll('.mesh-node')
    .data(nodes)
    .join('g')
    .attr('class', d => d.isHub ? 'mesh-node mesh-hub' : 'mesh-node mesh-spoke')
    .style('cursor', d => d.isHub ? 'default' : 'pointer')
    .on('click', (event, d) => {
      if (!d.isHub) openServiceMeshDetail(d.fullHost);
    });

  // Drag behaviour
  const drag = d3.drag()
    .on('start', (event, d) => {
      if (!event.active) _meshSimulation.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on('drag', (event, d) => {
      d.fx = event.x; d.fy = event.y;
    })
    .on('end', (event, d) => {
      if (!event.active) _meshSimulation.alphaTarget(0);
      d.fx = null; d.fy = null;
    });

  nodeSel.call(drag);

  // Circles
  nodeSel.append('circle')
    .attr('r', d => d.r)
    .attr('class', d => d.isHub ? 'servicemesh-hub-node' : 'servicemesh-spoke-node');

  // Native browser tooltips on spoke nodes (updated when descriptions load)
  nodeSel.filter(d => !d.isHub).append('title')
    .text(d => d.fullHost);

  // Hub count text (inside circle)
  nodeSel.filter(d => d.isHub).append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('class', 'servicemesh-hub-count')
    .text(d => d.count);

  // Labels above nodes
  nodeSel.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', d => -d.r - 6)
    .attr('class', d => d.isHub ? 'servicemesh-hub-label' : 'servicemesh-spoke-label')
    .text(d => d.label);

  // Count below spoke nodes
  nodeSel.filter(d => !d.isHub).append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', d => d.r + 14)
    .attr('class', 'servicemesh-spoke-count')
    .text(d => d.count);

  // Overflow text
  if (overflow > 0) {
    g.append('text')
      .attr('x', width - 10).attr('y', height - 10)
      .attr('text-anchor', 'end')
      .attr('class', 'servicemesh-overflow')
      .text(`+ ${overflow} more`);
  }

  // Force simulation
  const linkDistance = Math.min(width, height) * 0.3;
  _meshSimulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(linkDistance))
    .force('charge', d3.forceManyBody().strength(d => d.isHub ? -400 : -200))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide().radius(d => d.r + 30))
    .on('tick', () => {
      linkSel
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    });

  // Auto-describe undescribed spokes (descriptions used in detail drawer only)
  const cached = appState.serviceMeshDescriptions || {};
  if (visibleSpokes.some(s => !cached[s.host])) {
    describeServices();
  }
}

// ── LLM descriptions ─────────────────────────────────────────────────

async function describeServices() {
  if (_describeInFlight) return;

  const data = getServiceMeshData();
  const visibleSpokes = data.spokes.slice(0, 40);
  const cached = appState.serviceMeshDescriptions || {};
  const undescribed = visibleSpokes.map(s => s.host).filter(h => !cached[h]);
  if (undescribed.length === 0) return;

  _describeInFlight = true;

  try {
    const resp = await fetch('/api/describe-services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_domain: appState.targetDomain, hostnames: undescribed }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();
    appState.serviceMeshDescriptions = { ...cached, ...(result.descriptions || {}) };
    _updateMeshTooltips();
  } catch (err) {
    console.error('describeServices failed:', err);
    showNotifyToast('Failed to describe services: ' + err.message, 'warning');
  } finally {
    _describeInFlight = false;
  }
}

function _updateMeshTooltips() {
  const descriptions = appState.serviceMeshDescriptions;
  if (!descriptions) return;
  d3.selectAll('.mesh-spoke').each(function(d) {
    const desc = descriptions[d.fullHost];
    if (desc) d3.select(this).select('title').text(d.fullHost + ' — ' + desc);
  });
}

// ── Detail drawer ────────────────────────────────────────────────────

function openServiceMeshDetail(host) {
  const data = getServiceMeshData();
  const spoke = data.spokes.find(s => s.host === host);
  if (!spoke) return;

  const drawer = document.getElementById('detailDrawer');
  const content = document.getElementById('drawerContent');
  const desc = appState.serviceMeshDescriptions && appState.serviceMeshDescriptions[host];

  let html = '';
  html += `<div class="detail-section"><div class="detail-label">Domain</div><div class="detail-value" style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;word-break:break-all">${escHtml(host)}</div></div>`;

  if (desc) {
    html += `<div class="detail-section"><div class="detail-label">Service Description</div><div class="detail-value" style="color:var(--green);font-style:italic">${escHtml(desc)}</div></div>`;
  } else if (_describeInFlight) {
    html += `<div class="detail-section"><div class="detail-label">Service Description</div><div class="detail-value" style="color:var(--text-muted);font-style:italic">Loading...</div></div>`;
  }

  if (spoke.subdomains && spoke.subdomains.length > 1) {
    html += `<div class="detail-section"><div class="detail-label">Subdomains (${spoke.subdomains.length})</div>`;
    html += `<div class="detail-value" style="font-family:'JetBrains Mono',monospace;font-size:0.8rem;line-height:1.6">`;
    spoke.subdomains.forEach(sub => { html += `<div style="color:var(--text-muted)">${escHtml(sub)}</div>`; });
    html += '</div></div>';
  }

  // Deduplicate endpoints by method+path
  const seen = new Set();
  const uniqueEps = spoke.endpoints.filter(ep => {
    const key = (ep.method || 'GET') + ' ' + (ep.path || ep.full_url || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  html += `<div class="detail-section"><div class="detail-label">Unique Endpoints</div><div class="detail-value">${uniqueEps.length}</div></div>`;
  html += '<div class="detail-section"><div class="detail-label">Endpoints</div></div>';

  uniqueEps.slice(0, 50).forEach(ep => {
    const badgeClass = 'badge-' + (ep.method || 'GET');
    html += `<div style="margin-bottom:0.4rem;font-size:0.85rem;display:flex;align-items:center;gap:0.4rem">`;
    html += `<span class="badge ${badgeClass}" style="font-size:0.7rem;padding:0.1rem 0.35rem">${escHtml(ep.method || 'GET')}</span>`;
    html += `<span style="word-break:break-all;color:var(--text-muted)">${escHtml(ep.path || ep.full_url || '')}</span></div>`;
  });
  if (uniqueEps.length > 50) {
    html += `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem">+ ${uniqueEps.length - 50} more endpoints</div>`;
  }

  content.innerHTML = html;
  document.querySelector('#detailDrawer .drawer-header h3').textContent = 'Service Details';
  drawer.classList.add('open');
}
