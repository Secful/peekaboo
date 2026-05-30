"""AWS Bedrock integration for LLM-powered API analysis."""

import json
import logging
import time
import boto3
from botocore.exceptions import ClientError
from typing import Optional

# Set up logger
logger = logging.getLogger(__name__)


def _trim_payload(payload: Optional[str], max_chars: int = 3000) -> Optional[str]:
    """Trim payload to prevent token limit errors while preserving useful context."""
    if not payload or len(payload) <= max_chars:
        return payload
    return payload[:max_chars] + "\n... [truncated for brevity]"


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
        trimmed_request = _trim_payload(request_body)
        prompt += f"\n**Request Payload:**\n```\n{trimmed_request}\n```\n"

    if response_body:
        trimmed_response = _trim_payload(response_body)
        prompt += f"\n**Response Payload:**\n```\n{trimmed_response}\n```\n"

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
        logger.warning(f"Failed to parse LLM JSON response: {e}")
        # Return raw text if parsing fails
        return {
            "description": llm_text[:500],  # First 500 chars
            "raw_response": llm_text
        }


class BedrockAPIAnalyzer:
    """Analyzes API endpoints using AWS Bedrock with Claude."""

    def __init__(self, region_name: str = "us-east-1", model_id: str = "us.anthropic.claude-sonnet-4-5-20250929-v1:0") -> None:
        """
        Initialize Bedrock client.

        Args:
            region_name: AWS region for Bedrock
            model_id: Claude model ID
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
            parsed = _parse_llm_response(content_text)
            # Add source indicator
            parsed['source'] = 'bedrock'
            return parsed

        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_msg = e.response['Error']['Message']

            if error_code == 'ResourceNotFoundException':
                logger.error(f"Bedrock model not found: {self.model_id} - {error_msg}")
                return {
                    "error": f"Model Not Found: {self.model_id}",
                    "source": "bedrock",
                    "description": (
                        "This usually means:\n"
                        "• The model version has reached end of life\n"
                        "• The model is not enabled in your AWS account\n"
                        "• The model is not available in your region\n\n"
                        "To fix this:\n"
                        "1. Go to AWS Bedrock Console → Model access\n"
                        "2. Enable 'Anthropic Claude 3.5 Sonnet' models\n"
                        "3. Or update the model ID in bedrock_analyzer.py line 87\n\n"
                        f"AWS Region: {self.bedrock_runtime.meta.region_name}\n\n"
                        "Valid model IDs:\n"
                        "• us.anthropic.claude-sonnet-4-5-20250929-v1:0 (current)\n"
                        "• anthropic.claude-3-5-sonnet-20240620-v1:0\n"
                        "• anthropic.claude-3-sonnet-20240229-v1:0"
                    )
                }
            elif error_code == 'ValidationException':
                logger.error(f"Bedrock validation error: {error_msg}")
                return {
                    "error": f"Invalid Model ID: {self.model_id}",
                    "source": "bedrock",
                    "description": (
                        "The model identifier is not valid.\n\n"
                        "Valid model IDs:\n"
                        "• us.anthropic.claude-sonnet-4-5-20250929-v1:0 (current)\n"
                        "• anthropic.claude-3-5-sonnet-20240620-v1:0\n"
                        "• anthropic.claude-3-sonnet-20240229-v1:0\n\n"
                        "Update the model ID in bedrock_analyzer.py line 87"
                    )
                }
            elif error_code == 'AccessDeniedException':
                logger.error(f"Bedrock access denied: {error_msg}")
                return {
                    "error": "AWS Permissions Error",
                    "source": "bedrock",
                    "description": (
                        "The AWS credentials don't have permission to invoke Bedrock models.\n\n"
                        "Required permissions:\n"
                        "• bedrock:InvokeModel\n"
                        "• bedrock:InvokeModelWithResponseStream\n\n"
                        "Contact your AWS administrator to add these permissions."
                    )
                }
            else:
                logger.error(f"Bedrock API call failed [{error_code}]: {error_msg}")
                return {
                    "error": f"AWS Bedrock Error ({error_code})",
                    "source": "bedrock",
                    "description": error_msg
                }

        except Exception as e:
            logger.error(f"Unexpected error in Bedrock call: {e}", exc_info=True)
            return {
                "error": "Unexpected Error",
                "source": "bedrock",
                "description": f"Failed to generate description: {str(e)}"
            }

    async def explain_ws_payload(
        self,
        payload: str,
        host: str,
        path: str,
    ) -> str:
        """
        Explain WebSocket payload using Claude via Bedrock.

        Args:
            payload: WebSocket message payload
            host: WebSocket host
            path: WebSocket path

        Returns:
            Plain text explanation (2-3 sentences)
        """
        prompt = f"""Analyze this WebSocket payload from {host}{path}:

{payload}

Provide a concise explanation (2-3 sentences) covering:
1. What data this payload contains
2. Its likely purpose in the WebSocket communication

