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
      <div class="subdomain-summary-stat"><strong>${crawlableCount}</strong> crawlable</div>
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
    // Blank/white screenshots are hidden (detected async via canvas sampling)
    let thumbHtml = '<span style="color:var(--muted);font-size:0.75rem;">—</span>';
    if (screenshot && screenshot.length > 100) {
      const thumbSrc = screenshot.startsWith('data:') ? screenshot : `data:image/jpeg;base64,${screenshot}`;
      thumbHtml = `<img class="subdomain-thumb" src="${thumbSrc}" alt="${escHtml(name)}" data-check-blank="1" style="display:none">`;
    }

    const crawlBtnHtml = '';
    const aiBadgeHtml = isAiRelated(name) ? ' <span class="ai-badge">AI</span>' : '';
    const securityLoadingHtml = crawlable ? ' <span class="security-pill security-pill-loading" title="Security analysis in progress..."><span class="js-pill-spin">⟳</span></span>' : '';

    html += `
      <tr id="sub-row-${idx}">
        <td style="text-align:center;color:var(--text-muted);font-size:0.85rem;">${idx + 1}</td>
        <td class="subdomain-name"><span id="crawl-td-${idx}" data-subdomain="${escHtml(name)}" title="${escHtml(title)}">${escHtml(name)}${aiBadgeHtml}${crawlBtnHtml}${securityLoadingHtml}</span></td>
        <td><span class="subdomain-status ${statusCls}">${status || '—'}</span></td>
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

  // Detect and hide blank/white screenshots — show only non-blank ones
  container.querySelectorAll('img[data-check-blank="1"]').forEach(img => {
    const reveal = () => {
      const c = document.createElement('canvas');
      const sz = 16;           // sample at 16×16
      c.width = sz; c.height = sz;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, sz, sz);
      const d = ctx.getImageData(0, 0, sz, sz).data;
      let total = 0;
      for (let i = 0; i < d.length; i += 4) total += d[i] + d[i + 1] + d[i + 2];
      const avg = total / (sz * sz * 3);
      if (avg < 250) {         // not blank — show it
        img.style.display = '';
      }
      img.removeAttribute('data-check-blank');
    };
    if (img.complete) reveal(); else img.onload = reveal;
  });

  // Apply JS resources for any already-received data
  for (const subdomain of Object.keys(appState.jsResources)) {
    applyJsResources(subdomain, appState.jsResources[subdomain].urls || []);
  }

  // Apply open ports pills for any already-received data
  for (const subdomain of Object.keys(appState.openPorts)) {
    applyOpenPortsPill(subdomain);
  }

  // Apply security pills for any already-received insights
  for (const subdomain of Object.keys(appState.securityInsights)) {
    applySecurityPill(subdomain);
  }

  // Apply agentic pills for any already-received findings
  for (const subdomain of Object.keys(appState.agentic)) {
    applyAgenticPill(subdomain);
  }

  // Apply extracted API results for any already-received data
  for (const subdomain of Object.keys(appState.extractedApis)) {
    applyExtractedApis(subdomain);
  }

  // Apply API spec pills for any already-received data
  for (const subdomain of Object.keys(appState.apiSpecs)) {
    applyApiSpecPill(subdomain);
  }

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
      fillColor: '#059669',
      color: '#4a1d96',
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
  applySecurityPill(subdomain);

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        wrapper.innerHTML = `${escHtml(subdomain)} <span class="crawl-spinner"><span class="crawl-spin-icon"></span> Retry ${attempt}/${maxRetries}...</span>`;
        applySecurityPill(subdomain);
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }

      const resp = await fetch(`/api/crawl-subdomain?crawl=${encodeURIComponent(subdomain)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      const rawUrls = data.crawled_urls || data.urls || (Array.isArray(data) ? data : []);
      const urls = rawUrls.filter(isApiOrJsUrl);
      const jsUrls = rawUrls.filter(u => /\.js(\?|#|$)/i.test(u));

      if (urls.length > 0) {
        // Build unified pill: [N JS | ▶]
        const rightZone = jsUrls.length > 0
          ? `<span class="js-pill-divider"></span><span class="js-pill-right analyzing" id="js-pill-right-${idx}" title="Analyzing JS files..."><span class="js-pill-spin">⟳</span></span>`
          : '';
        wrapper.innerHTML = `${escHtml(subdomain)} <span class="js-pill" id="js-pill-${idx}"><span class="js-pill-left" title="Toggle JS file list" onclick="event.stopPropagation(); toggleJsPillFiles(${idx})">${urls.length} JS</span>${rightZone}</span>`;

        const expandRow2 = document.getElementById(`crawled-row-${idx}`);
        if (expandRow2) expandRow2.dataset.jsUrls = JSON.stringify(jsUrls);
        if (appState.extractedApis[subdomain]) {
          applyExtractedApis(subdomain);
        }
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
      } else {
        const jsOnly = rawUrls.filter(u => /\.js(\?|#|$)/i.test(u));
        if (jsOnly.length > 0) {
          const expandRow2 = document.getElementById(`crawled-row-${idx}`);
          if (expandRow2) expandRow2.dataset.jsUrls = JSON.stringify(jsOnly);
          // Unified pill with only right zone (no file list to toggle)
          wrapper.innerHTML = `${escHtml(subdomain)} <span class="js-pill" id="js-pill-${idx}"><span class="js-pill-left" style="cursor:default">${jsOnly.length} JS</span><span class="js-pill-divider"></span><span class="js-pill-right analyzing" id="js-pill-right-${idx}" title="Analyzing JS files..."><span class="js-pill-spin">⟳</span></span></span>`;
          listDiv.innerHTML = `<div id="even-deeper-results-${idx}" class="even-deeper-results"></div>`;
          if (appState.extractedApis[subdomain]) {
            applyExtractedApis(subdomain);
          }
        } else {
          wrapper.innerHTML = escHtml(subdomain);
        }
      }
      applySecurityPill(subdomain);
      return; // Success — exit the retry loop
    } catch (err) {
      if (attempt === maxRetries) {
        wrapper.innerHTML = `${escHtml(subdomain)} <span class="crawl-error" title="${escHtml(err.message)}">Failed</span>`;
        applySecurityPill(subdomain);
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
    const jsPool = (appState.jsResources[data.subdomain] && appState.jsResources[data.subdomain].urls) || data.jsUrls;
    const srcUrl = srcName ? (
      jsPool.find(u => u.endsWith(srcName) || u.includes('/' + srcName)) ||
      jsPool.find(u => { const uBase = u.split('/').pop().split('?')[0].toLowerCase(); return uBase === srcBaseName; }) ||
      jsPool.find(u => srcBaseName && u.toLowerCase().includes(srcBaseName)) ||
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
        <span class="api-card-endpoint" title="${escHtml(api.url || '')}">${escHtml(api.url || '')}</span>
      </div>
      <div class="api-card-tags-row">${apiAiHtml}${categoryHtml}${piiHtml}${originTag}</div>
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

/* JS Resources — pushed from external scanner */

function applyJsResources(subdomain, urls) {
  // Find the wrapper span by data-subdomain attribute
  const span = document.querySelector(`.subdomain-table span[data-subdomain="${CSS.escape(subdomain)}"]`);
  if (!span) { console.warn(`[js-resources] No DOM element for subdomain: ${subdomain}`); return; }

  // Skip if already applied (unified pill or empty label already present)
  if (span.querySelector('.js-pill, .crawl-done-empty')) return;

  // Find the row index from the span id (crawl-td-{idx})
  const idMatch = (span.id || '').match(/^crawl-td-(\d+)$/);
  if (!idMatch) { console.warn(`[js-resources] No row index for subdomain: ${subdomain}`); return; }
  const idx = idMatch[1];

  // Remove the "Look deeper" button if present (this replaces it)
  const crawlBtn = span.querySelector('.crawl-btn');
  if (crawlBtn) crawlBtn.remove();

  // Remove any existing spinner
  for (const el of span.querySelectorAll('.crawl-spinner')) {
    el.remove();
  }

  if (urls.length === 0) {
    // No JS resources — show nothing extra
  } else {
    const jsUrls = urls.filter(u => /\.js(\?|#|$)/i.test(u));

    // Build unified pill: [N JS | ▶]
    span.appendChild(document.createTextNode(' '));
    const pill = document.createElement('span');
    pill.className = 'js-pill';
    pill.id = `js-pill-${idx}`;

    const left = document.createElement('span');
    left.className = 'js-pill-left';
    left.textContent = `${urls.length} JS`;
    left.title = 'Toggle JS file list';
    left.setAttribute('onclick', `event.stopPropagation(); toggleJsPillFiles(${idx})`);

    pill.appendChild(left);

    if (jsUrls.length > 0) {
      const divider = document.createElement('span');
      divider.className = 'js-pill-divider';
      pill.appendChild(divider);

      const right = document.createElement('span');
      right.className = 'js-pill-right analyzing';
      right.id = `js-pill-right-${idx}`;
      right.innerHTML = '<span class="js-pill-spin">⟳</span>';
      right.title = 'Analyzing JS files...';
      pill.appendChild(right);
    }

    span.appendChild(pill);

    // If extracted API results already arrived, apply them immediately (skip spinner)
    if (appState.extractedApis[subdomain]) {
      applyExtractedApis(subdomain);
    }

    // Ensure expandable row exists (crawlable subdomains have it; non-crawlable don't)
    let expandRow = document.getElementById(`crawled-row-${idx}`);
    let listDiv = document.getElementById(`crawled-list-${idx}`);
    if (!expandRow) {
      const mainRow = document.getElementById(`sub-row-${idx}`);
      if (mainRow) {
        expandRow = document.createElement('tr');
        expandRow.id = `crawled-row-${idx}`;
        expandRow.className = 'crawled-urls-row hidden';
        expandRow.innerHTML = `<td colspan="6" class="crawled-urls-cell"><div class="crawled-urls-list" id="crawled-list-${idx}"></div></td>`;
        mainRow.insertAdjacentElement('afterend', expandRow);
        listDiv = document.getElementById(`crawled-list-${idx}`);
      }
    }

    // Store JS URLs in data attribute
    if (expandRow && jsUrls.length > 0) {
      expandRow.dataset.jsUrls = JSON.stringify(jsUrls);
    }

    if (listDiv) {
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
    }
  }

  console.log(`[js-resources] Applied to ${subdomain} (${urls.length} urls)`);
  // Re-apply security pill (may have been shifted)
  applySecurityPill(subdomain);
}

/* Extracted APIs — results from api_extractor_lambda */

function applyExtractedApis(subdomain) {
  const data = appState.extractedApis[subdomain];
  if (!data) return;

  // Find the wrapper span by data-subdomain attribute
  const span = document.querySelector(`.subdomain-table span[data-subdomain="${CSS.escape(subdomain)}"]`);
  if (!span) return; // JS resources pill hasn't rendered yet — applyJsResources will pick this up

  // Find the row index from the span id (crawl-td-{idx})
  const idMatch = (span.id || '').match(/^crawl-td-(\d+)$/);
  if (!idMatch) return;
  const idx = idMatch[1];

  const right = document.getElementById(`js-pill-right-${idx}`);
  if (!right) return; // Pill doesn't have a right zone (no JS files)

  // Normalize findings PII format: Lambda sends list like ["email","phone"] or ["none"]
  const findings = (data.findings || []).map(f => {
    const piiRaw = f.pii || ['none'];
    const isNone = piiRaw.length === 1 && piiRaw[0] === 'none';
    return {
      ...f,
      pii: isNone ? { detected: false, fields: [] } : { detected: true, fields: piiRaw }
    };
  });

  // Filter and deduplicate
  const staticExts = /\.(js|css|html|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|map|xml|json)(\?|#|$)/i;
  const dedupSeen = new Set();
  const dedupApis = findings.filter(a => {
    const url = a.url || '';
    if (!url.includes('/')) return false;
    if (staticExts.test(url.split('/').pop())) return false;
    const k = `${(a.method || 'GET').toUpperCase()}|${url}|${a.source_file || ''}`;
    if (dedupSeen.has(k)) return false;
    dedupSeen.add(k);
    return true;
  });

  // Get jsUrls from JS resources (authoritative source via /api/jsresources)
  const jsUrls = (appState.jsResources[subdomain] && appState.jsResources[subdomain].urls) || [];

  // Store in subdomainApis so openApiDrawer works
  appState.subdomainApis[idx] = { subdomain, apis: dedupApis, jsUrls };

  // Update the right zone
  right.classList.remove('analyzing');
  if (dedupApis.length > 0) {
    right.classList.add('has-apis');
    right.textContent = `${dedupApis.length} APIs`;
    right.title = 'Open API drawer';
    right.setAttribute('onclick', `event.stopPropagation(); openApiDrawer(${idx})`);
  } else {
    right.classList.add('no-apis');
    right.textContent = '0 APIs';
    right.title = 'No APIs found';
    right.removeAttribute('onclick');
  }

  console.log(`[extracted-apis] Applied to ${subdomain} (${dedupApis.length} APIs)`);
}

function toggleJsPillFiles(idx) {
  const listId = `url-list-${idx}`;
  const list = document.getElementById(listId);
  const expandRow = list ? list.closest('.crawled-urls-row') : null;
  const left = document.querySelector(`#js-pill-${idx} .js-pill-left`);
  if (!list) return;
  if (list.classList.contains('collapsed')) {
    list.classList.remove('collapsed');
    if (left) left.classList.add('active');
    if (expandRow) expandRow.classList.remove('hidden');
  } else {
    list.classList.add('collapsed');
    if (left) left.classList.remove('active');
    if (expandRow) {
      const results = expandRow.querySelector('.even-deeper-results');
      if (!results || !results.innerHTML.trim()) expandRow.classList.add('hidden');
    }
  }
}

/* Security Insights — pill + drawer */

function applySecurityPill(subdomain) {
  const span = document.querySelector(`.subdomain-table span[data-subdomain="${CSS.escape(subdomain)}"]`);
  if (!span) { console.warn(`[security-pill] No DOM element for subdomain: ${subdomain}`); return; }

  const data = appState.securityInsights[subdomain];

  if (!data) {
    // No data yet — show loading spinner if no pill exists
    if (!span.querySelector('.security-pill')) {
      const spinner = document.createElement('span');
      spinner.className = 'security-pill security-pill-loading';
      spinner.innerHTML = '<span class="js-pill-spin">⟳</span>';
      spinner.title = 'Security analysis in progress...';
      span.appendChild(document.createTextNode(' '));
      span.appendChild(spinner);
    }
    return;
  }

  // Data arrived — remove loading spinner if present
  const loading = span.querySelector('.security-pill-loading');
  if (loading) {
    if (loading.previousSibling && loading.previousSibling.nodeType === 3 && loading.previousSibling.textContent.trim() === '') loading.previousSibling.remove();
    loading.remove();
  }

  // Real pill already exists — skip
  if (span.querySelector('.security-pill')) return;

  const findings = data.findings || [];
  const pill = document.createElement('span');

  if (findings.length === 0) {
    pill.className = 'security-pill security-pill-clean';
    pill.textContent = '\u2713';
    pill.title = 'Scans for known CVEs, exposed sensitive files, server misconfigurations, and subdomain takeover vulnerabilities.';
  } else {
    const maxSeverity = getMaxSeverity(findings);
    const severityClass = getSeverityPillClass(maxSeverity);
    const label = findings.length === 1 ? '1 finding' : `${findings.length} findings`;
    pill.className = `security-pill ${severityClass}`;
    pill.textContent = label;
    pill.setAttribute('onclick', `event.stopPropagation(); openSecurityDrawer('${subdomain.replace(/'/g, "\\'")}')`);
  }

  span.appendChild(document.createTextNode(' '));
  span.appendChild(pill);
  console.log(`[security-pill] Applied to ${subdomain} (${findings.length} findings)`);
}

function resolveStaleSecuritySpinners() {
  const spinners = document.querySelectorAll('.security-pill-loading');
  for (const spinner of spinners) {
    if (spinner.previousSibling && spinner.previousSibling.nodeType === 3 && spinner.previousSibling.textContent.trim() === '') spinner.previousSibling.remove();
    spinner.remove();
  }
  if (spinners.length > 0) {
    console.log(`[security-pill] Resolved ${spinners.length} stale spinner(s)`);
  }
}

function getMaxSeverity(findings) {
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  for (const s of order) {
    if (findings.some(f => (f.severity || '').toLowerCase() === s)) return s;
  }
  return 'info';
}

function getSeverityPillClass(severity) {
  switch ((severity || '').toLowerCase()) {
    case 'critical': case 'high': return 'security-pill-red';
    case 'medium': return 'security-pill-yellow';
    case 'low': case 'info': default: return 'security-pill-blue';
  }
}

function getSeverityBadgeClass(severity) {
  switch ((severity || '').toLowerCase()) {
    case 'critical': return 'severity-critical';
    case 'high': return 'severity-high';
    case 'medium': return 'severity-medium';
    case 'low': return 'severity-low';
    case 'info': default: return 'severity-info';
  }
}

function openSecurityDrawer(subdomain) {
  const data = appState.securityInsights[subdomain];
  if (!data) return;

  const drawer = document.getElementById('securityDrawer');
  const title = document.getElementById('securityDrawerTitle');
  const subtitle = document.getElementById('securityDrawerSubtitle');
  const content = document.getElementById('securityDrawerContent');

  title.textContent = subdomain;
  const duration = data.scan_duration_secs ? `${data.scan_duration_secs.toFixed(1)}s` : '—';
  subtitle.textContent = `${data.findings_count || data.findings.length} finding${(data.findings_count || data.findings.length) !== 1 ? 's' : ''} — scan duration: ${duration}`;

  const findings = data.findings || [];

  // Severity breakdown
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    const s = (f.severity || 'info').toLowerCase();
    if (counts[s] !== undefined) counts[s]++;
    else counts.info++;
  }
  const total = findings.length || 1;

  let barHtml = '<div class="severity-bar">';
  for (const [sev, count] of Object.entries(counts)) {
    if (count === 0) continue;
    const pct = ((count / total) * 100).toFixed(1);
    barHtml += `<div class="severity-bar-segment severity-bar-${sev}" style="width:${pct}%" title="${sev}: ${count}"></div>`;
  }
  barHtml += '</div>';

  const legendParts = [];
  for (const [sev, count] of Object.entries(counts)) {
    if (count > 0) legendParts.push(`<span class="severity-legend-item"><span class="severity-legend-dot severity-dot-${sev}"></span>${count} ${sev}</span>`);
  }
  const legendHtml = `<div class="severity-legend">${legendParts.join('')}</div>`;

  // Finding cards
  let cardsHtml = '';
  for (const f of findings) {
    const sev = (f.severity || 'info').toLowerCase();
    const badgeClass = getSeverityBadgeClass(sev);
    const tagsHtml = (f.tags || []).map(t => `<span class="security-tag">${escHtml(t)}</span>`).join('');

    cardsHtml += `<div class="security-finding-card security-card-${sev}">
      <div class="security-finding-top">
        <span class="severity-badge ${badgeClass}">${escHtml(sev.toUpperCase())}</span>
        <span class="security-finding-name">${escHtml(f.name || '')}</span>
      </div>
      <div class="security-finding-template">${escHtml(f.template_id || '')}</div>
      ${f.description ? `<div class="security-finding-desc">${escHtml(f.description)}</div>` : ''}
      ${f.matched_at ? `<div class="security-finding-match"><span class="security-match-label">Matched:</span> <a href="${escHtml(f.matched_at)}" target="_blank" rel="noopener">${escHtml(f.matched_at)}</a></div>` : ''}
      ${tagsHtml ? `<div class="security-finding-tags">${tagsHtml}</div>` : ''}
    </div>`;
  }

  content.innerHTML = barHtml + legendHtml + cardsHtml;
  drawer.classList.add('open');

}

function closeSecurityDrawer() {
  document.getElementById('securityDrawer').classList.remove('open');

}

/* Open Ports — pill + drawer */

const SENSITIVE_PORTS = new Set([21, 22, 23, 25, 135, 139, 445, 1433, 1521, 3306, 3389, 5432, 5900, 6379, 8443, 9200, 27017]);
const WEB_PORTS = new Set([80, 443, 8080, 8443]);

function applyOpenPortsPill(subdomain) {
  const data = appState.openPorts[subdomain];
  if (!data) { console.warn(`[open-ports] No data for ${subdomain}`); return; }

  const span = document.querySelector(`.subdomain-table span[data-subdomain="${CSS.escape(subdomain)}"]`);
  if (!span) { console.warn(`[open-ports] No DOM element for subdomain: ${subdomain}`); return; }
  if (span.querySelector('.open-ports-pill')) return;

  const ports = data.open_ports || [];
  if (ports.length === 0) return;

  const colorClass = 'security-pill-orange';

  const label = ports.length === 1 ? '1 port' : `${ports.length} ports`;
  const pill = document.createElement('span');
  pill.className = `open-ports-pill ${colorClass}`;
  pill.textContent = label;
  pill.setAttribute('onclick', `event.stopPropagation(); openOpenPortsDrawer('${subdomain.replace(/'/g, "\\'")}')`);

  span.appendChild(document.createTextNode(' '));
  span.appendChild(pill);
  console.log(`[open-ports] Applied to ${subdomain} (${ports.length} ports)`);
}

function openOpenPortsDrawer(subdomain) {
  const data = appState.openPorts[subdomain];
  if (!data) return;

  const drawer = document.getElementById('openPortsDrawer');
  const title = document.getElementById('openPortsDrawerTitle');
  const subtitle = document.getElementById('openPortsDrawerSubtitle');
  const content = document.getElementById('openPortsDrawerContent');

  title.textContent = subdomain;
  const duration = data.scan_duration_secs ? `${data.scan_duration_secs.toFixed(1)}s` : '—';
  const ip = data.ip || '—';
  subtitle.textContent = `${data.open_ports.length} open port${data.open_ports.length !== 1 ? 's' : ''} — IP: ${ip} — scan: ${duration}`;

  const ports = data.open_ports || [];
  let html = '<table class="open-ports-table"><thead><tr><th>Port</th><th>Protocol</th><th>Service</th></tr></thead><tbody>';
  for (const p of ports) {
    const port = p.port || '—';
    const proto = p.protocol || 'tcp';
    const service = p.service || '—';
    const risk = (p.risk_level || '').toLowerCase();
    const badgeClass = `port-badge-${risk || 'blue'}`;
    const tooltip = p.description ? ` title="${escHtml(p.description)}"` : '';
    html += `<tr class="port-row"${tooltip}>
      <td><span class="port-badge ${badgeClass}">${port}</span></td>
      <td>${escHtml(proto)}</td>
      <td>${escHtml(service)}</td>
    </tr>`;
  }
  html += '</tbody></table>';

  content.innerHTML = html;
  drawer.classList.add('open');

}

function closeOpenPortsDrawer() {
  document.getElementById('openPortsDrawer').classList.remove('open');

}

/* Agentic Discovery — pill + drawer */

function applyAgenticPill(subdomain) {
  const data = appState.agentic[subdomain];
  if (!data) { console.warn(`[agentic] No data for ${subdomain}`); return; }

  const span = document.querySelector(`.subdomain-table span[data-subdomain="${CSS.escape(subdomain)}"]`);
  if (!span) { console.warn(`[agentic] No DOM element for subdomain: ${subdomain}`); return; }
  if (span.querySelector('.agentic-pill')) return;

  const findings = data.findings || [];
  if (findings.length === 0) return;

  const pill = document.createElement('span');
  pill.className = 'agentic-pill security-pill-blue';
  pill.textContent = `${findings.length} agentic`;
  pill.setAttribute('onclick', `event.stopPropagation(); openAgenticDrawer('${subdomain.replace(/'/g, "\\'")}')`);

  span.appendChild(document.createTextNode(' '));
  span.appendChild(pill);
  console.log(`[agentic] Applied to ${subdomain} (${findings.length} findings)`);
}

function openAgenticDrawer(subdomain) {
  const data = appState.agentic[subdomain];
  if (!data) return;

  const drawer = document.getElementById('agenticDrawer');
  const title = document.getElementById('agenticDrawerTitle');
  const subtitle = document.getElementById('agenticDrawerSubtitle');
  const content = document.getElementById('agenticDrawerContent');

  title.textContent = subdomain;
  const duration = data.scan_duration_secs ? `${data.scan_duration_secs.toFixed(1)}s` : '—';
  const count = data.findings ? data.findings.length : 0;
  subtitle.textContent = `${count} finding${count !== 1 ? 's' : ''} — scan duration: ${duration}`;

  const findings = data.findings || [];
  let html = '';
  const _agenticSpecsToFetch = [];
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const statusCls = f.status_code >= 200 && f.status_code < 300 ? 'status-2xx'
      : f.status_code >= 300 && f.status_code < 400 ? 'status-3xx'
      : f.status_code >= 400 && f.status_code < 500 ? 'status-4xx'
      : f.status_code >= 500 ? 'status-5xx' : '';
    const sseBadge = f.is_sse ? '<span class="agentic-sse-badge">SSE</span>' : '';
    const linkHtml = f.file_url
      ? `<a href="${escHtml(f.file_url)}" target="_blank" rel="noopener" class="agentic-finding-link">View source</a>`
      : '';

    // Detect ai-plugin.json and extract spec URL for auto-parsing
    const isAiPlugin = (f.path || '').includes('ai-plugin') || (f.name || '').toLowerCase().includes('ai-plugin');
    let specContainerHtml = '';
    if (isAiPlugin && f.body_preview) {
      try {
        const pluginJson = JSON.parse(f.body_preview);
        const specUrl = pluginJson?.api?.url;
        if (specUrl) {
          const cid = `agentic-spec-${i}`;
          specContainerHtml = `<div id="${cid}" class="agentic-spec-endpoints"></div>`;
          _agenticSpecsToFetch.push({ url: specUrl, containerId: cid });
        }
      } catch (e) { /* not valid JSON, skip */ }
    }

    html += `<div class="agentic-finding-card">
      <div class="agentic-finding-top">
        <span class="agentic-finding-name">${escHtml(f.name)}</span>
        ${sseBadge}
      </div>
      <div class="agentic-finding-path">${escHtml(f.path)}</div>
      ${f.description ? `<div class="agentic-finding-desc">${escHtml(f.description)}</div>` : ''}
      ${f.body_preview ? `<pre class="agentic-body-preview">${escHtml(f.body_preview)}</pre>` : ''}
      ${specContainerHtml}
      <div class="agentic-finding-meta">
        ${f.status_code ? `<span class="agentic-status-badge ${statusCls}">${f.status_code}</span>` : ''}
        ${f.content_type ? `<span class="agentic-content-type">${escHtml(f.content_type)}</span>` : ''}
        ${linkHtml}
      </div>
    </div>`;
  }

  // MCP section — rendered when the scanner performed an MCP handshake
  if (data.mcp) {
    const mcp = data.mcp;
    const conf = mcp.confidence || 0;
    const confCls = conf >= 70 ? 'agentic-mcp-confidence-green'
      : conf >= 30 ? 'agentic-mcp-confidence-yellow'
      : 'agentic-mcp-confidence-red';

    html += `<div class="agentic-mcp-section">`;
    html += `<div class="agentic-mcp-header">
      <span class="agentic-mcp-title">MCP Server</span>
      <span class="agentic-mcp-confidence ${confCls}">${conf}% confidence</span>
    </div>`;

    // Server info row
    const sName = mcp.server_info ? escHtml(mcp.server_info.name) : '—';
    const sVer = mcp.server_info && mcp.server_info.version ? escHtml(mcp.server_info.version) : '';
    const transport = escHtml(mcp.transport || 'unknown');
    const proto = mcp.protocol_version ? escHtml(mcp.protocol_version) : '';
    html += `<div class="agentic-mcp-server-row">
      <span class="agentic-mcp-server-name">${sName}</span>
      ${sVer ? `<span class="agentic-mcp-server-ver">${sVer}</span>` : ''}
      <span class="agentic-mcp-transport">${transport}</span>
      ${proto ? `<span class="agentic-mcp-proto">${proto}</span>` : ''}
    </div>`;

    // Tools
    if (mcp.tools && mcp.tools.length > 0) {
      html += `<details class="agentic-mcp-group"><summary>${mcp.tools.length} Tool${mcp.tools.length !== 1 ? 's' : ''}</summary>`;
      for (const t of mcp.tools) {
        html += `<div class="agentic-mcp-item">
          <span class="agentic-mcp-item-name">${escHtml(t.name)}</span>
          ${t.description ? `<span class="agentic-mcp-item-desc">${escHtml(t.description)}</span>` : ''}
        </div>`;
      }
      html += `</details>`;
    }

    // Resources
    if (mcp.resources && mcp.resources.length > 0) {
      html += `<details class="agentic-mcp-group"><summary>${mcp.resources.length} Resource${mcp.resources.length !== 1 ? 's' : ''}</summary>`;
      for (const r of mcp.resources) {
        html += `<div class="agentic-mcp-item">
          <span class="agentic-mcp-item-name">${escHtml(r.name)}</span>
          <span class="agentic-mcp-item-uri">${escHtml(r.uri)}</span>
          ${r.description ? `<span class="agentic-mcp-item-desc">${escHtml(r.description)}</span>` : ''}
        </div>`;
      }
      html += `</details>`;
    }

    // Prompts
    if (mcp.prompts && mcp.prompts.length > 0) {
      html += `<details class="agentic-mcp-group"><summary>${mcp.prompts.length} Prompt${mcp.prompts.length !== 1 ? 's' : ''}</summary>`;
      for (const p of mcp.prompts) {
        html += `<div class="agentic-mcp-item">
          <span class="agentic-mcp-item-name">${escHtml(p.name)}</span>
          ${p.description ? `<span class="agentic-mcp-item-desc">${escHtml(p.description)}</span>` : ''}
        </div>`;
      }
      html += `</details>`;
    }

    // Registry match
    if (mcp.registry) {
      const reg = mcp.registry;
      html += `<details class="agentic-mcp-group" open><summary>Registry Match</summary>`;
      html += `<div class="agentic-mcp-registry">`;
      if (reg.server_name) html += `<div class="agentic-mcp-registry-row"><span class="agentic-mcp-registry-label">Server</span><span>${escHtml(reg.server_name)}</span></div>`;
      if (reg.description) html += `<div class="agentic-mcp-registry-row"><span class="agentic-mcp-registry-label">Description</span><span>${escHtml(reg.description)}</span></div>`;
      if (reg.version) html += `<div class="agentic-mcp-registry-row"><span class="agentic-mcp-registry-label">Version</span><span>${escHtml(reg.version)}</span></div>`;
      if (reg.remote_url) html += `<div class="agentic-mcp-registry-row"><span class="agentic-mcp-registry-label">Endpoint</span><a href="${escHtml(reg.remote_url)}" target="_blank" rel="noopener">${escHtml(reg.remote_url)}</a></div>`;
      if (reg.remote_type) html += `<div class="agentic-mcp-registry-row"><span class="agentic-mcp-registry-label">Transport</span><span class="agentic-mcp-transport">${escHtml(reg.remote_type)}</span></div>`;
      if (reg.website_url) html += `<div class="agentic-mcp-registry-row"><span class="agentic-mcp-registry-label">Website</span><a href="${escHtml(reg.website_url)}" target="_blank" rel="noopener">${escHtml(reg.website_url)}</a></div>`;
      if (reg.repo_url) html += `<div class="agentic-mcp-registry-row"><span class="agentic-mcp-registry-label">Repo</span><a href="${escHtml(reg.repo_url)}" target="_blank" rel="noopener">${escHtml(reg.repo_url)}</a></div>`;
      html += `</div></details>`;
    }

    // Evidence trail
    if (mcp.evidence && mcp.evidence.length > 0) {
      html += `<details class="agentic-mcp-group"><summary>Evidence</summary>`;
      html += `<ul class="agentic-mcp-evidence">`;
      for (const e of mcp.evidence) {
        html += `<li>${escHtml(e)}</li>`;
      }
      html += `</ul></details>`;
    }

    // Errors
    if (mcp.errors && mcp.errors.length > 0) {
      html += `<div class="agentic-mcp-errors">`;
      for (const err of mcp.errors) {
        html += `<div class="agentic-mcp-error-item">${escHtml(err)}</div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
  }

  content.innerHTML = html;
  drawer.classList.add('open');

  // Auto-fetch OpenAPI specs linked from ai-plugin.json findings
  for (const job of _agenticSpecsToFetch) {
    fetchSpecEndpoints(job.url, job.containerId);
  }

}

function closeAgenticDrawer() {
  document.getElementById('agenticDrawer').classList.remove('open');

}

/* API Spec Discovery — pill + drawer */

function applyApiSpecPill(subdomain) {
  const data = appState.apiSpecs[subdomain];
  if (!data) return;

  const span = document.querySelector(`.subdomain-table span[data-subdomain="${CSS.escape(subdomain)}"]`);
  if (!span) { console.warn(`[api-spec] No DOM element for subdomain: ${subdomain}`); return; }
  if (span.querySelector('.apispec-pill')) return;

  const count = data.findings_count || data.findings?.length || 0;
  if (count === 0) return;

  const pill = document.createElement('span');
  pill.className = 'apispec-pill';
  const label = count === 1 ? '1 Spec' : `${count} Specs`;
  pill.textContent = label;
  pill.setAttribute('onclick', `event.stopPropagation(); openApiSpecDrawer('${subdomain.replace(/'/g, "\\'")}')`);

  span.appendChild(document.createTextNode(' '));
  span.appendChild(pill);
  console.log(`[api-spec] Applied to ${subdomain} (${findings.length} findings)`);
}

function openApiSpecDrawer(subdomain) {
  const data = appState.apiSpecs[subdomain];
  if (!data) return;

  const drawer = document.getElementById('apiSpecDrawer');
  const title = document.getElementById('apiSpecDrawerTitle');
  const subtitle = document.getElementById('apiSpecDrawerSubtitle');
  const content = document.getElementById('apiSpecDrawerContent');

  title.textContent = subdomain;
  const duration = data.scan_duration_secs ? `${data.scan_duration_secs.toFixed(1)}s` : '\u2014';
  const count = data.findings_count || data.findings?.length || 0;
  subtitle.textContent = `${count} spec${count !== 1 ? 's' : ''} found \u2014 scan duration: ${duration}`;

  const findings = data.findings || [];
  const categoryColors = {
    openapi_spec: '#059669',
    api_docs_ui: '#3b82f6',
    graphql: '#ec4899',
    wsdl: '#f97316',
    api_root: '#6b7280',
    api_catalog: '#14b8a6',
  };

  // Group findings by category
  const groups = {};
  for (const f of findings) {
    const cat = f.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(f);
  }

  let html = '';
  const _specEndpointsToFetch = [];

  // Render grouped findings
  for (const [cat, items] of Object.entries(groups)) {
    const borderColor = categoryColors[cat] || '#6b7280';
    const catLabel = cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    html += `<div class="apispec-category-header" style="border-left-color:${borderColor}">${escHtml(catLabel)} (${items.length})</div>`;
    for (let fi = 0; fi < items.length; fi++) {
      const f = items[fi];
      const epContainerId = `spec-ep-${cat}-${fi}`;
      html += `<div class="apispec-finding-card" style="border-left-color:${borderColor}">
        <div class="apispec-finding-top">
          <span class="apispec-finding-name">${escHtml(f.name)}</span>
          ${f.spec_version ? `<span class="apispec-version-badge">${escHtml(f.spec_version)}</span>` : ''}
        </div>
        ${f.description ? `<div class="apispec-finding-desc">${escHtml(f.description)}</div>` : ''}
        <div class="apispec-finding-path">${escHtml(f.path)}</div>
        ${f.file_url ? `<a href="${escHtml(f.file_url)}" target="_blank" rel="noopener" class="apispec-finding-link">${escHtml(f.file_url)}</a>` : ''}
        ${(f.category === 'openapi_spec' && f.file_url) ? `<div id="${epContainerId}"></div>` : ''}
      </div>`;
      if (f.category === 'openapi_spec' && f.file_url) {
        _specEndpointsToFetch.push({ url: f.file_url, containerId: epContainerId });
      }
    }
  }

  // Robots API paths
  const robotsPaths = data.robots_api_paths || [];
  if (robotsPaths.length > 0) {
    html += `<div class="apispec-category-header" style="border-left-color:#6b7280">Robots.txt API Paths (${robotsPaths.length})</div>`;
    html += '<div class="apispec-url-list">';
    for (const p of robotsPaths) {
      html += `<div class="apispec-url-item"><a href="${escHtml(p)}" target="_blank" rel="noopener">${escHtml(p)}</a></div>`;
    }
    html += '</div>';
  }

  // Sitemap API URLs
  const sitemapUrls = data.sitemap_api_urls || [];
  if (sitemapUrls.length > 0) {
    html += `<div class="apispec-category-header" style="border-left-color:#14b8a6">Sitemap API URLs (${sitemapUrls.length})</div>`;
    html += '<div class="apispec-url-list">';
    for (const u of sitemapUrls) {
      html += `<div class="apispec-url-item"><a href="${escHtml(u)}" target="_blank" rel="noopener">${escHtml(u)}</a></div>`;
    }
    html += '</div>';
  }

  // GraphQL section
  if (data.graphql) {
    const gql = data.graphql;
    html += `<div class="apispec-category-header" style="border-left-color:#ec4899">GraphQL</div>`;
    html += `<div class="apispec-graphql-section">`;
    const gqlUrl = data.url ? `${data.url.replace(/\/$/, '')}${gql.endpoint}` : gql.endpoint;
    html += `<div class="apispec-graphql-row"><span class="apispec-graphql-label">Endpoint</span><a href="${escHtml(gqlUrl)}" target="_blank" rel="noopener">${escHtml(gql.endpoint)}</a></div>`;
    html += `<div class="apispec-graphql-row"><span class="apispec-graphql-label">Introspection</span><span class="${gql.introspection_enabled ? 'apispec-graphql-enabled' : 'apispec-graphql-disabled'}">${gql.introspection_enabled ? 'Enabled' : 'Disabled'}</span></div>`;
    if (gql.type_count > 0) {
      html += `<div class="apispec-graphql-row"><span class="apispec-graphql-label">Types</span><span>${gql.type_count}</span></div>`;
    }
    if (gql.type_names && gql.type_names.length > 0) {
      html += `<details class="apispec-graphql-types"><summary>${gql.type_names.length} type names</summary>`;
      html += `<div class="apispec-graphql-type-list">${gql.type_names.map(t => `<span class="apispec-graphql-type">${escHtml(t)}</span>`).join('')}</div>`;
      html += `</details>`;
    }
    html += `</div>`;
  }

  content.innerHTML = html;
  drawer.classList.add('open');


  // Kick off async endpoint fetches after DOM is ready
  for (const job of _specEndpointsToFetch) {
    fetchSpecEndpoints(job.url, job.containerId);
  }
}

function closeApiSpecDrawer() {
  document.getElementById('apiSpecDrawer').classList.remove('open');

}

/* Fetch + render parsed endpoints from an OpenAPI/Swagger JSON spec */
async function fetchSpecEndpoints(specUrl, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div class="spec-endpoints-loading"><span class="js-pill-spin">⟳</span> Loading endpoints...</div>';
  try {
    const resp = await fetch(`/api/fetch-spec?url=${encodeURIComponent(specUrl)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.error) {
      container.innerHTML = `<div class="spec-endpoints-error">${escHtml(data.error)}</div>`;
      return;
    }
    const eps = data.endpoints || [];
    if (eps.length === 0) {
      container.innerHTML = '<div class="spec-endpoints-error">No endpoints found in spec</div>';
      return;
    }
    const titlePart = data.title ? ` — ${escHtml(data.title)}` : '';
    const verPart = data.spec_version ? ` (${escHtml(data.spec_version)})` : '';
    let html = `<details class="spec-endpoints-section" open>`;
    html += `<summary>${eps.length} endpoint${eps.length !== 1 ? 's' : ''}${titlePart}${verPart}</summary>`;
    html += '<div class="spec-endpoints-table-wrap"><table class="spec-endpoints-table">';
    html += '<thead><tr><th>Method</th><th>Path</th></tr></thead><tbody>';
    for (const ep of eps) {
      const mCls = 'm-' + ep.method.toLowerCase();
      const tipAttr = ep.description ? ` title="${escHtml(ep.description)}"` : '';
      html += `<tr${tipAttr}>
        <td><span class="spec-ep-method ${mCls}">${escHtml(ep.method)}</span></td>
        <td class="spec-ep-path">${escHtml(ep.path)}</td>
      </tr>`;
    }
    html += '</tbody></table></div></details>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="spec-endpoints-error">Failed to load: ${escHtml(err.message)}</div>`;
  }
}

/* Fixed-position thumbnail preview on hover — escapes overflow:auto clipping */
(function() {
  let preview = null;
  document.addEventListener('mouseover', function(e) {
    if (!e.target.classList.contains('subdomain-thumb')) return;
    const rect = e.target.getBoundingClientRect();
    preview = document.createElement('img');
    preview.className = 'subdomain-thumb-preview';
    preview.src = e.target.src;
    // Position to the left of the thumbnail, vertically centered
    preview.style.top = (rect.top + rect.height / 2 - 135) + 'px';
    preview.style.right = (window.innerWidth - rect.left + 8) + 'px';
    document.body.appendChild(preview);
  });
  document.addEventListener('mouseout', function(e) {
    if (!e.target.classList.contains('subdomain-thumb')) return;
    if (preview) { preview.remove(); preview = null; }
  });
})();
