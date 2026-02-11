import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

export function useSubscription(user) {
  const [isPro, setIsPro] = useState(false);

  useEffect(() => {
    if (!user) return;
    
    // The extension automatically creates a 'subscriptions' sub-collection
    const subRef = collection(db, "customers", user.uid, "subscriptions");
    const q = query(subRef, where("status", "in", ["active", "trialing"]));

    return onSnapshot(q, (snapshot) => {
      // If the query returns any active subscription, the user is Pro
      setIsPro(!snapshot.empty);
    });
  }, [user]);

  return isPro;
}