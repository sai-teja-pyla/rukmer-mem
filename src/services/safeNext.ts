export function safeNext(raw: string | null | undefined) {
  if (!raw) return '/overview';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.includes('://') || raw.includes('\\')) {
    return '/overview';
  }
  return raw;
}
