/* Pure helper functions */

function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function trimPath(path, maxLength = 80) {
  if (path.length <= maxLength) return path;
  const start = Math.floor(maxLength * 0.4);
  const end = Math.floor(maxLength * 0.4);
  return path.substring(0, start) + '...' + path.substring(path.length - end);
}

function shortenUrl(u) {
  try { return new URL(u).pathname; } catch { return u; }
}

function tryPrettyJson(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); }
  catch { return text; }
}

function getStatusExplanation(statusCode) {
  return statusExplanations[statusCode] || `HTTP status code ${statusCode}`;
}

function getMethodExplanation(method) {
  return methodExplanations[method] || `${method} - HTTP method for interacting with this resource.`;
}
