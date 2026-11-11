export function xPostId(url: string) {
  const match = String(url || '').match(/\/status(?:es)?\/(\d+)/);
  return match?.[1] || '';
}

export function xDedupeKey(postId: string, thread = false) {
  const id = String(postId || '').trim();
  if (!/^\d{5,}$/.test(id)) return '';
  return thread ? `browser:xthread:${id}` : `browser:x:${id}`;
}

export function xIsMessages(url: string) {
  try {
    return /\/messages(?:\/|$)/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
