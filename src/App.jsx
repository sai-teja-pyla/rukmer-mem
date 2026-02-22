import { useState, useEffect, useLayoutEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'; 
import { auth, db } from './firebase'; // Ensure db is imported
import { onAuthStateChanged } from 'firebase/auth';
import { collection, query, where, onSnapshot } from 'firebase/firestore'; // For global Pro check

// Page Imports
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import SettingsPage from './pages/SettingsPage'; 
import HelpPage from './pages/HelpPage';
import DocsPage from './pages/DocsPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage'; 
import SubscriptionPage from './pages/SubscriptionPage';
import { initAnalytics } from './hooks/analytics';

// Hook Import
import { useUserSettings } from './hooks/useUserSettings';

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isPro, setIsPro] = useState(false); // Global Pro status
  
  const { settings } = useUserSettings();

  // Initialize Google Analytics on app load
  useEffect(() => {
    initAnalytics('G-1XG5ZEVHB4');
  }, []);

  // 1. THEME SYNC
  useLayoutEffect(() => {
    const targetTheme = settings?.theme || localStorage.getItem('appTheme') || 'light';
    if (targetTheme === 'dark') {
      document.body.classList.add('dark-mode');
      document.body.classList.remove('light-mode');
      document.body.style.backgroundColor = '#0f0f0f'; 
    } else {
      document.body.classList.add('light-mode');
      document.body.classList.remove('dark-mode');
      document.body.style.backgroundColor = '#f8fafc'; 
    }
  }, [settings?.theme]);

  // 2. Auth & Subscription Listener
  useEffect(() => {
    let unsubscribeSub = () => {};

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        console.log("👤 User authenticated:", currentUser.email);
        setUser({
          name: currentUser.displayName || (currentUser?.email?.includes('@') ? currentUser.email.split('@')[0] : 'Guest User'),
          email: currentUser.email,
          photo: currentUser.photoURL,
          uid: currentUser.uid
        });

        // Start listening to subscription status as soon as we have a user
        const subRef = collection(db, "customers", currentUser.uid, "subscriptions");
        const q = query(subRef, where("status", "in", ["active", "trialing"]));
        
        console.log("🔍 Starting Firestore subscription query for:", currentUser.uid);
        unsubscribeSub = onSnapshot(q, (snapshot) => {
          const newIsPro = !snapshot.empty;
          console.log("📊 Firestore subscription query result:", newIsPro ? "✅ PRO" : "❌ FREE", "- Docs found:", snapshot.docs.length);
          if (snapshot.docs.length > 0) {
            console.log("📋 Subscription docs:", snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })));
          }
          setIsPro(newIsPro);
        }, (error) => {
          console.error("🚨 Firestore subscription error:", error);
          setIsPro(false);
        });

      } else {
        setUser(null);
        setIsPro(false);
        unsubscribeSub();
      }
      setAuthLoading(false);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeSub();
    };
  }, []);

  // 3. Loading Screen
  if (authLoading) {
    const isDark = localStorage.getItem('appTheme') === 'dark';
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-[#0f0f0f]' : 'bg-slate-50'}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#7c3aed]"></div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={!user ? <LandingPage /> : <Navigate to="/dashboard" replace />} />
        <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/dashboard" replace />} />
        <Route path="/signup" element={!user ? <SignupPage /> : <Navigate to="/dashboard" replace />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />

        {/* Protected Routes - Passing isPro globally */}
        <Route 
          path="/dashboard" 
          element={user ? <Dashboard user={user} isPro={isPro} /> : <Navigate to="/" replace />} 
        />
        <Route 
          path="/settings" 
          element={user ? <SettingsPage user={user} isPro={isPro} /> : <Navigate to="/" replace />} 
        />
        <Route path="/help" element={user ? <HelpPage /> : <Navigate to="/" replace />} />
        <Route path="/docs" element={user ? <DocsPage /> : <Navigate to="/" replace />} />

        {/* Subscription Management */}
        <Route 
          path="/subscription" 
          element={user ? <SubscriptionPage user={user} isPro={isPro} /> : <Navigate to="/" replace />} 
        />

        {/* Fallback for undefined routes */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}