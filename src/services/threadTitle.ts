export function threadTitle(value: string, limit = 42) {
  const collapsed = String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!collapsed) return 'New chat';
  if (collapsed.length <= limit) return collapsed;
  const room = Math.max(1, limit - 1);
  const slice = collapsed.slice(0, room);
  const breakAt = slice.lastIndexOf(' ');
  const base = (breakAt > 8 ? slice.slice(0, breakAt) : slice).replace(/[\s.,;:!?-]+$/g, '').trim();
  return `${base || slice.trim()}…`;
}

export function titleAfterSend(current: { title: string; messages: { role: string }[] }, value: string) {
  const named = current.messages.some((message) => message.role === 'user') || (current.title && current.title !== 'New chat');
  return named ? current.title : threadTitle(value);
}
