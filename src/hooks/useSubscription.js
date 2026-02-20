import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

export function useSubscription(user) {
  const [isPro, setIsPro] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsPro(false);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    
    // The extension automatically creates a 'subscriptions' sub-collection
    const subRef = collection(db, "customers", user.uid, "subscriptions");
    const q = query(subRef, where("status", "in", ["active", "trialing"]));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      // If the query returns any active subscription, the user is Pro
      const hasActiveSub = !snapshot.empty;
      setIsPro(hasActiveSub);
      setIsLoading(false);
      
      if (hasActiveSub) {
        console.log("✅ User is Pro (Firestore)");
      } else {
        console.log("⏳ No active subscription in Firestore, checking backend...");
        // Fallback: Check backend if Firestore sync is delayed
        checkBackendProStatus(user.uid);
      }
    }, (error) => {
      console.warn("⚠️  Firestore subscription query failed:", error);
      setIsLoading(false);
      // Fallback to backend check
      checkBackendProStatus(user.uid);
    });

    return unsubscribe;
  }, [user]);

  const checkBackendProStatus = async (userId) => {
    try {
      const token = await user?.getIdToken();
      const response = await fetch(`http://localhost:5001/api/user-status/${userId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log("📊 Backend user status:", data);
        setIsPro(data.isPro);
      }
    } catch (error) {
      console.warn("Backend status check failed:", error);
    }
  };

  return { isPro, isLoading };
}