import { serverTimestamp } from 'firebase/firestore';
import { LOI_VERSION } from './loi';

/** Fields written onto the Firestore user record when signup clickwrap is checked. */
export async function loiAcceptanceRecord() {
  let ip = '';
  try {
    const res = await fetch('/v4/client');
    if (res.ok) {
      const data = await res.json();
      ip = String(data.ip || '');
    }
  } catch {
    /* IP is recommended, not required to finish signup. */
  }
  return {
    loiAcceptedAt: serverTimestamp(),
    loiVersion: LOI_VERSION,
    loiAcceptedIp: ip,
    loiAcceptedUserAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  };
}

/** Asks the server to email a copy of the accepted letter. Signup still succeeds if mail is down. */
export async function emailLoiCopy(user: { getIdToken: () => Promise<string>; email?: string | null; displayName?: string | null }) {
  try {
    const token = await user.getIdToken();
    await fetch('/api/loi-accepted', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: user.displayName || '', email: user.email || '' }),
    });
  } catch {
    /* The account is already created. Mail failure must not undo it. */
  }
}
