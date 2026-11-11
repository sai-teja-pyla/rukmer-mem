export const DEFAULT_BLOCK = [
  'chase.com',
  'bankofamerica.com',
  'wellsfargo.com',
  'citi.com',
  'capitalone.com',
  'americanexpress.com',
  'paypal.com',
  'venmo.com',
  'stripe.com',
  'mychart.com',
  'kaiserpermanente.org',
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'mail.yahoo.com',
  '1password.com',
  'lastpass.com',
  'bitwarden.com',
  'dashlane.com',
  'x.com',
  'twitter.com',
  'instructure.com',
];

const LOGIN_PATH = /\/(login|signin|sign-in|checkout|password)(\/|$)/i;

export type BlockPolicy = {
  blocklist: string[];
  removedDefaults: string[];
  allowlistOnly: boolean;
  allowlist: string[];
  canvasDomain: string;
  gmail: boolean;
  canvas: boolean;
  x: boolean;
};

export function hostMatches(host: string, rule: string) {
  const left = host.toLowerCase().replace(/^www\./, '');
  const right = rule.toLowerCase().trim().replace(/^\*\./, '').replace(/^www\./, '');
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`);
}

export function isBlocked(rawUrl: string, policy: BlockPolicy, site: '' | 'gmail' | 'canvas' | 'x' = '') {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return true;
  }
  if (url.protocol === 'file:' || url.protocol === 'chrome:' || url.protocol === 'chrome-extension:' || url.protocol === 'edge:' || url.protocol === 'about:') {
    return true;
  }
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.local')) {
    return true;
  }
  if (LOGIN_PATH.test(url.pathname)) return true;
  if (site === 'gmail' && policy.gmail && hostMatches(host, 'mail.google.com')) return false;
  if (site === 'canvas' && policy.canvas && (hostMatches(host, 'instructure.com') || (policy.canvasDomain && hostMatches(host, policy.canvasDomain)))) {
    return false;
  }
  if (site === 'x' && policy.x && (hostMatches(host, 'x.com') || hostMatches(host, 'twitter.com'))) return false;
  if (policy.allowlistOnly) return !policy.allowlist.some((rule) => hostMatches(host, rule));
  const defaults = DEFAULT_BLOCK.filter((rule) => !policy.removedDefaults.some((gone) => hostMatches(rule, gone)));
  const extra = [...policy.blocklist];
  if (policy.canvasDomain) extra.push(policy.canvasDomain);
  return [...defaults, ...extra].some((rule) => hostMatches(host, rule));
}

export function hasSecretFields(input: { passwordFields?: number; cardFields?: number }) {
  return Number(input.passwordFields || 0) > 0 || Number(input.cardFields || 0) > 0;
}
