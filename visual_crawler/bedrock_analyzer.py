"""AWS Bedrock integration for LLM-powered API analysis."""

import json
import boto3
from typing import Optional


def _build_prompt(
        method: str,
    path: str,
    host: str,
    request_body: Optional[str],
    response_body: Optional[str],
    response_status: Optional[int],
    query_params: Optional[list],
) -> str:
    """Build the prompt for Claude."""
    prompt = f"""Analyze this API endpoint and provide a detailed description in JSON format.

**Endpoint Information:**
- Method: {method}
- Host: {host}
- Path: {path}
- Status Code: {response_status or 'Unknown'}
"""

    if query_params:
        prompt += f"- Query Parameters: {', '.join(query_params)}\n"

    if request_body:
        prompt += f"\n**Request Payload:**\n```\n{request_body}\n```\n"

    if response_body:
        prompt += f"\n**Response Payload:**\n```\n{response_body}\n```\n"

    prompt += """
Provide a concise analysis in JSON format. Be brief and direct:

{
"summary": "One sentence: what this endpoint does",
"parameters": [{"name": "param", "type": "string", "description": "short desc"}],
"returns": "Brief description of response",
"notes": "Any important details (authentication, side effects, etc.)"
}

Keep all descriptions under 15 words. Focus only on what's clearly visible in the data.
"""
    return prompt


def _parse_llm_response(llm_text: str) -> dict:
    """Parse LLM response and extract JSON."""
    try:
        # Try to find JSON in the response
        # LLM might wrap it in ```json``` code blocks
        if "```json" in llm_text:
            json_start = llm_text.find("```json") + 7
            json_end = llm_text.find("```", json_start)
            json_str = llm_text[json_start:json_end].strip()
        elif "```" in llm_text:
            json_start = llm_text.find("```") + 3
            json_end = llm_text.find("```", json_start)
            json_str = llm_text[json_start:json_end].strip()
        else:
            json_str = llm_text.strip()

        parsed = json.loads(json_str)
        return parsed
    except Exception as e:
        print(f"[WARNING] Failed to parse LLM JSON response: {e}")
        # Return raw text if parsing fails
        return {
            "description": llm_text[:500],  # First 500 chars
            "raw_response": llm_text
        }


class BedrockAPIAnalyzer:
    """Analyzes API endpoints using AWS Bedrock with Claude."""

    def __init__(self, region_name: str = "us-east-1", model_id: str = "us.anthropic.claude-3-5-sonnet-20241022-v2:0"):
        """
        Initialize Bedrock client.

        Args:
            region_name: AWS region for Bedrock
            model_id: Claude model ID (using cross-region inference profile)
        """
        self.bedrock_runtime = boto3.client(
            service_name='bedrock-runtime',
            region_name=region_name
        )
        self.model_id = model_id

    async def generate_api_description(
        self,
        method: str,
        path: str,
        host: str,
        request_body: Optional[str] = None,
        response_body: Optional[str] = None,
        response_status: Optional[int] = None,
        query_params: Optional[list] = None,
    ) -> dict:
        """
        Generate API description using Claude via Bedrock.

        Args:
            method: HTTP method (GET, POST, etc.)
            path: API path template
            host: API host
            request_body: Request payload (if available)
            response_body: Response payload (if available)
            response_status: HTTP status code
            query_params: List of query parameter names

        Returns:
            Dict with:
                - description: Natural language description
                - purpose: What the endpoint does
                - parameters: Input parameters analysis
                - response_schema: Response structure
                - example_use_case: Example usage
        """
        # Build prompt
        prompt = _build_prompt(
            method, path, host, request_body, response_body,
            response_status, query_params
        )

        # Prepare request for Claude via Bedrock
        request_body_bedrock = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2000,
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": 0.3,  # Lower temperature for more focused analysis
        }

        try:
            # Invoke model
            response = self.bedrock_runtime.invoke_model(
                modelId=self.model_id,
                body=json.dumps(request_body_bedrock)
            )

            # Parse response
            response_body_json = json.loads(response['body'].read())
            content_text = response_body_json['content'][0]['text']

            # Parse the structured response
            return _parse_llm_response(content_text)

        except Exception as e:
            print(f"[ERROR] Bedrock API call failed: {e}")
            return {
                "error": str(e),
                "description": "Failed to generate description"
            }
