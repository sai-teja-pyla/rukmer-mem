const STORAGE_KEY = 'rukmer.providerKeys';

export type ProviderKeys = {
  openai: string;
  anthropic: string;
  gemini: string;
  grok: string;
};

export const EMPTY_KEYS: ProviderKeys = { openai: '', anthropic: '', gemini: '', grok: '' };

export function loadProviderKeys(): ProviderKeys {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_KEYS };
    return { ...EMPTY_KEYS, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_KEYS };
  }
}

export function saveProviderKeys(keys: ProviderKeys) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function keyHeaders(keys: ProviderKeys, extra?: Record<string, string>) {
  const headers: Record<string, string> = { ...(extra || {}) };
  if (keys.openai) {
    headers['x-openai-key'] = keys.openai;
    headers.Authorization = `Bearer ${keys.openai}`;
  }
  if (keys.anthropic) headers['x-anthropic-key'] = keys.anthropic;
  if (keys.gemini) headers['x-gemini-key'] = keys.gemini;
  if (keys.grok) headers['x-grok-key'] = keys.grok;
  return headers;
}
