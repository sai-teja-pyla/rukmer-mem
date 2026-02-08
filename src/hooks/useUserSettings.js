import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase'; // <--- Ensure this path is correct for your project
import { useAuthState } from 'react-firebase-hooks/auth';

export function useUserSettings() {
  const [user] = useAuthState(auth);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  // 1. Fetch settings when user logs in
  useEffect(() => {
    async function fetchSettings() {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(userRef);

        if (docSnap.exists()) {
          // User exists -> Load data
          setSettings(docSnap.data());
        } else {
          // New User -> Create default profile
          const defaults = {
            displayName: user.displayName || "New User",
            email: user.email,
            photoURL: user.photoURL || "",
            theme: "dark",          // Default to dark mode
            aiCreativity: 0.7,      // Default AI creativity
            notifications: true,
            plan: "free",
            createdAt: new Date()
          };
          await setDoc(userRef, defaults);
          setSettings(defaults);
        }
      } catch (error) {
        console.error("Error fetching user settings:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, [user]);

  // 2. Function to update settings
  const updateSettings = async (newSettings) => {
    if (!user) return;

    // Optimistic Update: Update UI instantly
    setSettings((prev) => ({ ...prev, ...newSettings }));

    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, newSettings);
    } catch (error) {
      console.error("Error saving settings:", error);
      // Optional: Add toast notification for error here
    }
  };

  return { settings, updateSettings, loading, user };
}