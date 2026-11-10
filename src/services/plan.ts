/** Pro comes from the billing record. Missing or free plans stay off. */
export function isProPlan(record: { plan?: unknown; billing?: { plan?: unknown; status?: unknown } | null } | null | undefined) {
  if (!record) return false;
  const plan = String(record.billing?.plan || record.plan || '').trim().toLowerCase();
  if (plan !== 'pro') return false;
  const status = String(record.billing?.status || 'active').trim().toLowerCase();
  return status === 'active' || status === 'trialing';
}
