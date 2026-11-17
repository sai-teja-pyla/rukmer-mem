export function friendlyModelError(message: string) {
  const text = String(message || '');
  if (/openai/i.test(text) && /api key/i.test(text)) return 'Add an OpenAI API key to use this model. Open the plug icon or Settings → Advanced.';
  if (/anthropic/i.test(text) && /api key/i.test(text)) return 'Add an Anthropic API key to use this model. Open the plug icon or Settings → Advanced.';
  if (/\bxai\b|grok/i.test(text) && /api key/i.test(text)) return 'Add an xAI API key to use this model. Open the plug icon or Settings → Advanced.';
  if (/gemini/i.test(text) && /api key/i.test(text)) return 'Add a Gemini API key to use this model. Open the plug icon or Settings → Advanced.';
  if (/api key/i.test(text)) return 'Add a provider API key to use this model. Open the plug icon or Settings → Advanced.';
  return text || 'Memory engine is unreachable.';
}

export function isRawKeyError(text: string) {
  return /missing api key/i.test(String(text || ''));
}
