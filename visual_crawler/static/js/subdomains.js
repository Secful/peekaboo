/* Subdomain table, map, crawl, and JS analysis */

function renderSubdomainTable(data) {
  const container = document.getElementById('subdomainContent');

  // data is the Lambda response — expect an array of subdomain objects
  const subdomains = normalizeSubdomains(data);
  subdomains.sort((a, b) => (b.can_crawl ? 1 : 0) - (a.can_crawl ? 1 : 0));

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
      <div class="subdomain-summary-stat"><strong>${crawlableCount}</strong> crawlable${crawlableCount > 0 ? ` <button class="crawl-btn crawl-all-btn" id="crawlAllBtn" onclick="crawlAllSubdomains()">🔍 Look Deeper All</button>` : ''}</div>
      <div class="subdomain-view-toggle">
        <button class="toggle-btn${appState.subdomainViewMode === 'table' ? ' active' : ''}" onclick="setSubdomainViewMode('table')">Table</button>
        <button class="toggle-btn${appState.subdomainViewMode === 'map' ? ' active' : ''}" onclick="setSubdomainViewMode('map')">Map</button>
      </div>
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
    const name = getSubdomainName(sub);
    const status = sub.status_code || sub.status || 0;
    const title = sub.title || '—';
    const server = sub.web_server || sub.server || '—';
    const screenshot = sub.screenshot || sub.screenshot_url || '';
    const techs = sub.technologies || [];
    const crawlable = !!sub.can_crawl;

    const statusCls = getSubdomainStatusClass(status);

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
    const aiBadgeHtml = isAiRelated(name) ? ' <span class="ai-badge">AI</span>' : '';

    html += `
      <tr id="sub-row-${idx}">
        <td style="text-align:center;color:var(--text-muted);font-size:0.85rem;">${idx + 1}</td>
        <td class="subdomain-name"><span id="crawl-td-${idx}">${escHtml(name)}${aiBadgeHtml}${crawlBtnHtml}</span></td>
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

  // Restore map view if user was viewing the map
  if (appState.subdomainViewMode === 'map') {
    setSubdomainViewMode('map');
  }
}

function setSubdomainViewMode(mode) {
  appState.subdomainViewMode = mode;
  const content = document.getElementById('subdomainContent');
  const mapContainer = document.getElementById('subdomainMapContainer');

  // Update toggle buttons
  document.querySelectorAll('.subdomain-view-toggle .toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.trim().toLowerCase() === mode);
  });

  if (mode === 'map') {
    // Hide table rows but keep summary bar visible
    const table = content.querySelector('.subdomain-table');
    if (table) table.style.display = 'none';
    mapContainer.classList.remove('hidden');
    showSubdomainMap();
  } else {
    const table = content.querySelector('.subdomain-table');
    if (table) table.style.display = '';
    mapContainer.classList.add('hidden');
  }
}

async function showSubdomainMap() {
  if (!appState.subdomainResults) return;
  const subdomains = normalizeSubdomains(appState.subdomainResults);
  const noData = document.getElementById('mapNoData');
  const mapLoading = document.getElementById('mapLoading');
  noData.classList.add('hidden');

  // Collect unique IPs that need geolocation
  const ipsToFetch = [];
  for (const sub of subdomains) {
    const ip = sub.ip_address || sub.ip || '';
    if (ip && !appState.geoCache[ip] && !ipsToFetch.includes(ip)) {
      ipsToFetch.push(ip);
    }
  }

  // Fetch geolocation for uncached IPs
  if (ipsToFetch.length > 0) {
    mapLoading.classList.remove('hidden');
    try {
      const resp = await fetch('/api/geolocate-ips', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ips: ipsToFetch}),
      });
      if (resp.ok) {
        const data = await resp.json();
        for (const r of (data.results || [])) {
          if (r.status === 'success') {
            appState.geoCache[r.query] = {lat: r.lat, lon: r.lon, city: r.city, country: r.country, isp: r.isp, org: r.org};
          }
        }
      }
    } catch (e) {
      console.warn('Geolocation fetch failed:', e);
    }
    mapLoading.classList.add('hidden');
  }

  // Initialize map once
  if (!appState.subdomainMapInstance) {
    appState.subdomainMapInstance = L.map('subdomainMap', {zoomControl: true}).setView([20, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(appState.subdomainMapInstance);

    // "Fit All" zoom-out control
    const FitAllControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function() {
        const btn = L.DomUtil.create('div', 'leaflet-bar map-fit-all-btn');
        btn.innerHTML = '⊡';
        btn.title = 'Show all subdomains';
        btn.onclick = function(e) {
          e.stopPropagation();
          if (appState.subdomainMapBounds) appState.subdomainMapInstance.fitBounds(appState.subdomainMapBounds);
        };
        return btn;
      }
    });
    appState.subdomainMapInstance.addControl(new FitAllControl());
  }

  // Clear old markers
  appState.subdomainMapMarkers.forEach(m => appState.subdomainMapInstance.removeLayer(m));
  appState.subdomainMapMarkers = [];

  // Group subdomains by location
  const groups = {};
  for (const sub of subdomains) {
    const ip = sub.ip_address || sub.ip || '';
    const geo = appState.geoCache[ip];
    if (!geo) continue;
    const key = `${geo.lat},${geo.lon}`;
    if (!groups[key]) groups[key] = {geo, subs: []};
    groups[key].subs.push(sub);
  }

  const keys = Object.keys(groups);
  if (keys.length === 0) {
    noData.classList.remove('hidden');
    setTimeout(() => appState.subdomainMapInstance.invalidateSize(), 100);
    return;
  }
  noData.classList.add('hidden');

  const bounds = [];
  for (const key of keys) {
    const {geo, subs} = groups[key];
    const radius = Math.min(6 + subs.length * 2, 20);
    const marker = L.circleMarker([geo.lat, geo.lon], {
      radius,
      fillColor: '#00ff88',
      color: '#6b2fc7',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.7,
    }).addTo(appState.subdomainMapInstance);

    // Build popup
    let popupHtml = `<div class="dark-popup">`;
    popupHtml += `<div class="map-popup-location">${escHtml(geo.city || '?')}, ${escHtml(geo.country || '?')}</div>`;
    if (geo.org || geo.isp) {
      popupHtml += `<div class="map-popup-org">${escHtml(geo.org || geo.isp)}</div>`;
    }
    popupHtml += `<div class="map-popup-subs">`;
    for (const s of subs) {
      const name = s.subdomain || s.domain || s.host || '—';
      const ip = s.ip_address || s.ip || '';
      const status = s.status_code || s.status || 0;
      const statusCls = getSubdomainStatusClass(status);
      const mapAiBadge = isAiRelated(name) ? ' <span class="ai-badge">AI</span>' : '';
      popupHtml += `<div class="map-popup-sub-row">
        <span class="map-popup-sub-name">${escHtml(name)}${mapAiBadge}</span>
        <span class="map-popup-sub-ip">${escHtml(ip)}</span>
        <span class="subdomain-status ${statusCls}" style="font-size:0.65rem;">${status || '—'}</span>
      </div>`;
    }
    popupHtml += `</div></div>`;
    marker.bindPopup(popupHtml, {className: 'dark-popup-container', maxWidth: 350});

    appState.subdomainMapMarkers.push(marker);
    bounds.push([geo.lat, geo.lon]);
  }

  // Save bounds for "fit all" button and apply
  if (bounds.length > 1) {
    appState.subdomainMapBounds = L.latLngBounds(bounds).pad(0.1);
  } else if (bounds.length === 1) {
    appState.subdomainMapBounds = L.latLngBounds(bounds).pad(0.1);
  }

  setTimeout(() => {
    appState.subdomainMapInstance.invalidateSize();
    if (appState.subdomainMapBounds) {
      appState.subdomainMapInstance.fitBounds(appState.subdomainMapBounds);
    }
  }, 100);
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

async function crawlAllSubdomains() {
  const btn = document.getElementById('crawlAllBtn');
  const parent = btn?.parentNode;
  if (btn) btn.outerHTML = '<span id="crawlAllSpinner" class="crawl-spinner"><span class="crawl-spin-icon"></span> Looking deeper...</span>';

  // Find all individual "Look deeper" buttons and click them sequentially
  const buttons = document.querySelectorAll('[id^="crawl-btn-"]');
  for (const b of buttons) {
    b.click();
    await new Promise(r => setTimeout(r, 500));
  }

  // Remove spinner when done
  const spinner = document.getElementById('crawlAllSpinner');
  if (spinner) spinner.remove();
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
        appState.subdomainApis[idx] = { subdomain, apis: dedupApis, jsUrls };

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

function openApiDrawer(idx) {
  const data = appState.subdomainApis[idx];
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
  const piiCount = classified.filter(c => c.api.pii && c.api.pii.detected).length;
  const piiSuffix = piiCount > 0 ? ` — ${piiCount} with PII` : '';
  subtitle.textContent = `${classified.length} API${classified.length !== 1 ? 's' : ''} found — ${domainCount} domain, ${externalCount} external${piiSuffix}`;

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
    const categoryHtml = api.category
      ? `<span class="api-category-tag">${escHtml(api.category)}</span>`
      : '';
    const hasPii = api.pii && api.pii.detected;
    const piiFields = hasPii ? (api.pii.fields || []).join(', ') : '';
    const piiHtml = hasPii
      ? `<span class="api-pii-badge" title="PII: ${escHtml(piiFields)}">⚠ PII</span>`
      : '';
    const piiCls = hasPii ? ' api-card-pii' : '';
    const apiAiHtml = isAiRelated(api.url) ? '<span class="ai-badge">AI</span>' : '';
    const evidence = api.evidence || '';
    const evidenceHtml = evidence
      ? `<div class="api-card-evidence-toggle" onclick="this.nextElementSibling.classList.toggle('collapsed');this.querySelector('span').textContent=this.nextElementSibling.classList.contains('collapsed')?'▶':'▼'"><span>▶</span> Evidence</div><pre class="api-card-evidence collapsed">${escHtml(evidence)}</pre>`
      : '';
    html += `<div class="api-card ${originCls}${piiCls}">
      <div class="api-card-top">
        <span class="api-card-method ${mCls}">${escHtml(method)}</span>
        <span class="api-card-endpoint">${escHtml(api.url || '')}</span>
        <span class="api-card-tags">${apiAiHtml}${categoryHtml}${piiHtml}${originTag}</span>
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
