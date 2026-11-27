export type ModelChoice = { id: string; label: string; provider: 'gemini' | 'openai' | 'anthropic' | 'grok' };

export const MODEL_CATALOG: ModelChoice[] = [
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', provider: 'gemini' },
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', provider: 'gemini' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', provider: 'gemini' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'anthropic' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic' },
  { id: 'gpt-6.2-astra', label: 'GPT 6.2 Astra', provider: 'openai' },
  { id: 'grok-4.7', label: 'Grok 4.7', provider: 'grok' },
];

const LEGACY: Record<string, string> = {
  'gemini-3.8-flash': 'gemini-4-hydrogen',
  'gemini-2.5-flash': 'gemini-4-hydrogen',
  'gemini-flash-latest': 'gemini-4-hydrogen',
  'gpt-4o': 'gpt-6.2-astra',
  'gpt-4o-mini': 'gpt-6.2-astra',
  'claude-sonnet-4-5': 'claude-sonnet-5-5',
  'claude-3-5-haiku-latest': 'claude-haiku-5-5',
  'grok-3': 'grok-4.7',
  'grok-3-mini': 'grok-4.7',
};

export function currentModel(id: string) {
  const raw = String(id || '').trim();
  return LEGACY[raw] || raw;
}

export function geminiTryList(model: string) {
  return [...new Set([currentModel(model), 'gemini-4-hydrogen', 'gemini-4-carbon', 'gemini-3.5-flash-lite'])];
}
