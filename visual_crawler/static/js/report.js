/* HTML report export */
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
  const apiEndpoints = appState.endpoints.filter(ep => ep.api_confidence === 'API' || ep.method === 'GET*');
  const maybeApiEndpoints = appState.endpoints.filter(ep => ep.api_confidence === 'Maybe API' && ep.method !== 'GET*');
  const otherEndpoints = appState.endpoints.filter(ep => (!ep.api_confidence || ep.api_confidence === 'Not API') && ep.method !== 'GET*');

  // Generate HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Peekaboo API Discovery Report - ${appState.targetDomain}</title>
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

      <div class="report-title">\u{1F440} Peekaboo API Discovery Report</div>
      <div class="report-subtitle">Revealing Hidden APIs in Plain Sight</div>

      <div class="target-info">
        <div class="target-label">Target Domain</div>
        <div class="target">${appState.targetDomain}</div>
      </div>

      <div class="meta">Generated on ${scanDate}</div>
    </div>

    ${appState.capturedScreenshots.length > 0 ? `
    <div class="screenshot-section">
      <div class="screenshot-header" style="cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;" onclick="toggleScreenshots()">
        <span>\u{1F4F8} Application Screenshots (${appState.capturedScreenshots.length})</span>
        <span id="screenshotToggleIcon" style="font-size:1.2rem;transition:transform 0.3s ease;">\u25BC</span>
      </div>
      <div id="screenshotCarouselContent">
      <div class="carousel-container">
        <div class="carousel-wrapper">
          <div class="carousel-slides" id="carouselSlides">
            ${appState.capturedScreenshots.map((screenshot, index) => `
              <div class="carousel-slide">
                <img src="data:image/jpeg;base64,${screenshot.image}" alt="Screenshot ${index + 1} of ${appState.targetDomain}">
                <div class="carousel-slide-caption">
                  <div style="font-size: 0.75rem; color: #8b92a7; margin-bottom: 0.3rem; text-transform: uppercase; letter-spacing: 0.05em;">Source URL</div>
                  ${screenshot.url}
                </div>
              </div>
            `).join('')}
          </div>
          ${appState.capturedScreenshots.length > 1 ? `
            <button class="carousel-nav prev" onclick="moveCarousel(-1)" aria-label="Previous">\u2039</button>
            <button class="carousel-nav next" onclick="moveCarousel(1)" aria-label="Next">\u203A</button>
          ` : ''}
        </div>
      </div>
      ${appState.capturedScreenshots.length > 1 ? `
        <div class="carousel-dots" id="carouselDots">
          ${appState.capturedScreenshots.map((_, index) => `
            <div class="carousel-dot ${index === 0 ? 'active' : ''}" onclick="goToSlide(${index})"></div>
          `).join('')}
        </div>
        <div class="carousel-counter">
          <span id="currentSlide">1</span> of ${appState.capturedScreenshots.length}
        </div>
      ` : ''}
      </div>
    </div>
    ` : ''}

    <div class="section">
      <div class="section-title">\u{1F4CA} Scan Summary</div>
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
      <div class="section-title">\u{1F3E0} Target & Subdomains (<span id="subdomainCount">${subdomains.length}</span>)</div>
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
      <div class="section-title">\u{1F310} External Domains (<span id="externalCount">${externals.length}</span>)</div>
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

    ${appState.detectedTechnologies ? `
    <div class="section">
      <div class="section-title">\u{1F527} Detected Technologies</div>

      ${(() => {
        const tech = appState.detectedTechnologies;
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
              <span>\u{1F4BB}</span> Server-Side Languages
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
              <span>\u{1F310}</span> Web Servers
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
              <span>\u26A1</span> Content Delivery Networks
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
              <span>\u{1F3D7}\uFE0F</span> Frameworks & Libraries
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
              <span>\u2699\uFE0F</span> Other Technologies
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
        return host === appState.targetDomain || host.endsWith('.' + appState.targetDomain);
      });

      // Limit to 5 endpoints
      const previewEndpoints = domainEndpoints.slice(0, 5);
      const hasMore = domainEndpoints.length > 5;

      return previewEndpoints.length > 0 ? `
    <div class="section">
      <div class="section-title">\u2705 Confirmed API Endpoints (Showing ${previewEndpoints.length} of ${domainEndpoints.length})</div>

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
        <div class="cta-title">\u{1F50D} Wanna See More?</div>
        <div class="cta-subtitle">
          This report shows a preview of ${previewEndpoints.length} API endpoints.<br>
          ${domainEndpoints.length - previewEndpoints.length} more endpoints discovered for ${appState.targetDomain}
        </div>
        <a href="https://salt.security/contact-us" target="_blank" class="cta-button">
          \u{1F4E7} Contact Salt Security
        </a>
      </div>
      ` : ''}
    </div>
      ` : '';
    })()}

    ${maybeApiEndpoints.length > 0 ? `
    <div class="section">
      <div class="section-title">\u26A0\uFE0F Potential API Endpoints (<span id="maybeCount">${maybeApiEndpoints.length}</span>)</div>

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
      if (!appState.subdomainResults) return '';
      const subs = normalizeSubdomains(appState.subdomainResults);
      if (subs.length === 0) return '';
      const liveCount = subs.filter(s => s.status_code && s.status_code >= 200 && s.status_code < 400).length;
      return `
    <div class="section">
      <div class="section-title">\u{1F310} Subdomain Discovery (${subs.length} found, ${liveCount} live)</div>
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
              const name = getSubdomainName(sub);
              const status = sub.status_code || sub.status || 0;
              const title = sub.title || '\u2014';
              const server = sub.web_server || sub.server || '\u2014';
              const screenshot = sub.screenshot || '';
              const techs = sub.technologies || [];
              const statusClass = status >= 200 && status < 300 ? 'status-2xx' :
                status >= 300 && status < 400 ? 'status-3xx' :
                status >= 400 && status < 500 ? 'status-4xx' :
                status >= 500 ? 'status-5xx' : '';
              const thumbHtml = screenshot && screenshot.length > 100
                ? '<img src="data:image/jpeg;base64,' + screenshot + '" style="width:120px;height:68px;object-fit:cover;border-radius:4px;border:1px solid #2a2f3f;">'
                : '<span style="color:#8b92a7;">\u2014</span>';
              const techHtml = techs.length > 0
                ? '<div style="display:flex;flex-wrap:wrap;gap:0.25rem;">' + techs.map(t => '<span style="display:inline-block;padding:0.15rem 0.5rem;background:rgba(0,255,136,0.08);border:1px solid rgba(0,255,136,0.3);border-radius:4px;font-size:0.7rem;color:#5eead4;white-space:nowrap;line-height:1.4;">' + t + '</span>').join('') + '</div>'
                : '<span style="color:#8b92a7;">\u2014</span>';
              // Read crawled URLs from the DOM if they were fetched
              const listEl = document.getElementById('crawled-list-' + i);
              const domUrls = listEl ? Array.from(listEl.querySelectorAll('.crawled-url-item a')).map(a => a.href) : [];
              const urlsSuffix = domUrls.length > 0
                ? ' <span style="color:#a78bfa;font-size:0.75rem;font-weight:600;">(' + domUrls.length + ' URLs)</span>'
                : '';
              return '<tr>' +
                '<td>' + (i + 1) + '</td>' +
                '<td style="color:#00ff88;font-family:JetBrains Mono,monospace;font-size:0.85rem;">' + name + urlsSuffix + '</td>' +
                '<td>' + (status ? '<span class="status-badge ' + statusClass + '">' + status + '</span>' : '\u2014') + '</td>' +
                '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + title + '</td>' +
                '<td>' + techHtml + '</td>' +
                '<td>' + thumbHtml + '</td>' +
                '</tr>' +
                (domUrls.length > 0 ? '<tr><td colspan="6" style="padding:0;"><details style="cursor:pointer;padding:0.3rem 1rem 0.3rem 3rem;background:rgba(0,0,0,0.15);"><summary style="color:#a78bfa;font-size:0.75rem;font-weight:600;">' + domUrls.length + ' crawled URLs</summary><div style="max-height:150px;overflow-y:auto;margin-top:0.3rem;padding:0.3rem;background:rgba(0,0,0,0.2);border-radius:4px;">' + domUrls.map(u => { let d = u; try { const p = new URL(u); d = p.pathname + p.search; if (d.length > 90) d = d.slice(0,80) + '\u2026'; } catch {} return '<div style="font-family:JetBrains Mono,monospace;font-size:0.7rem;padding:0.15rem 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><a href="' + u + '" target="_blank" style="color:#8b92a7;text-decoration:none;">' + d + '</a></div>'; }).join('') + '</div></details></td></tr>' : '');
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
    })()}

    <div class="footer">
      <p>Generated by <strong>Peekaboo</strong> - Visual API Discovery Scanner</p>
      <p>\u{1F510} <strong>Salt Security</strong> \u2022 ${scanDate}</p>
      <p style="margin-top: 0.5rem; font-size: 0.85rem;">Protecting Modern Applications from API Attacks</p>
      <a href="https://salt.security/contact-us" target="_blank" class="contact-btn">
        \u{1F4E7} Contact Salt Security
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
        icon.textContent = screenshotsCollapsed ? '\u25B6' : '\u25BC';
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
  a.download = `peekaboo-report-${appState.targetDomain}-${new Date().toISOString().split('T')[0]}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
