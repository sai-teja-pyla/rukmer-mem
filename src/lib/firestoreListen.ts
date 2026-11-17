import { onAuthStateChanged, type User } from 'firebase/auth';
import { onSnapshot, type DocumentReference, type Unsubscribe } from 'firebase/firestore';
import { auth } from '../firebase';

const logged = new Set<string>();

export function isConsolePath(pathname: string) {
  return [
    '/overview',
    '/playground',
    '/container-tags',
    '/memory-graph',
    '/connectors',
    '/import',
    '/api-keys',
    '/agents-mcp',
    '/requests',
    '/insights',
    '/settings',
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function validDocId(id: string) {
  return typeof id === 'string' && id.length > 0 && !id.includes('/');
}

function fatalListen(error: { code?: string }) {
  return error.code === 'permission-denied' || error.code === 'invalid-argument';
}

function logListenOnce(path: string, error: { code?: string; message?: string }) {
  const key = `${path}:${error.code || 'error'}`;
  if (logged.has(key)) return;
  logged.add(key);
  console.error(`Firestore listen stopped for ${path}`, error.code || error.message || 'error');
}

/** Listen only after auth has a user. Fatal errors log once and unsubscribe. */
export function listenForUser(
  path: string,
  refFor: (user: User) => DocumentReference | null,
  onNext: (snap: { exists: () => boolean; data: () => Record<string, unknown> | undefined }, user: User) => void,
  onIdle?: () => void
): Unsubscribe {
  let stopSnap: Unsubscribe = () => {};
  const stopAuth = onAuthStateChanged(auth, (user) => {
    stopSnap();
    stopSnap = () => {};
    if (!user || !validDocId(user.uid)) {
      onIdle?.();
      return;
    }
    const ref = refFor(user);
    if (!ref) return;
    const holder: { stop: Unsubscribe } = { stop: () => {} };
    holder.stop = onSnapshot(
      ref,
      (snap) => onNext(snap, user),
      (error) => {
        logListenOnce(path, error);
        if (fatalListen(error)) {
          holder.stop();
          onIdle?.();
        }
      }
    );
    stopSnap = () => holder.stop();
  });
  return () => {
    stopAuth();
    stopSnap();
  };
}
