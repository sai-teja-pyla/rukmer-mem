import { useState, useEffect, useContext, createContext, useCallback } from 'react';
import type { ReactNode } from 'react';
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

interface SettingsContextValue {
  settings: UserSettings | null;
  updateSettings: (newSettings: Partial<UserSettings>) => Promise<void>;
  loading: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: null,
  updateSettings: async () => {},
  loading: true,
});

/**
 * Mount this ONCE near the top of your component tree (e.g. in App.tsx).
 * It creates a single Firestore onSnapshot listener shared by every consumer.
 */
export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserSettings | null>(() => {
    const savedTheme = localStorage.getItem('appTheme');
    return { theme: savedTheme || 'light' };
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

  const updateSettings = useCallback(async (newSettings: Partial<UserSettings>) => {
    if (!auth.currentUser) return;
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      if (newSettings.theme) localStorage.setItem('appTheme', newSettings.theme);
      return updated;
    });
    try {
      const userRef = doc(db, "users", auth.currentUser.uid);
      await setDoc(userRef, newSettings, { merge: true });
    } catch (error) {
      console.error("Error updating settings:", error);
    }
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, loading }}>
      {children}
    </SettingsContext.Provider>
  );
}

/** Read settings from the shared context — zero extra listeners. */
export function useUserSettings() {
  return useContext(SettingsContext);
}