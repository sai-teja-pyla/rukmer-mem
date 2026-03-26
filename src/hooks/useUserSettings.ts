import { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';

export interface UserSettings {
  theme: string;
  displayName?: string;
  email?: string;
  aiCreativity?: number;
  notifications?: boolean;
  plan?: string;
  createdAt?: Date;
  [key: string]: any;
}

export function useUserSettings() {
  // 1. INSTANT LOAD: Initialize state from LocalStorage to prevent flashing
  const [settings, setSettings] = useState<UserSettings | null>(() => {
    const savedTheme = localStorage.getItem('appTheme');
    return { theme: savedTheme || 'light' }; // Default if nothing saved
  });
  
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Use auth.currentUser directly — no extra auth listener needed.
    // App.tsx already drives auth state; we just need the Firestore snapshot.
    const user = auth.currentUser;
    if (!user) {
      setSettings(null);
      setLoading(false);
      return;
    }

    const userRef = doc(db, "users", user.uid);
    const unsubscribeSnapshot = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSettings(data);
        if (data.theme) localStorage.setItem('appTheme', data.theme);
      } else {
        const defaults = {
          displayName: user.displayName || "New User",
          email: user.email,
          theme: 'light',
          aiCreativity: 0.7,
          notifications: true,
          plan: "free",
          createdAt: new Date()
        };
        setDoc(userRef, defaults);
        setSettings(defaults);
        localStorage.setItem('appTheme', 'light');
      }
      setLoading(false);
    });

    return () => unsubscribeSnapshot();
  }, []);

  // 3. UPDATE FUNCTION
  const updateSettings = async (newSettings: Partial<UserSettings>) => {
    if (!auth.currentUser) return;
    
    // Optimistic Update: Update UI & LocalStorage instantly
    setSettings(prev => {
        const updated = { ...prev, ...newSettings };
        if (newSettings.theme) {
            localStorage.setItem('appTheme', newSettings.theme);
        }
        return updated;
    });

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        await setDoc(userRef, newSettings, { merge: true });
    } catch (error) {
        console.error("Error updating settings:", error);
    }
  };

  return { settings, updateSettings, loading };
}