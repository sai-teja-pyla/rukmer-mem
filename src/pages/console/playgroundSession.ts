export type PlayThread = { id: string; title: string; updatedAt: string; messages: { role?: string; text?: string }[] };

export function emptyPlayThread(): PlayThread {
  return { id: `chat_${Date.now()}`, title: 'New chat', updatedAt: new Date().toISOString(), messages: [] };
}

export function threadHasText(thread: PlayThread) {
  return thread.messages.some((message) => String(message.text || '').trim());
}

/** Opening /playground with no thread query starts a new chat and keeps non-empty threads in History. */
export function openPlaygroundSession(saved: PlayThread[], threadQuery = '') {
  const history = saved.filter(threadHasText);
  const requested = threadQuery ? saved.find((thread) => thread.id === threadQuery) : undefined;
  if (requested) return { active: requested, history };
  return { active: emptyPlayThread(), history };
}
