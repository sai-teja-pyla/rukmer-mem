export type AiAppId = 'claude' | 'chatgpt' | 'gemini' | 'grok';

export function mcpUrl() {
  if (typeof window === 'undefined') return 'https://app.rukmer.com/mcp';
  return `${window.location.origin}/mcp`;
}

export function mcpUrlWithKey(secret?: string) {
  const url = mcpUrl();
  const key = String(secret || '').trim();
  if (!key.startsWith('rk_live_')) return url;
  return `${url}?api_key=${encodeURIComponent(key)}`;
}

export function openApiUrl() {
  if (typeof window === 'undefined') return 'https://app.rukmer.com/v4/openai.json';
  return `${window.location.origin}/v4/openai.json`;
}

export function clearStoredConnectorFlags() {
  try {
    localStorage.removeItem('rukmer.aiConnectors');
  } catch {
    /* ignore */
  }
}
