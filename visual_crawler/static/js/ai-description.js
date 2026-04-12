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

  let result;
  let useBrowserLLM = browserLLM.available;

  try {
    if (useBrowserLLM) {
      // Use browser LLM
      resultDiv.innerHTML = `
        <div class="api-description-loading">
          <div class="spinner"></div>
          <div class="loading-text">Generating API Description</div>
          <div class="loading-subtext">Using Browser LLM (Gemini Nano)...</div>
        </div>
      `;

      result = await browserLLM.generateDescription(epData);
    } else {
      // Use backend (AWS Bedrock)
      resultDiv.innerHTML = `
        <div class="api-description-loading">
          <div class="spinner"></div>
          <div class="loading-text">Generating API Description</div>
          <div class="loading-subtext">Using Cloud LLM (AWS Bedrock)...</div>
        </div>
      `;

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

      result = await response.json();
    }

    // Check if result contains an error
    if (result.error) {
      // Add source badge to error display
      const sourceBadge = result.source === 'browser'
        ? '<span style="font-size: 0.7rem; padding: 0.2rem 0.5rem; background: #4CAF50; color: white; border-radius: 3px; margin-left: 0.5rem;">Browser LLM</span>'
        : '<span style="font-size: 0.7rem; padding: 0.2rem 0.5rem; background: #2196F3; color: white; border-radius: 3px; margin-left: 0.5rem;">AWS Bedrock</span>';

      resultDiv.innerHTML = `
        <div class="api-description-section">
          <div class="api-description-header">
            <h4>📋 API Description${sourceBadge}</h4>
          </div>
          ${formatAPIDescription(result)}
        </div>
      `;
      btn.disabled = false;
      btn.textContent = 'Generate API Description';
      btn.style.opacity = '1';
      return;
    }

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

    // Add source badge
    const sourceBadge = result.source === 'browser'
      ? '<span style="font-size: 0.7rem; padding: 0.2rem 0.5rem; background: #4CAF50; color: white; border-radius: 3px; margin-left: 0.5rem;">Browser LLM</span>'
      : '<span style="font-size: 0.7rem; padding: 0.2rem 0.5rem; background: #2196F3; color: white; border-radius: 3px; margin-left: 0.5rem;">AWS Bedrock</span>';

    // Display the result
    resultDiv.innerHTML = `
      <div class="api-description-section">
        <div class="api-description-header" onclick="toggleDescription()">
          <h4>📋 API Description${sourceBadge}</h4>
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

    // Provide context-specific error message
    const errorContext = useBrowserLLM
      ? 'Browser LLM failed. Check browser console for details or try reloading the page.'
      : 'Please check your AWS configuration and ensure Bedrock is enabled.';

    resultDiv.innerHTML = `
      <div class="api-description-error">
        ❌ Failed to generate description: ${escHtml(error.message)}
        <br><br>
        <small>${errorContext}</small>
      </div>
    `;
    btn.disabled = false;
    btn.textContent = 'Generate API Description';
    btn.style.opacity = '1';
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
    // Format multi-line error messages properly
    const errorTitle = escHtml(data.error);
    const errorDesc = data.description ? escHtml(data.description).replace(/\n/g, '<br>') : '';
    return `
      <div class="api-description-error">
        <div style="font-weight: bold; margin-bottom: 0.5rem;">❌ ${errorTitle}</div>
        ${errorDesc ? `<div style="font-size: 0.9rem; line-height: 1.6; color: var(--text-secondary);">${errorDesc}</div>` : ''}
      </div>
    `;
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
