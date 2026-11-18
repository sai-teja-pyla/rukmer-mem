const DB = 'rukmer-team-keys';
const STORE = 'keys';

function bytesToB64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function openKeys() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

export async function saveTeamKey(inviteId: string, privateKey: string) {
  if (!inviteId || typeof indexedDB === 'undefined') return;
  try {
    const db = await openKeys();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(privateKey, inviteId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* private key stays in memory for this page if storage is blocked */
  }
}

/** ECDH P-256 public key for an invite. The private key is stored under the invite id when one is known. */
export async function browserKey(inviteId = '') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await crypto.subtle.exportKey('spki', pair.publicKey);
  const priv = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const publicKey = bytesToB64(pub);
  const privateKey = bytesToB64(priv);
  if (inviteId) await saveTeamKey(inviteId, privateKey);
  return { publicKey, privateKey };
}
