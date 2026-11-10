/** A client-supplied user id is a claim. Empty means "use the session". Anything else must match. */
export function claimedUserMismatch(sessionUid: string, claimed: unknown) {
  const value = String(claimed ?? '').trim();
  if (!value) return false;
  return value !== String(sessionUid || '').trim();
}
