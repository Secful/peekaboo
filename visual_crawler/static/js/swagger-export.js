/**
 * Swagger/OpenAPI Export for History Scans
 * Exports discovered API endpoints as OpenAPI 3.0 JSON specification
 * Uses Drain3 backend for intelligent path parameterization
 */

/**
 * Main entry point: Export current history scan as Swagger JSON
 */
async function exportHistoryAsSwagger() {
  // Collect all endpoints from different sources
  const allEndpoints = collectAllEndpoints();

  if (allEndpoints.length === 0) {
    alert('No API endpoints found in this scan to export');
    return;
  }

  try {
    // Show loading indicator
    const button = event.target;
    const originalText = button.textContent;
    button.textContent = 'Exporting...';
    button.disabled = true;

    // Call backend API to generate OpenAPI spec with Drain3
    const scanDate = _historyDetailScan.started_at
      ? new Date(_historyDetailScan.started_at).toLocaleDateString()
      : new Date().toLocaleDateString();

    const response = await fetch('/api/export-swagger', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        domain: _historyDetailScan.domain,
        scan_date: scanDate,
        endpoints: allEndpoints
      })
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.status} ${response.statusText}`);
    }

    const spec = await response.json();

    // Download as JSON
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().split('T')[0];
    a.download = `salt-swagger-${_historyDetailScan.domain}-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Restore button
    button.textContent = originalText;
    button.disabled = false;

  } catch (error) {
    alert(`Export failed: ${error.message}`);
    console.error('Swagger export error:', error);

    // Restore button
    if (button) {
      button.textContent = originalText;
      button.disabled = false;
    }
  }
}

/**
 * Collect and normalize endpoints from all sources (web-traffic, js, apk)
 * @returns {Array} Array of normalized endpoint objects with source annotation
 */
function collectAllEndpoints() {
  const endpoints = [];

  // 1. Web traffic endpoints
  const webEndpoints = _historyDetailScan?._filteredEndpoints || [];
  console.log('Collecting web endpoints:', webEndpoints.length);
  if (webEndpoints.length > 0) {
    console.log('Sample endpoint:', webEndpoints[0]);
    console.log('Has llm_description?', webEndpoints[0].llm_description);
  }

  webEndpoints.forEach(ep => {
    if (ep.path && ep.method) {
      endpoints.push({
        method: ep.method,
        path: ep.path,
        source: 'web-traffic',
        summary: ep.llm_description || null
      });
    }
  });

  // 2. JS-based APIs (extracted_apis)
  const extractedApis = _historyDetailScan?.scanner?.extracted_apis || {};
  let jsCount = 0;
  Object.keys(extractedApis).forEach(subdomain => {
    const data = extractedApis[subdomain];
    const findings = data.findings || [];
    findings.forEach(f => {
      // Extract path from url, endpoint, or path field
      const pathStr = extractPath(f.url || f.endpoint || f.path);
      const method = (f.method || 'GET').toUpperCase();

      if (pathStr && method) {
        const summary = f.description || f.context || f.summary || null;
        if (jsCount === 0) {
          console.log('Sample JS finding:', f);
          console.log('JS summary value:', summary);
        }
        jsCount++;
        endpoints.push({
          method: method,
          path: pathStr,
          source: 'js',
          summary: summary
        });
      }
    });
  });
  console.log('Total JS endpoints:', jsCount);

  // 3. Mobile/APK endpoints
  const mobileEndpoints = _historyDetailScan?.scanner?.mobile_endpoints || {};
  let apkCount = 0;
  Object.keys(mobileEndpoints).forEach(packageName => {
    const data = mobileEndpoints[packageName];
    const findings = data.findings || [];
    findings.forEach(f => {
      // Extract relative path only (strip domain/protocol)
      const pathStr = extractRelativePath(f.url);
      const method = (f.method || 'GET').toUpperCase();

      if (pathStr && method) {
        const summary = f.description || f.context || f.summary || null;
        if (apkCount === 0) {
          console.log('Sample APK finding:', f);
          console.log('APK summary value:', summary);
        }
        apkCount++;
        endpoints.push({
          method: method,
          path: pathStr,
          source: 'apk',
          summary: summary
        });
      }
    });
  });
  console.log('Total APK endpoints:', apkCount);

  return endpoints;
}

