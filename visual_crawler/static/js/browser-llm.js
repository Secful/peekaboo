/* Browser-based LLM detection and API description generation */

class BrowserLLM {
  constructor() {
    this.available = false;
    this.session = null;
    this.api = null;
  }

  /**
   * Detect if browser LLM is available
   * @returns {Promise<boolean>} True if available
   */
  async detect() {
    try {
      console.log('🔍 Detecting browser LLM...');

      // Try global LanguageModel API (Chrome Canary/Dev)
      if (typeof LanguageModel !== 'undefined') {
        this.api = LanguageModel;
        console.log('✓ Found LanguageModel global API');
      } else if (window.ai?.languageModel) {
        this.api = window.ai.languageModel;
        console.log('✓ Found window.ai.languageModel API');
      } else {
        console.log('✗ Browser LLM API not found');
        console.log('  - LanguageModel global:', typeof LanguageModel !== 'undefined');
        console.log('  - window.ai:', !!window.ai);
        console.log('  - window.ai.languageModel:', !!window.ai?.languageModel);
        return false;
      }

      // Check availability - try multiple methods
      let status = 'unknown';
      try {
        status = await this.api.availability();
        console.log(`✓ availability() returned: "${status}"`);
      } catch (e) {
        console.log(`⚠ availability() failed: ${e.message}`);
        try {
          const caps = await this.api.capabilities();
          status = caps.available;
          console.log(`✓ capabilities().available returned: "${status}"`);
        } catch (e2) {
          console.log(`✗ capabilities() also failed: ${e2.message}`);
        }
      }

      this.available = (status === 'readily' || status === 'available');

      if (!this.available) {
        console.log(`✗ Browser LLM not ready (status: ${status})`);
      }

      return this.available;
    } catch (error) {
      console.error('✗ Browser LLM detection error:', error);
      this.available = false;
      return false;
    }
  }

  /**
   * Create LLM session with system prompt
   * @returns {Promise<void>}
   */
  async createSession() {
    if (!this.available) {
      throw new Error('Browser LLM not available');
    }

    if (this.session) {
      return; // Session already exists
    }

    try {
      console.log('Creating browser LLM session...');
      this.session = await this.api.create({
        expectedOutputLanguages: ['en'],
        systemPrompt: 'You are an API analysis expert. Analyze API endpoints and provide structured descriptions in JSON format. Be concise and accurate.',
        temperature: 0.3,
        topK: 3
      });
      console.log('✓ Browser LLM session created');
    } catch (error) {
      console.error('✗ Failed to create browser LLM session:', error);
      this.available = false;
      throw error;
    }
  }

  /**
   * Generate API description using browser LLM
   * @param {Object} epData Endpoint data
   * @returns {Promise<Object>} Parsed description with source: "browser"
   */
  async generateDescription(epData) {
    if (!this.available) {
      throw new Error('Browser LLM not available');
    }

    // Lazy session creation
    if (!this.session) {
      await this.createSession();
    }

    try {
      const prompt = this._buildPrompt(epData);
      const result = await this.session.prompt(prompt);
      const parsed = this._parseResponse(result);
      parsed.source = 'browser'; // Add source indicator
      return parsed;
    } catch (error) {
      console.error('Browser LLM generation failed:', error);
      // Mark as unavailable on error to trigger backend fallback
      this.available = false;
      throw error;
    }
  }

  /**
   * Build prompt matching bedrock_analyzer.py format (lines 24-53)
   * @param {Object} epData Endpoint data
   * @returns {string} Formatted prompt
   */
  _buildPrompt(epData) {
    let prompt = `Analyze this API endpoint and provide a detailed description in JSON format.

**Endpoint Information:**
- Method: ${epData.method}
- Host: ${epData.host}
- Path: ${epData.path}
- Status Code: ${epData.response_status || 'Unknown'}
`;

    if (epData.query_params && epData.query_params.length > 0) {
      prompt += `- Query Parameters: ${epData.query_params.join(', ')}\n`;
    }

    if (epData.request_body) {
      prompt += `\n**Request Payload:**\n\`\`\`\n${epData.request_body}\n\`\`\`\n`;
    }

    if (epData.response_body) {
      prompt += `\n**Response Payload:**\n\`\`\`\n${epData.response_body}\n\`\`\`\n`;
    }

    prompt += `
Provide a concise analysis in JSON format. Be brief and direct:

{
"summary": "One sentence: what this endpoint does",
"parameters": [{"name": "param", "type": "string", "description": "short desc"}],
"returns": "Brief description of response",
"notes": "Any important details (authentication, side effects, etc.)"
}

Keep all descriptions under 15 words. Focus only on what's clearly visible in the data.
`;

    return prompt;
  }

  /**
   * Parse LLM response matching bedrock_analyzer.py format (lines 57-81)
   * @param {string} llmText LLM response text
   * @returns {Object} Parsed JSON
   */
  _parseResponse(llmText) {
    try {
      let jsonStr = llmText.trim();

      // Try to find JSON in code blocks (```json or ```)
      if (llmText.includes('```json')) {
        const jsonStart = llmText.indexOf('```json') + 7;
        const jsonEnd = llmText.indexOf('```', jsonStart);
        if (jsonEnd > jsonStart) {
          jsonStr = llmText.substring(jsonStart, jsonEnd).trim();
        }
      } else if (llmText.includes('```')) {
        const jsonStart = llmText.indexOf('```') + 3;
        const jsonEnd = llmText.indexOf('```', jsonStart);
        if (jsonEnd > jsonStart) {
          jsonStr = llmText.substring(jsonStart, jsonEnd).trim();
        }
      }

      // Parse JSON
      const parsed = JSON.parse(jsonStr);
      return parsed;
    } catch (error) {
      console.warn('Failed to parse browser LLM JSON response:', error);
      // Return raw text if parsing fails (matching backend behavior)
      return {
        description: llmText.substring(0, 500), // First 500 chars
        raw_response: llmText
      };
    }
  }
}

// Create global instance
const browserLLM = new BrowserLLM();
