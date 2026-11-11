export function redactSecrets(text: string) {
  return String(text || '')
    .replace(/([?&#](?:token|key|code|session|auth|password|secret|sig|signature)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/\b(?:otp|passcode|pin|security code|verification code|one[- ]time code)\s*(?:is|:)?\s*[A-Z0-9-]{4,10}\b/gi, (match) =>
      match.replace(/[A-Z0-9-]{4,10}$/i, '[redacted]')
    )
    .replace(/\b\d{4,8}\b/g, (digits, offset, all) => {
      const around = String(all).slice(Math.max(0, Number(offset) - 48), Number(offset) + digits.length + 16).toLowerCase();
      return /code|otp|verify|verification|pin|passcode|2fa|two-factor|one-time/.test(around) ? '[redacted]' : digits;
    })
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]');
}

export function shouldSkipEmail(input: { subject?: string; body?: string; keywords?: string[] }) {
  const hay = `${input.subject || ''}\n${input.body || ''}`.toLowerCase();
  const rules: [RegExp, string][] = [
    [/one[- ]time|otp|verification code|security code|login code|passcode/, 'one-time code'],
    [/password reset|reset your password|forgot your password|set a new password/, 'password reset'],
    [/verify your (email|account)|verification link|confirm your email/, 'verification'],
    [/bank statement|payment statement|billing statement|card ending in|direct deposit/, 'payment statement'],
  ];
  for (const [rule, reason] of rules) {
    if (rule.test(hay)) return { skip: true, reason };
  }
  for (const word of input.keywords || []) {
    const needle = word.trim().toLowerCase();
    if (needle && hay.includes(needle)) return { skip: true, reason: 'keyword' };
  }
  return { skip: false, reason: '' };
}

export function gmailImportant(input: { starred?: boolean; important?: boolean; from?: string; labels?: string[]; senders?: string[]; wantedLabels?: string[] }) {
  if (input.starred || input.important) return true;
  const from = String(input.from || '').toLowerCase();
  if ((input.senders || []).some((sender) => sender.trim() && from.includes(sender.trim().toLowerCase()))) return true;
  const labels = (input.labels || []).map((label) => label.toLowerCase());
  return (input.wantedLabels || []).some((label) => label.trim() && labels.includes(label.trim().toLowerCase()));
}
