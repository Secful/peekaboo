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

    html += `
      <tr id="sub-row-${idx}">
        <td style="text-align:center;color:var(--text-muted);font-size:0.85rem;">${idx + 1}</td>
        <td class="subdomain-name"><span id="crawl-td-${idx}" data-subdomain="${escHtml(name)}" title="${escHtml(title)}">${escHtml(name)}${aiBadgeHtml}${crawlBtnHtml}</span></td>
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
          ? `<span class="js-pill-divider"></span><span class="js-pill-right" id="js-pill-right-${idx}" title="Hunt for APIs" onclick="event.stopPropagation(); analyzeJsDeeper(event, ${idx}, '${escHtml(subdomain)}')">▶</span>`
          : '';
        wrapper.innerHTML = `${escHtml(subdomain)} <span class="js-pill" id="js-pill-${idx}"><span class="js-pill-left" title="Toggle JS file list" onclick="event.stopPropagation(); toggleJsPillFiles(${idx})">${urls.length} JS</span>${rightZone}</span>`;

        const expandRow2 = document.getElementById(`crawled-row-${idx}`);
        if (expandRow2) expandRow2.dataset.jsUrls = JSON.stringify(jsUrls);
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
          wrapper.innerHTML = `${escHtml(subdomain)} <span class="js-pill" id="js-pill-${idx}"><span class="js-pill-left" style="cursor:default">${jsOnly.length} JS</span><span class="js-pill-divider"></span><span class="js-pill-right" id="js-pill-right-${idx}" title="Hunt for APIs" onclick="event.stopPropagation(); analyzeJsDeeper(event, ${idx}, '${escHtml(subdomain)}')">▶</span></span>`;
          listDiv.innerHTML = `<div id="even-deeper-results-${idx}" class="even-deeper-results"></div>`;
        } else {
          wrapper.innerHTML = `${escHtml(subdomain)} <span class="crawl-done-empty">Nothing interesting here</span>`;
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

async function analyzeJsDeeper(event, idx, subdomain) {
  event.stopPropagation();
  const right = document.getElementById(`js-pill-right-${idx}`);
  const resultsDiv = document.getElementById(`even-deeper-results-${idx}`);

  // Prevent double-click while analyzing or after completion
  if (right && (right.classList.contains('analyzing') || right.classList.contains('has-apis') || right.classList.contains('no-apis'))) return;

  // Collect JS URLs from stored data attribute
  const expandRow = document.getElementById(`crawled-row-${idx}`);
  let jsUrls = [];
  try { jsUrls = JSON.parse(expandRow.dataset.jsUrls || '[]'); } catch {};

  if (jsUrls.length === 0) return;

  // Show spinner in the right zone of the pill
  if (right) {
    right.classList.add('analyzing');
    right.innerHTML = '<span class="js-pill-spin">⟳</span>';
    right.title = 'Analyzing JS files...';
  }

  if (resultsDiv) resultsDiv.innerHTML = '';

  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        if (right) right.innerHTML = `<span class="js-pill-spin">⟳</span> ${attempt}/${maxRetries}`;
        if (resultsDiv) resultsDiv.innerHTML = '';
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }

      const resp = await fetch('/api/analyze-js', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({urls: jsUrls.slice(0, 25)})
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const apis = data.apis || [];

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

      if (right) right.classList.remove('analyzing');

      if (dedupApis.length > 0) {
        appState.subdomainApis[idx] = { subdomain, apis: dedupApis, jsUrls };

        if (right) {
          right.classList.add('has-apis');
          right.textContent = `${dedupApis.length} APIs`;
          right.title = 'Open API drawer';
          right.setAttribute('onclick', `event.stopPropagation(); openApiDrawer(${idx})`);
        }

        if (resultsDiv) resultsDiv.innerHTML = '';

        // Collapse file list
        const urlListFound = document.getElementById(`url-list-${idx}`);
        if (urlListFound) urlListFound.classList.add('collapsed');
        const left = document.querySelector(`#js-pill-${idx} .js-pill-left`);
        if (left) left.classList.remove('active');

        openApiDrawer(idx);
      } else {
        if (right) {
          right.classList.add('no-apis');
          right.textContent = '0 APIs';
          right.title = 'No APIs found';
          right.removeAttribute('onclick');
        }
      }
      return;
    } catch (err) {
      if (attempt === maxRetries) {
        if (right) {
          right.classList.remove('analyzing');
          right.textContent = '✗';
          right.title = `Analysis failed: ${err.message}`;
          right.style.color = 'var(--delete)';
        }
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
    span.appendChild(document.createTextNode(' '));
    const empty = document.createElement('span');
    empty.className = 'crawl-done-empty';
    empty.textContent = 'Nothing interesting here';
    span.appendChild(empty);
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
      right.className = 'js-pill-right';
      right.id = `js-pill-right-${idx}`;
      right.textContent = '▶';
      right.title = 'Hunt for APIs';
      right.setAttribute('onclick', `event.stopPropagation(); analyzeJsDeeper(event, ${idx}, '${subdomain.replace(/'/g, "\\'")}')`);
      pill.appendChild(right);
    }

    span.appendChild(pill);

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

    // Store JS URLs in data attribute so analyzeJsDeeper can find them
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
  const data = appState.securityInsights[subdomain];
  if (!data) { console.warn(`[security-pill] No data for ${subdomain}`); return; }

  // Find the subdomain row by data attribute
  const span = document.querySelector(`.subdomain-table span[data-subdomain="${CSS.escape(subdomain)}"]`);
  if (!span) { console.warn(`[security-pill] No DOM element for subdomain: ${subdomain}`); return; }
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
    const isSensitive = SENSITIVE_PORTS.has(p.port);
    const badgeClass = isSensitive ? 'port-badge-sensitive' : 'port-badge-normal';
    html += `<tr class="port-row">
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
  for (const f of findings) {
    const statusCls = f.status_code >= 200 && f.status_code < 300 ? 'status-2xx'
      : f.status_code >= 300 && f.status_code < 400 ? 'status-3xx'
      : f.status_code >= 400 && f.status_code < 500 ? 'status-4xx'
      : f.status_code >= 500 ? 'status-5xx' : '';
    const sseBadge = f.is_sse ? '<span class="agentic-sse-badge">SSE</span>' : '';
    const linkHtml = f.file_url
      ? `<a href="${escHtml(f.file_url)}" target="_blank" rel="noopener" class="agentic-finding-link">View source</a>`
      : '';

    html += `<div class="agentic-finding-card">
      <div class="agentic-finding-top">
        <span class="agentic-finding-name">${escHtml(f.name)}</span>
        ${sseBadge}
      </div>
      <div class="agentic-finding-path">${escHtml(f.path)}</div>
      ${f.description ? `<div class="agentic-finding-desc">${escHtml(f.description)}</div>` : ''}
      ${f.body_preview ? `<pre class="agentic-body-preview">${escHtml(f.body_preview)}</pre>` : ''}
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
}

function closeAgenticDrawer() {
  document.getElementById('agenticDrawer').classList.remove('open');
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
