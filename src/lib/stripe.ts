import { onAuthStateChanged, type User } from 'firebase/auth';
import { addDoc, collection, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { validDocId } from './firestoreListen';

function signedInUser(): Promise<User | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user);
    });
  });
}

export async function handleUpgrade(userId: string, priceId: string): Promise<Unsubscribe> {
  const user = await signedInUser();
  if (!user || user.uid !== userId || !validDocId(user.uid) || !priceId) return () => {};
  const docRef = await addDoc(collection(db, 'customers', user.uid, 'checkout_sessions'), {
    price: priceId,
    allow_promotion_codes: true,
    success_url: window.location.origin + '/dashboard?payment=success',
    cancel_url: window.location.origin + '/dashboard?payment=cancelled',
  });
  const holder: { stop: Unsubscribe } = { stop: () => {} };
  let logged = false;
  holder.stop = onSnapshot(
    docRef,
    (snap) => {
      const data = snap.data();
      if (data?.error) console.error(`Stripe Error: ${data.error.message}`);
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        holder.stop();
      }
    },
    (error) => {
      if (!logged) {
        logged = true;
        console.error('Firestore listen stopped for customers/checkout_sessions', error.code || error.message);
      }
      if (error.code === 'permission-denied' || error.code === 'invalid-argument') holder.stop();
    }
  );
  return () => holder.stop();
}
