/* AI description generation and formatting */

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
    const idx = appState.endpoints.findIndex(e =>
      e.method === epData.method &&
      e.host === epData.host &&
      e.path === epData.path
    );
    if (idx !== -1) {
      appState.endpoints[idx].llm_description = result;
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
    btn.textContent = 'Generate API Description';
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