/**
 * Extract path from full URL or return as-is if already a path
 * Strips query parameters to keep paths clean
 * @param {string} urlOrPath - Full URL or path
 * @returns {string} Path component without query parameters
 */
function extractPath(urlOrPath) {
  if (!urlOrPath) return '';

  try {
    // If it looks like a full URL, parse it
    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
      const url = new URL(urlOrPath);
      return url.pathname; // Only pathname, no search/query params
    }

    // Strip query parameters if present
    const queryIndex = urlOrPath.indexOf('?');
    if (queryIndex !== -1) {
      return urlOrPath.substring(0, queryIndex);
    }

    // Otherwise assume it's already a clean path
    return urlOrPath;
  } catch (e) {
    // If URL parsing fails, try to strip query params manually
    const queryIndex = urlOrPath.indexOf('?');
    if (queryIndex !== -1) {
      return urlOrPath.substring(0, queryIndex);
    }
    return urlOrPath;
  }
}

/**
 * Extract relative path only (strip domain, protocol, and query parameters)
 * Used for APK endpoints to ensure only clean paths are exported
 * @param {string} urlOrPath - Full URL or path
 * @returns {string} Relative path only without query params (e.g., /users/something)
 */
function extractRelativePath(urlOrPath) {
  if (!urlOrPath) return '';

  try {
    // If it looks like a full URL, parse and return only pathname (no query params)
    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
      const url = new URL(urlOrPath);
      return url.pathname; // Only pathname, no search/query params
    }

    // Strip query parameters first
    let cleanPath = urlOrPath;
    const queryIndex = cleanPath.indexOf('?');
    if (queryIndex !== -1) {
      cleanPath = cleanPath.substring(0, queryIndex);
    }

    // If it already starts with /, it's a relative path
    if (cleanPath.startsWith('/')) {
      return cleanPath;
    }

    // If it looks like domain/path, try to extract just the path
    // e.g., "example.com/users/something" -> "/users/something"
    const slashIndex = cleanPath.indexOf('/');
    if (slashIndex > 0) {
      return cleanPath.substring(slashIndex);
    }

    // Otherwise, prepend / if it doesn't have one
    return '/' + cleanPath;
  } catch (e) {
    // If anything fails, try to make it a relative path
    let cleanPath = urlOrPath;
    const queryIndex = cleanPath.indexOf('?');
    if (queryIndex !== -1) {
      cleanPath = cleanPath.substring(0, queryIndex);
    }

    if (cleanPath.startsWith('/')) {
      return cleanPath;
    }
    return '/' + cleanPath;
  }
}

/**
 * Export HTML report for historical scan
 * Downloads pre-generated HTML report from S3
 */
async function exportHistoryAsHTML() {
  if (!_historyDetailScan || !_historyDetailScan.domain || !_historyDetailScan.scan_id) {
    alert('No scan selected');
    return;
  }

  const button = event.target;
  const originalText = button.textContent;

  try {
    button.textContent = 'Downloading...';
    button.disabled = true;

    const url = `/api/scan-history/${_historyDetailScan.domain}/${_historyDetailScan.scan_id}/report`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('HTML report not available for this scan');
      }
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    // Download HTML file
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;

    // Extract filename from Content-Disposition header or use default
    const disposition = response.headers.get('Content-Disposition');
    const filenameMatch = disposition && disposition.match(/filename="(.+)"/);
    a.download = filenameMatch ? filenameMatch[1] : `salt-api-discovery-${_historyDetailScan.domain}.html`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

  } catch (error) {
    alert(`Failed to download HTML report: ${error.message}`);
    console.error('HTML report download error:', error);
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
}
