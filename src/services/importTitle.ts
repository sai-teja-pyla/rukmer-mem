export function importTitle(title: string, text: string) {
  const given = String(title || '').trim();
  if (given) return given.slice(0, 120);
  const line = String(text || '').split(/\n/)[0].replace(/\s+/g, ' ').trim().slice(0, 80);
  return line || 'Note';
}

export const CHAT_SOURCES = new Set(['gemini-router', 'openai-router', 'anthropic-router', 'grok-router', 'conversation', 'playground']);

export function isChatDump(source: string) {
  return CHAT_SOURCES.has(String(source || ''));
}
