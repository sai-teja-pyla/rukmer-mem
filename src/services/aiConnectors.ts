const STORAGE_KEY = 'rukmer.aiConnectors';

export type AiAppId = 'claude' | 'chatgpt' | 'gemini' | 'grok';

export function mcpUrl() {
  if (typeof window === 'undefined') return 'https://app.rukmer.com/mcp';
  return `${window.location.origin}/mcp`;
}

export function openApiUrl() {
  if (typeof window === 'undefined') return 'https://app.rukmer.com/v4/openai.json';
  return `${window.location.origin}/v4/openai.json`;
}

export function loadConnectedApps(): AiAppId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setAppConnected(id: AiAppId, on: boolean) {
  const next = new Set(loadConnectedApps());
  if (on) next.add(id);
  else next.delete(id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  return [...next];
}
