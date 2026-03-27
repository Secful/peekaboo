/* PII, AI keywords and explanation lookup tables */

const PII_KEYWORDS = [
  'email','password','passwd','pwd','ssn','social_security','credit_card',
  'card_number','cvv','cvc','expir','phone','mobile_number','mobile_phone',
  'cell_phone','street_address','home_address','billing_address',
  'shipping_address','mailing_address','zipcode','zip_code','postal_code',
  'date_of_birth','dob','birth_date','first_name','last_name','full_name',
  'username','login','credential','secret','token','api_key','apikey',
  'auth_token','access_token','accesstoken','refresh_token','refreshtoken',
  'session','passport',
  'driver_license','national_id','tax_id','bank_account','routing_number',
  'iban','swift','salary','income','medical','health_record','health_info',
  'health_condition','diagnosis','patient','insurance','beneficiary',
  'biometric','fingerprint','face_id','geolocation',
];

const AI_KEYWORDS = [
  'llm','gpt','openai','claude','anthropic','gemini','bedrock','sagemaker',
  'genai','gen-ai','copilot','langchain','langgraph','langsmith',
  'huggingface','ollama','mistral','cohere','replicate','deepseek','groq',
  'vertex','agentic','mcp','model-context','embedding','vector','rag',
  'prompt','inference','transformer','neural','chatbot','chat-completion',
  'completion','fine-tune','finetune','diffusion','stable-diffusion',
  'midjourney','dall-e','whisper','tokenize','mlflow','predict',
  'tensorflow','pytorch','keras',
];
const AI_BOUNDED = ['ai','ml','nlp','agent'];

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
