import { db } from '../firebase';
import { collection, addDoc, onSnapshot } from 'firebase/firestore';

export const handleUpgrade = async (userId, priceId) => {
  // 1. Create a checkout session document for the user
  const docRef = await addDoc(
    collection(db, "customers", userId, "checkout_sessions"),
    {
      price: priceId,
      allow_promotion_codes: true,
      success_url: window.location.origin + '/dashboard?payment=success',
      cancel_url: window.location.origin + '/dashboard?payment=cancelled',
    }
  );

  // 2. Wait for the Extension to add a sessionId or URL to this document
  onSnapshot(docRef, (snap) => {
    const data = snap.data();
    if (data?.error) {
      console.error(`Stripe Error: ${data.error.message}`);
    }
    if (data?.url) {
      // 3. Redirect to the secure Stripe Checkout page
      window.open(data.url, '_blank', 'noopener,noreferrer');
    }
  });
};

