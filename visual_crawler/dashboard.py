"""Dashboard HTML template for the Visual API Crawler."""

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>👀 Peekaboo – API Discovery</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');
  :root {
    /* Salt Security inspired color palette */
    --purple: #4a1d96; --purple-light: #6b2fc7; --purple-dark: #2d1159;
    --navy: #0f1419; --navy-light: #1a1f2e;
    --green: #00ff88; --green-dark: #00cc6a;
    --bg: #0a0e17; --surface: #13161f; --surface2: #1a1e2b;
    --border: #2a2f3f; --text: #ffffff; --text-muted: #8b92a7;
    --accent: var(--purple); --accent2: var(--purple-light);
    --get: var(--green); --post: #3b82f6; --put: #f59e0b;
    --patch: #8b5cf6; --delete: #ef4444;
    --shadow: rgba(74, 29, 150, 0.2);
    --glow: rgba(0, 255, 136, 0.15);
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg);
    background-image: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(74, 29, 150, 0.15), transparent);
    color: var(--text);
    overflow-x:hidden;
    letter-spacing: -0.015em;
  }

  /* Start Form Overlay */
  .start-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(10, 11, 16, 0.95); backdrop-filter: blur(10px);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .start-overlay.hidden { display: none; }
  .start-form-container {
    background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
    padding: 2rem; max-width: 500px; width: 90%;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    max-height: 90vh; overflow-y: auto;
  }
  .start-form-container h2 {
    font-size: 1.5rem; margin-bottom: 0.25rem; font-weight: 700;
    background: linear-gradient(135deg, var(--green), var(--purple-light));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    letter-spacing: -0.02em;
  }
  .start-form-container .project-name {
    font-size: 1rem; color: var(--muted); margin-bottom: 0.5rem;
    font-weight: 500;
  }
  .start-form-container .subtitle {
    color: var(--muted); font-size: 0.9rem; margin-bottom: 1.5rem;
  }
  .form-group {
    margin-bottom: 1.25rem;
  }
  .form-group label {
    display: block; font-size: 0.85rem; font-weight: 600;
    color: var(--text); margin-bottom: 0.5rem;
  }
  .form-group input[type="text"],
  .form-group input[type="number"] {
    width: 100%; padding: 0.65rem 0.85rem; background: var(--surface2);
    border: 1px solid var(--border); border-radius: 8px; color: var(--text);
    font-size: 0.9rem; font-family: 'Inter', sans-serif;
  }
  .form-group input:focus {
    outline: none; border-color: var(--purple);
    box-shadow: 0 0 0 3px rgba(74, 29, 150, 0.15);
  }
  .form-group .hint {
    font-size: 0.75rem; color: var(--muted); margin-top: 0.35rem;
  }
  .form-group-inline {
    display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
  }
  .checkbox-group {
    display: flex; align-items: center; gap: 0.5rem;
  }
  .checkbox-group input[type="checkbox"] {
    width: 18px; height: 18px; cursor: pointer;
  }
  .radio-group {
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .radio-option {
    display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem;
    border-radius: 6px; cursor: pointer; transition: background 0.2s;
  }
  .radio-option:hover {
    background: var(--surface2);
  }
  .radio-option input[type="radio"] {
    width: 16px; height: 16px; cursor: pointer;
  }
  .radio-option label {
    margin: 0 !important; cursor: pointer; flex: 1;
  }
  .start-btn {
    width: 100%; padding: 0.85rem;
    background: linear-gradient(135deg, var(--purple), var(--purple-light));
    border: none; border-radius: 8px; color: white; font-size: 1rem;
    font-weight: 600; cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 4px 16px var(--shadow);
    position: relative; overflow: hidden;
  }
  .start-btn::before {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(135deg, transparent, rgba(0, 255, 136, 0.1));
    opacity: 0; transition: opacity 0.3s;
  }
  .start-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px var(--shadow), 0 0 32px var(--glow);
  }
  .start-btn:hover::before { opacity: 1; }
  .start-btn:active { transform: translateY(0); }
  .start-btn:disabled {
    opacity: 0.5; cursor: not-allowed; transform: none;
  }

  .toggle-advanced {
    width: 100%; padding: 0.75rem;
    background: rgba(139, 92, 246, 0.1);
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-radius: 6px; color: var(--text);
    font-size: 0.9rem; font-weight: 500;
    cursor: pointer; text-align: left;
    transition: all 0.2s;
    display: flex; align-items: center; gap: 0.5rem;
  }
  .toggle-advanced:hover {
    background: rgba(139, 92, 246, 0.15);
    border-color: rgba(139, 92, 246, 0.3);
  }
  #advancedIcon {
    display: inline-block;
    transition: transform 0.2s;
    font-size: 0.8rem;
  }
  #advancedIcon.expanded {
    transform: rotate(90deg);
  }

  /* Layout */
  .app { display:grid; grid-template-columns:340px 1fr; grid-template-rows:auto 1fr; height:100vh; }
  .top-bar {
    grid-column:1/-1; padding:0.75rem 1.5rem;
    background:var(--surface); border-bottom:1px solid var(--border);
    display:flex; align-items:center; justify-content:space-between;
  }
  .top-bar h1 {
    font-size:1.1rem; font-weight:700; letter-spacing:-0.02em;
    background:linear-gradient(135deg, var(--green), var(--purple-light));
    -webkit-background-clip:text; -webkit-text-fill-color:transparent;
  }
  .top-bar .domain-label { color:var(--muted); font-size:0.85rem; }

  .domain-indicator {
    display: inline-block;
    padding: 0.4rem 1rem;
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(107, 47, 199, 0.3));
    border: 2px solid var(--green);
    border-radius: 8px;
    color: var(--green);
    font-size: 0.95rem;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
    letter-spacing: 0.02em;
    box-shadow: 0 0 20px rgba(0, 255, 136, 0.3);
    animation: domainPulse 2s ease-in-out infinite;
  }
  .domain-indicator.hidden {
    display: none;
  }
  @keyframes domainPulse {
    0%, 100% { box-shadow: 0 0 20px rgba(0, 255, 136, 0.3); }
    50% { box-shadow: 0 0 30px rgba(0, 255, 136, 0.5); }
  }
  .scan-controls {
    display:flex; gap:0.5rem; align-items:center;
  }
  .control-btn {
    padding:0.4rem 0.8rem; border-radius:6px; border:1px solid var(--border);
    background:var(--surface2); color:var(--text); cursor:pointer;
    font-size:0.8rem; font-weight:600; transition:all 0.2s;
    display:flex; align-items:center; gap:0.35rem;
  }
  .control-btn:hover {
    border-color:var(--purple); background:var(--purple); color:#fff;
    box-shadow: 0 4px 12px var(--shadow);
  }
  .control-btn.stop { border-color:var(--delete); color:var(--delete); }
  .control-btn.stop:hover { background:var(--delete); color:#fff; }
  .control-btn.hidden { display:none; }

  /* Left panel */
  .left-panel {
    background:var(--surface); border-right:1px solid var(--border);
    display:flex; flex-direction:column; overflow:hidden;
  }
  .stats-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; padding:1rem; }
  .stat-box {
    background:var(--surface2); border:1px solid var(--border); border-radius:10px;
    padding:0.75rem; text-align:center;
  }
  .stat-box .num {
    font-size:1.5rem; font-weight:700;
    background:linear-gradient(135deg, var(--green), var(--purple-light));
    -webkit-background-clip:text; -webkit-text-fill-color:transparent;
  }
  .stat-box .lbl { font-size:0.7rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; }

  /* Activity log */
  .activity-header { padding:0.75rem 1rem; font-size:0.75rem; font-weight:600;
    color:var(--muted); text-transform:uppercase; letter-spacing:0.05em;
    border-top:1px solid var(--border); border-bottom:1px solid var(--border);
    background:var(--surface2);
  }
  .activity-log { flex:1; overflow-y:auto; padding:0.5rem; }
  .log-entry {
    padding:0.5rem 0.6rem; border-radius:6px; margin-bottom:0.3rem;
    font-size:0.78rem; color:var(--muted); transition:background 0.2s;
    display:flex; align-items:center; gap:0.5rem;
  }
  .log-entry:hover { background:var(--surface2); }
  .log-entry .icon { flex-shrink:0; font-size:0.85rem; }
  .log-entry .msg { word-break:break-all; }
  .log-entry.endpoint { color:var(--green); font-weight:500; }
  .log-entry.error { color:var(--delete); font-weight:500; }
  .log-entry.page { color:var(--purple-light); }

  /* Screenshot */
  .screenshot-section { padding:0.75rem 1rem; border-top:1px solid var(--border); }
  .screenshot-section .label { font-size:0.7rem; color:var(--muted); text-transform:uppercase;
    letter-spacing:0.05em; margin-bottom:0.5rem; }
  .screenshot-box {
    width:100%; aspect-ratio:16/9; border-radius:8px; overflow:hidden;
    background: linear-gradient(135deg, #1a1d2a 0%, #2a2d3a 100%);
    border:1px solid var(--border);
    display:flex; align-items:center; justify-content:center;
    position: relative;
  }
  .screenshot-box img { width:100%; height:100%; object-fit:cover; }
  .screenshot-box .placeholder {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 2rem; text-align: center;
  }
  .placeholder-logo {
    font-size: 3rem; font-weight: 800;
    background: linear-gradient(135deg, var(--green) 0%, var(--purple-light) 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    margin-bottom: 1rem; letter-spacing: -0.03em;
    filter: drop-shadow(0 0 20px var(--glow));
  }
  .placeholder-subtitle {
    color: var(--text-muted); font-size: 0.85rem; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.15em;
  }
  .current-url {
    margin-top:0.4rem; font-size:0.7rem; color:var(--muted);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }

  /* Right panel – endpoint table */
  .right-panel { display:flex; flex-direction:column; overflow:hidden; }
  .table-controls {
    padding:0.75rem 1rem; display:flex; gap:0.5rem; align-items:center;
    border-bottom:1px solid var(--border); background:var(--surface);
  }
  .search-input {
    flex:1; padding:0.45rem 0.75rem; background:var(--surface2);
    border:1px solid var(--border); border-radius:6px; color:var(--text);
    font-size:0.85rem; outline:none;
  }
  .search-input:focus {
    border-color:var(--purple);
    box-shadow: 0 0 0 3px rgba(74, 29, 150, 0.15);
    outline: none;
  }
  .filter-btn {
    padding:0.3rem 0.6rem; border-radius:5px; border:1px solid var(--border);
    background:var(--surface2); color:var(--muted); cursor:pointer;
    font-size:0.72rem; font-weight:600; transition:all 0.2s;
  }
  .filter-btn:hover {
    border-color:var(--purple); color:var(--text);
    background:rgba(74,29,150,0.1);
  }
  .filter-btn.active {
    background:var(--purple); color:#fff; border-color:var(--purple);
    box-shadow: 0 2px 8px var(--shadow);
  }
  .filter-section {
    display:flex; align-items:center; gap:0.5rem; padding:0.25rem 0;
  }
  .filter-label {
    font-size:0.7rem;
    color: var(--green);
    background: rgba(139, 92, 246, 0.15);
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    text-transform:uppercase;
    letter-spacing:0.05em;
    font-weight:700;
    white-space:nowrap;
    border: 1px solid rgba(139, 92, 246, 0.3);
  }
  .filter-divider {
    width:1px; height:20px; background:var(--border); margin:0 0.25rem;
  }

  .table-scroll { flex:1; overflow-y:auto; }
  table { width:100%; border-collapse:collapse; }
  thead th {
    position:sticky; top:0; z-index:2;
    padding:0.6rem 0.75rem; text-align:left; font-size:0.72rem; font-weight:600;
    text-transform:uppercase; letter-spacing:0.04em; color:var(--muted);
    background:var(--surface); border-bottom:1px solid var(--border); cursor:pointer;
  }
  thead th:hover { color:var(--green); }
  tbody tr {
    border-bottom:1px solid var(--border);
    transition:all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  tbody tr:hover {
    background:rgba(74,29,150,0.08);
    box-shadow: inset 3px 0 0 var(--purple);
  }
  td { padding:0.55rem 0.75rem; font-size:0.85rem; }

  .badge {
    display:inline-block; padding:0.15rem 0.5rem; border-radius:4px;
    font-size:0.72rem; font-weight:700; font-family:'JetBrains Mono',monospace;
    text-align:center; min-width:52px;
  }
  .badge-GET   { background:rgba(0,255,136,0.15); color:var(--green); border:1px solid rgba(0,255,136,0.3); }
  .badge-GET\\* { background:rgba(0,255,136,0.08); color:var(--green); border:1px dashed rgba(0,255,136,0.4); }
  .badge-POST  { background:rgba(59,130,246,0.15); color:var(--post); border:1px solid rgba(59,130,246,0.3); }
  .badge-PUT   { background:rgba(245,158,11,0.15); color:var(--put); border:1px solid rgba(245,158,11,0.3); }
  .badge-PATCH { background:rgba(139,92,246,0.15); color:var(--patch); border:1px solid rgba(139,92,246,0.3); }
  .badge-DELETE{ background:rgba(239,68,68,0.15); color:var(--delete); border:1px solid rgba(239,68,68,0.3); }
  .badge-OPTIONS{ background:rgba(139,146,167,0.15); color:var(--text-muted); border:1px solid rgba(139,146,167,0.3); }

  .path-cell { font-family:'JetBrains Mono',monospace; font-size:0.8rem; word-break:break-all; }
  .host-cell { color:var(--muted); font-size:0.8rem; }
  .status-2xx { color:var(--green); font-weight:600; }
  .status-3xx { color:var(--put); font-weight:600; }
  .status-4xx { color:var(--patch); font-weight:600; }
  .status-5xx { color:var(--delete); font-weight:600; }
  .reason-cell { color:var(--muted); font-size:0.75rem; }

  /* Pulse animation for live indicator */
  .live-dot {
    width:8px; height:8px; border-radius:50%; background:var(--green);
    display:inline-block; margin-right:0.4rem;
    animation:pulse 1.5s ease infinite;
    box-shadow: 0 0 12px var(--green), 0 0 24px var(--glow);
  }
  .live-dot.done { background:var(--text-muted); animation:none; box-shadow:none; }
  @keyframes pulse {
    0%,100%{opacity:1; transform:scale(1);}
    50%{opacity:0.6; transform:scale(0.95);}
  }

  .status-badge { display:flex; align-items:center; font-size:0.8rem; font-weight:600; }

  /* New endpoint flash */
  @keyframes flashIn {
    0% { background:rgba(0,255,136,0.15); box-shadow: inset 3px 0 0 var(--green); }
    100% { background:transparent; box-shadow: none; }
  }
  .flash { animation: flashIn 1.2s cubic-bezier(0.4, 0, 0.2, 1); }

  .empty-state { text-align:center; padding:4rem 2rem; color:var(--muted); }
  .empty-state .icon { font-size:3rem; margin-bottom:1rem; }

  /* Pagination */
  .pagination {
    display: none; /* Hidden by default, shown via JS */
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem;
    margin-top: 1rem;
    border-top: 1px solid var(--border);
  }
  .page-btn {
    padding: 0.5rem 1rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .page-btn:hover:not(:disabled) {
    background: var(--purple);
    border-color: var(--purple-light);
  }
  .page-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .page-numbers {
    display: flex;
    gap: 0.3rem;
  }
  .page-num {
    padding: 0.4rem 0.7rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  .page-num:hover {
    background: var(--purple-dark);
    border-color: var(--purple);
  }
  .page-num.active {
    background: var(--purple);
    border-color: var(--purple-light);
    color: var(--green);
    font-weight: 700;
  }

  /* Detail Drawer */
  .detail-drawer {
    position: fixed; top: 0; right: -500px; bottom: 0; width: 500px;
    background: var(--surface); border-left: 1px solid var(--border);
    box-shadow: -5px 0 20px rgba(0,0,0,0.3); z-index: 2000;
    transition: right 0.3s ease; overflow-y: auto;
  }
  .detail-drawer.open { right: 0; }
  .drawer-header {
    padding: 1.5rem; border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
    background: var(--surface2);
  }
  .drawer-header h3 {
    font-size: 1.1rem; margin: 0; font-weight: 700; letter-spacing: -0.02em;
    background: linear-gradient(135deg, var(--green), var(--purple-light));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .drawer-close {
    background: none; border: none; color: var(--muted);
    font-size: 1.5rem; cursor: pointer; padding: 0.25rem 0.5rem;
    transition: color 0.2s;
  }
  .drawer-close:hover { color: var(--text); }
  .drawer-content { padding: 1.5rem; }
  .generate-description-btn {
    width: 100%; padding: 0.75rem 1rem; margin-top: 1rem;
    background: linear-gradient(135deg, var(--purple), var(--purple-light));
    border: none; border-radius: 8px; color: var(--text);
    font-weight: 600; font-size: 0.9rem; cursor: pointer;
    transition: all 0.2s; box-shadow: 0 4px 12px var(--shadow);
  }
  .generate-description-btn:hover {
    transform: translateY(-1px); box-shadow: 0 6px 16px var(--shadow);
    background: linear-gradient(135deg, var(--purple-light), var(--purple));
  }
  .generate-description-btn:disabled {
    opacity: 0.5; cursor: not-allowed; transform: none;
  }
  .api-description-section {
    margin-top: 1.5rem; padding: 1rem; background: var(--surface2);
    border-radius: 8px; border-left: 3px solid var(--green);
  }
  .api-description-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 0.75rem; cursor: pointer; user-select: none;
  }
  .api-description-section h4 {
    font-size: 0.85rem; margin: 0; color: var(--green);
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .collapse-toggle {
    background: none; border: none; color: var(--green);
    font-size: 1.2rem; cursor: pointer; padding: 0.25rem;
    transition: transform 0.3s ease;
  }
  .collapse-toggle.collapsed {
    transform: rotate(-90deg);
  }
  .api-description-content {
    font-size: 0.9rem; line-height: 1.6; color: var(--text);
    max-height: 1000px; overflow: hidden;
    transition: max-height 0.3s ease, opacity 0.3s ease;
    opacity: 1;
  }
  .api-description-content.collapsed {
    max-height: 0; opacity: 0; margin: 0;
  }
  .api-description-content p {
    margin-bottom: 0.75rem;
  }
  .api-description-content ul {
    margin-left: 1.25rem; margin-bottom: 0.75rem;
  }
  .api-description-content li {
    margin-bottom: 0.5rem;
  }
  .api-description-loading {
    text-align: center; padding: 2rem; color: var(--text);
    background: linear-gradient(135deg, rgba(74, 29, 150, 0.1), rgba(107, 47, 199, 0.1));
    border-radius: 8px; border: 1px solid var(--border);
  }
  .api-description-loading .spinner {
    display: inline-block; width: 40px; height: 40px; margin-bottom: 1rem;
    border: 4px solid rgba(0, 255, 136, 0.1);
    border-top: 4px solid var(--green); border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  .api-description-loading .loading-text {
    font-size: 0.95rem; font-weight: 500; color: var(--green);
    margin-bottom: 0.5rem;
  }
  .api-description-loading .loading-subtext {
    font-size: 0.8rem; color: var(--muted);
  }
  .api-description-error {
    color: var(--delete); padding: 1rem; background: rgba(239, 68, 68, 0.1);
    border-radius: 6px; margin-top: 1rem;
  }

  /* Scan Summary Modal */
  .summary-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(10, 14, 23, 0.95); backdrop-filter: blur(10px);
    display: flex; align-items: center; justify-content: center; z-index: 3000;
    opacity: 0; visibility: hidden; transition: opacity 0.3s, visibility 0.3s;
  }
  .summary-overlay.show {
    opacity: 1; visibility: visible;
  }
  .summary-modal {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; padding: 2rem; max-width: 600px; width: 90%;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    transform: translateY(20px); transition: transform 0.3s;
  }
  .summary-overlay.show .summary-modal {
    transform: translateY(0);
  }
  .summary-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 1.5rem;
  }
  .summary-header h2 {
    font-size: 1.5rem; margin: 0; font-weight: 700;
    background: linear-gradient(135deg, var(--green), var(--purple-light));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .summary-close {
    background: none; border: none; color: var(--muted);
    font-size: 1.5rem; cursor: pointer; padding: 0.25rem 0.5rem;
    transition: color 0.2s;
  }
  .summary-close:hover { color: var(--text); }
  .summary-stats {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .summary-stat {
    background: var(--surface2); padding: 1rem; border-radius: 8px;
    border-left: 3px solid var(--purple);
  }
  .summary-stat-label {
    font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--muted); margin-bottom: 0.5rem;
  }
  .summary-stat-value {
    font-size: 1.75rem; font-weight: 700; color: var(--text);
  }
  .summary-stat-subtext {
    font-size: 0.85rem; color: var(--muted); margin-top: 0.25rem;
  }
  .summary-domains {
    background: var(--surface2); padding: 1rem; border-radius: 8px;
    margin-bottom: 1rem; max-height: 150px; overflow-y: auto;
  }
  .summary-domains-title {
    font-size: 0.85rem; font-weight: 600; color: var(--green);
    margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .summary-domain-list {
    display: flex; flex-wrap: wrap; gap: 0.5rem;
  }
  .summary-domain-tag {
    background: var(--surface); padding: 0.25rem 0.75rem; border-radius: 12px;
    font-size: 0.8rem; color: var(--text); border: 1px solid var(--border);
  }
  .summary-actions {
    display: flex; gap: 1rem; justify-content: flex-end;
  }
  .summary-btn {
    padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600;
    font-size: 0.9rem; cursor: pointer; transition: all 0.2s;
  }
  .summary-btn-primary {
    background: linear-gradient(135deg, var(--purple), var(--purple-light));
    border: none; color: var(--text);
  }
  .summary-btn-primary:hover {
    transform: translateY(-1px); box-shadow: 0 6px 16px var(--shadow);
  }
  .summary-btn-secondary {
    background: var(--surface2); border: 1px solid var(--border); color: var(--text);
  }
  .summary-btn-secondary:hover {
    background: var(--surface);
  }

  /* About Button and Modal */
  .about-link {
    position: fixed; bottom: 2rem; right: 2rem; z-index: 1000;
    background: var(--surface); border: 2px solid var(--border);
    padding: 0.75rem 1.25rem; border-radius: 12px; color: var(--text);
    text-decoration: none; font-size: 1rem; font-weight: 600;
    transition: all 0.2s; cursor: pointer;
    box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  }
  .about-link:hover {
    background: var(--purple); border-color: var(--green);
    color: var(--green); transform: translateY(-3px);
    box-shadow: 0 8px 24px rgba(0,255,136,0.3);
  }
  .about-modal {
    max-width: 500px;
  }
  .about-content {
    font-size: 0.95rem; line-height: 1.6; color: var(--text);
  }
  .about-content h3 {
    font-size: 1.1rem; color: var(--green); margin: 1.5rem 0 0.75rem;
  }
  .about-content p {
    margin-bottom: 0.75rem;
  }
  .about-emoji {
    font-size: 2rem; text-align: center; margin: 1rem 0;
  }
  .header-eyes {
    font-size: 2rem !important;
    margin-left: 0.75rem;
    -webkit-background-clip: border-box !important;
    -webkit-text-fill-color: currentColor !important;
    background-clip: border-box !important;
    background: transparent !important;
    letter-spacing: 0 !important;
    color: inherit !important;
  }
  .detail-section {
    margin-bottom: 1.5rem; padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }
  .detail-section:last-child { border-bottom: none; }
  .detail-label {
    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--muted); margin-bottom: 0.5rem; font-weight: 600;
  }
  .detail-value {
    font-size: 0.9rem; color: var(--text); word-break: break-all;
    font-family: 'JetBrains Mono', monospace;
  }
  .detail-value.large { font-size: 1.1rem; font-weight: 600; }
  .query-param {
    background: var(--surface2); padding: 0.3rem 0.6rem;
    border-radius: 4px; display: inline-block; margin: 0.2rem;
    font-size: 0.8rem;
  }
  tbody tr { cursor: pointer; }
  tbody tr:hover {
    background: rgba(74,29,150,0.08);
    box-shadow: inset 3px 0 0 var(--purple);
  }
</style>
</head>
<body>
<!-- Start Form Overlay -->
<div class="start-overlay" id="startOverlay">
  <div class="start-form-container">
    <h2 style="display:flex;align-items:center;justify-content:center;gap:0.6rem;">
      <svg style="height:1.5rem;width:auto;" version="1.1" viewBox="0 0 152.63 40.25" xmlns="http://www.w3.org/2000/svg">
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
      <span>Peekaboo</span>
    </h2>
    <p class="subtitle">Configure your scan parameters and start discovering APIs</p>
    <form id="startForm" onsubmit="startScan(event)">
      <div class="form-group">
        <label>Domain Name <span style="color:var(--patch)">*</span></label>
        <input type="text" id="domain" name="domain" placeholder="example.com" required>
        <div class="hint">Enter the target domain without http:// or https://</div>
      </div>

      <div class="form-group">
        <button type="button" class="toggle-advanced" onclick="toggleAdvanced()">
          <span id="advancedIcon">▶</span> Advanced Settings
          <span style="font-size:0.8rem;color:var(--text-muted);font-weight:400;">(Max Pages: 50, Max Depth: 3, Timeout: 30s)</span>
        </button>
        <div id="advancedSettings" style="display:none;margin-top:1rem;">
          <div class="form-group-inline">
            <div class="form-group">
              <label>Max Pages</label>
              <input type="number" id="maxPages" name="maxPages" value="50" min="1" max="500">
              <div class="hint">Default: 50</div>
            </div>

            <div class="form-group">
              <label>Max Depth</label>
              <input type="number" id="maxDepth" name="maxDepth" value="3" min="1" max="10">
              <div class="hint">Default: 3</div>
            </div>
          </div>

          <div class="form-group">
            <label>Timeout (ms)</label>
            <input type="number" id="timeout" name="timeout" value="30000" min="5000" max="120000" step="1000">
            <div class="hint">Page load timeout in milliseconds (default: 30000)</div>
          </div>
        </div>
      </div>

      <div class="form-group">
        <div class="checkbox-group">
          <input type="checkbox" id="includeSubdomains" name="includeSubdomains" checked>
          <label for="includeSubdomains" style="margin:0">Follow Subdomain Links</label>
        </div>
        <div class="hint">Visit pages on subdomains (e.g., api.example.com, app.example.com)</div>
      </div>

      <div class="form-group">
        <label>Scan-Time API Filter</label>
        <div class="radio-group">
          <div class="radio-option">
            <input type="radio" id="filterAll" name="apiFilter" value="all" checked>
            <label for="filterAll">Collect All APIs</label>
          </div>
          <div class="radio-option">
            <input type="radio" id="filterSubdomain" name="apiFilter" value="subdomain">
            <label for="filterSubdomain">Only Target Domain APIs</label>
          </div>
          <div class="radio-option">
            <input type="radio" id="filterExternal" name="apiFilter" value="external">
            <label for="filterExternal">Only External APIs</label>
          </div>
        </div>
        <div class="hint">Which APIs to collect during scan (you can also filter in the table after scanning)</div>
      </div>

      <div class="form-group">
        <label>⚡ Performance Settings</label>
        <div class="form-group-inline">
          <div class="form-group">
            <label>Concurrent Pages</label>
            <input type="number" id="concurrentPages" name="concurrentPages" value="5" min="1" max="20">
            <div class="hint">Pages processed in parallel</div>
          </div>
          <div class="form-group">
            <div class="checkbox-group" style="margin-top:1.5rem;">
              <input type="checkbox" id="fastMode" name="fastMode">
              <label for="fastMode" style="margin:0">Fast Mode</label>
            </div>
            <div class="hint">Skip screenshots & interactions</div>
          </div>
        </div>
      </div>


      <button type="submit" class="start-btn" id="startBtn">
        🚀 Start Scan
      </button>
    </form>
  </div>
</div>

<div class="app">
  <!-- Top bar -->
  <div class="top-bar">
    <h1 style="display:flex;align-items:center;gap:0.75rem;">
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
      <span>Peekaboo</span>
      <span class="header-eyes">👁️ 👁️</span>
      <span id="domainIndicator" class="domain-indicator hidden"></span>
    </h1>
    <div style="display:flex;align-items:center;gap:1rem;">
      <div class="scan-controls">
        <button class="control-btn hidden" id="pauseBtn" onclick="togglePause()">
          ⏸ Pause Scan
        </button>
        <button class="control-btn hidden" id="stopBtn" onclick="stopScan()">
          ⏹ Terminate Scan
        </button>
        <button class="control-btn hidden" id="newScanBtn" onclick="newScan()">
          🔄 New Scan
        </button>
      </div>
      <div class="status-badge">
        <span class="live-dot" id="liveDot"></span>
        <span id="statusText">Ready</span>
      </div>
    </div>
  </div>

  <!-- Left panel -->
  <div class="left-panel">
    <div class="stats-grid">
      <div class="stat-box"><div class="num" id="statEndpoints">0</div><div class="lbl">Endpoints</div></div>
      <div class="stat-box"><div class="num" id="statPages">0</div><div class="lbl">Pages</div></div>
      <div class="stat-box"><div class="num" id="statHosts">0</div><div class="lbl">Hosts</div></div>
      <div class="stat-box"><div class="num" id="statQueue">0</div><div class="lbl">In Queue</div></div>
    </div>

    <div class="screenshot-section">
      <div class="label">Live Preview</div>
      <div class="screenshot-box" id="screenshotBox">
        <div class="placeholder">
          <div class="placeholder-logo">SALT SECURITY</div>
          <div class="placeholder-subtitle">API Discovery Scanner</div>
        </div>
      </div>
      <div class="current-url" id="currentUrl">&nbsp;</div>
    </div>

    <div class="activity-header">Activity Log</div>
    <div class="activity-log" id="activityLog"></div>
  </div>

  <!-- Right panel -->
  <div class="right-panel">
    <div class="table-controls">
      <input class="search-input" id="searchInput" placeholder="Filter endpoints..." oninput="currentPage = 1; applyFilters();">
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
        <div class="filter-section">
          <span class="filter-label">Domain:</span>
          <span class="filter-btn active" id="domainAll" onclick="setDomainFilter('all')">All</span>
          <span class="filter-btn" id="domainSubdomain" onclick="setDomainFilter('subdomain')">Subdomain</span>
          <span class="filter-btn" id="domainExternal" onclick="setDomainFilter('external')">External</span>
        </div>
        <div class="filter-divider"></div>
        <div class="filter-section">
          <span class="filter-label">Method:</span>
          <div id="methodFilters" style="display:flex;gap:0.3rem;flex-wrap:wrap;"></div>
        </div>
        <div class="filter-divider"></div>
        <div class="filter-section">
          <span class="filter-label">API Type:</span>
          <span class="filter-btn active" id="apiAll" onclick="setApiFilter('all')">All</span>
          <span class="filter-btn" id="apiConfirmed" onclick="setApiFilter('confirmed')">API</span>
          <span class="filter-btn" id="apiMaybe" onclick="setApiFilter('maybe')">Maybe</span>
          <span class="filter-btn" id="apiNone" onclick="setApiFilter('none')">Not API</span>
        </div>
        <div class="filter-divider"></div>
        <div class="filter-section">
          <span class="filter-label">Status:</span>
          <span class="filter-btn active" id="statusAll" onclick="setStatusFilter('all')">All</span>
          <span class="filter-btn" id="status2xx" onclick="setStatusFilter('2xx')">2xx</span>
          <span class="filter-btn" id="status3xx" onclick="setStatusFilter('3xx')">3xx</span>
          <span class="filter-btn" id="status4xx" onclick="setStatusFilter('4xx')">4xx</span>
          <span class="filter-btn" id="status5xx" onclick="setStatusFilter('5xx')">5xx</span>
          <span class="filter-btn" id="statusNone" onclick="setStatusFilter('none')">No Status</span>
        </div>
      </div>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th style="width:75px" onclick="sortBy('method')">Method</th>
            <th onclick="sortBy('path')">Path</th>
            <th onclick="sortBy('host')">Host</th>
            <th style="width:60px" onclick="sortBy('status')">Status</th>
            <th onclick="sortBy('reason')">Detected Via</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
      <div class="pagination" id="pagination">
        <button class="page-btn" id="prevBtn" onclick="changePage(-1)">← Previous</button>
        <div class="page-numbers" id="pageNumbers"></div>
        <button class="page-btn" id="nextBtn" onclick="changePage(1)">Next →</button>
      </div>
      <div class="empty-state" id="emptyState">
        <div class="icon">📡</div>
        <div>Waiting for API endpoints to appear...</div>
      </div>
    </div>
  </div>
</div>

<!-- Detail Drawer -->
<div class="detail-drawer" id="detailDrawer">
  <div class="drawer-header">
    <h3>Endpoint Details</h3>
    <button class="drawer-close" onclick="closeDrawer()">×</button>
  </div>
  <div class="drawer-content" id="drawerContent">
    <!-- Content populated by JavaScript -->
  </div>
</div>

<!-- About Button -->
<button class="about-link" onclick="showAbout()">ℹ️ About</button>

<!-- About Modal -->
<div class="summary-overlay" id="aboutOverlay">
  <div class="summary-modal about-modal">
    <div class="summary-header">
      <h2>👀 About Peekaboo</h2>
      <button class="summary-close" onclick="closeAbout()">×</button>
    </div>
    <div class="about-content">
      <div class="about-emoji">👁️ 👁️</div>
      <h3>Visual API Discovery Scanner</h3>
      <p><em>Revealing hidden APIs in plain sight</em></p>

      <p><strong>Peekaboo</strong> is a real-time visual API discovery tool that crawls web applications and automatically identifies REST API endpoints by monitoring network traffic and analyzing application behavior.</p>

      <p style="text-align: center; margin-top: 2rem; color: var(--muted); font-size: 0.85rem;">
        🔐 A Salt Security Project
      </p>
    </div>
    <div class="summary-actions" style="margin-top: 1.5rem;">
      <button class="summary-btn summary-btn-primary" onclick="closeAbout()">Got it!</button>
    </div>
  </div>
</div>

<!-- Scan Summary Modal -->
<div class="summary-overlay" id="summaryOverlay">
  <div class="summary-modal">
    <div class="summary-header">
      <h2>✅ Scan Complete</h2>
      <button class="summary-close" onclick="closeSummary()">×</button>
    </div>
    <div class="summary-stats">
      <div class="summary-stat">
        <div class="summary-stat-label">Endpoints Found</div>
        <div class="summary-stat-value" id="summaryEndpoints">0</div>
        <div class="summary-stat-subtext" id="summaryApiCount">0 confirmed APIs</div>
      </div>
      <div class="summary-stat">
        <div class="summary-stat-label">Pages Crawled</div>
        <div class="summary-stat-value" id="summaryPages">0</div>
        <div class="summary-stat-subtext" id="summarySkipped"></div>
      </div>
      <div class="summary-stat">
        <div class="summary-stat-label">Duration</div>
        <div class="summary-stat-value" id="summaryDuration">0s</div>
        <div class="summary-stat-subtext" id="summaryRate">0 pages/min</div>
      </div>
      <div class="summary-stat">
        <div class="summary-stat-label">Hosts Discovered</div>
        <div class="summary-stat-value" id="summaryHosts">0</div>
        <div class="summary-stat-subtext" id="summarySubdomains">0 subdomains</div>
      </div>
    </div>
    <div class="summary-domains" id="summaryDomainsSection">
      <div class="summary-domains-title">🌐 Discovered Hosts</div>
      <div class="summary-domain-list" id="summaryDomainList">
        <!-- Populated by JavaScript -->
      </div>
    </div>
    <div class="summary-actions">
      <button class="summary-btn summary-btn-secondary" onclick="closeSummary()">Close</button>
      <button class="summary-btn summary-btn-primary" onclick="startNewScan()">New Scan</button>
    </div>
  </div>
</div>

<script>
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
      <div class="placeholder-logo">SALT SECURITY</div>
      <div class="placeholder-subtitle">API Discovery Scanner</div>
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
  document.getElementById('summaryHosts').textContent = hosts.size;
  document.getElementById('summarySubdomains').textContent = `${subdomainCount} subdomains`;

  // Populate host list
  const domainList = document.getElementById('summaryDomainList');
  domainList.innerHTML = '';
  const sortedHosts = hostArray.sort();
  sortedHosts.forEach(host => {
    const tag = document.createElement('div');
    tag.className = 'summary-domain-tag';
    tag.textContent = host;
    domainList.appendChild(tag);
  });

  // Show modal with animation
  setTimeout(() => {
    document.getElementById('summaryOverlay').classList.add('show');
  }, 500); // Small delay after scan completes
}

function closeSummary() {
  document.getElementById('summaryOverlay').classList.remove('show');
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
</script>
</body>
</html>"""