Response format: plain text, no JSON."""

        request_body_bedrock = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 500,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
        }

        try:
            response = self.bedrock_runtime.invoke_model(
                modelId=self.model_id,
                body=json.dumps(request_body_bedrock)
            )
            response_body_json = json.loads(response['body'].read())
            return response_body_json['content'][0]['text']

        except Exception as e:
            logger.error(f"Failed to explain WebSocket payload: {e}")
            return f"Error: {str(e)}"

    async def describe_services(
        self,
        target_domain: str,
        hostnames: list[str],
    ) -> dict:
        """
        Batch-describe external service domains using a single LLM call.

        Returns:
            Dict mapping hostname -> short description string.
        """
        if not hostnames:
            return {}

        numbered = "\n".join(f"{i+1}. {h}" for i, h in enumerate(hostnames))
        prompt = (
            f'You are a web service classification expert. A website at "{target_domain}" '
            f"communicates with these external domains. For each, provide a short description "
            f"(under 12 words).\n\n"
            f"External domains:\n{numbered}\n\n"
            f'Respond in JSON only: {{"domain1": "Service — what it does", ...}}\n'
            f"Rules: Start with service/company name, then dash, then what it does. "
            f'If unknown, write "Unknown service". Return valid JSON only.'
        )

        request_body_bedrock = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 4000,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
        }

        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = self.bedrock_runtime.invoke_model(
                    modelId=self.model_id,
                    body=json.dumps(request_body_bedrock),
                )
                response_body_json = json.loads(response["body"].read())
                content_text = response_body_json["content"][0]["text"]
                parsed = _parse_llm_response(content_text)
                # Ensure we return a flat dict of host->description strings
                if isinstance(parsed, dict) and not any(
                    k in parsed for k in ("description", "raw_response", "error")
                ):
                    return parsed
                return {}
            except ClientError as e:
                error_code = e.response["Error"]["Code"]
                if error_code == "ThrottlingException" and attempt < max_retries - 1:
                    wait = 2 ** (attempt + 1)
                    logger.warning(f"Bedrock throttled, retrying in {wait}s (attempt {attempt + 1}/{max_retries})")
                    time.sleep(wait)
                    continue
                # Log detailed error but return empty dict for batch operations
                error_msg = e.response["Error"]["Message"]
                logger.error(f"Bedrock describe_services call failed [{error_code}]: {error_msg}")
                return {}
            except Exception as e:
                logger.error(f"Bedrock describe_services call failed: {e}", exc_info=True)
                return {}

    async def verify_secret_risk(
        self,
        secret_value: str,
        code_snippet: str,
        vendor: str,
        classification: str,
        file_url: str,
    ) -> dict:
        """
        Verify if detected secret is truly sensitive using LLM analysis of context.

        Args:
            secret_value: The detected secret
            code_snippet: Code context around secret
            vendor: Secret type (e.g., "AWS Access Key", "Generic API Key")
            classification: Current classification ("private", "public", "uncertain")
            file_url: Source file URL

        Returns:
            dict with: is_sensitive (bool), confidence (high/medium/low), reasoning (str), recommended_action (str)
        """
        prompt = f"""You are a security analyst. Analyze if this detected secret is truly sensitive.

Secret Type: {vendor}
Current Classification: {classification}
Value: {secret_value[:20]}...
File: {file_url}

Code Context:
```
{code_snippet[:1000]}
```

Determine:
- True Secret: Private credential that should NOT be in client-side code
- Public Key: Intentionally public identifier (analytics, tracking, client IDs)
- False Positive: Not a real secret

Common public keys: Google Analytics, PostHog (phc_*), Sentry DSN, Stripe public keys (pk_*)

CRITICAL: You MUST respond with ONLY valid JSON. No markdown, no explanation, no code blocks. Just the JSON object below:

{{"is_sensitive": true, "confidence": "high", "reasoning": "Brief explanation", "recommended_action": "rotate immediately"}}

OR

{{"is_sensitive": false, "confidence": "high", "reasoning": "Brief explanation", "recommended_action": "safe to expose"}}

JSON response:"""

        try:
            start = time.time()
            response = self.bedrock_runtime.invoke_model(
                modelId=self.model_id,
                contentType="application/json",
                accept="application/json",
                body=json.dumps({
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 800,
                    "temperature": 0.3,
                    "messages": [{"role": "user", "content": prompt}]
                })
            )
            duration = time.time() - start

            response_body = json.loads(response['body'].read())
            content = response_body['content'][0]['text'].strip()

            logger.info(f"Secret verification took {duration:.2f}s")
            logger.info(f"LLM raw response: {content!r}")

            # Try parsing JSON - handle markdown wrappers
            json_str = content
            if content.startswith('```'):
                # Strip markdown code blocks
                lines = content.split('\n')
                json_str = '\n'.join(lines[1:-1]) if len(lines) > 2 else content
                json_str = json_str.replace('```json', '').replace('```', '').strip()

            result = json.loads(json_str)
            return result

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Bedrock secret verification response: {e}")
            logger.error(f"Raw content that failed: {content!r}")
            return {
                "is_sensitive": classification == "private",  # Fallback to original classification
                "confidence": "low",
                "reasoning": "LLM response parsing failed",
                "recommended_action": "manual review required"
            }
        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            error_msg = e.response["Error"]["Message"]
            logger.error(f"Bedrock secret verification failed [{error_code}]: {error_msg}")
            return {
                "is_sensitive": classification == "private",
                "confidence": "low",
                "reasoning": "LLM analysis unavailable",
                "recommended_action": "manual review required"
            }
        except Exception as e:
            logger.error(f"Bedrock secret verification failed: {e}", exc_info=True)
            return {
                "is_sensitive": classification == "private",
                "confidence": "low",
                "reasoning": "Verification error",
                "recommended_action": "manual review required"
            }
