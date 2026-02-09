import { useState, useEffect, useLayoutEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'; 
import { auth } from './firebase'; 
import { onAuthStateChanged } from 'firebase/auth';

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

// Hook Import
import { useUserSettings } from './hooks/useUserSettings';

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  // 1. Get User Settings
  const { settings } = useUserSettings(); 

  // 2. THEME SYNC: useLayoutEffect prevents the "White Flash"
  useLayoutEffect(() => {
    // Priority: 1. DB Setting -> 2. LocalStorage Cache -> 3. Default Light
    const targetTheme = settings?.theme || localStorage.getItem('appTheme') || 'light';

    if (targetTheme === 'dark') {
      document.body.classList.add('dark-mode');
      document.body.classList.remove('light-mode');
      // Force instant background color paint
      document.body.style.backgroundColor = '#0f0f0f'; 
    } else {
      document.body.classList.add('light-mode');
      document.body.classList.remove('dark-mode');
      // Force instant background color paint
      document.body.style.backgroundColor = '#f8fafc'; 
    }
  }, [settings?.theme]);

  // 3. Auth Listener (Standard useEffect is fine here)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser({
          name: currentUser.displayName || currentUser.email.split('@')[0],
          email: currentUser.email,
          photo: currentUser.photoURL,
          uid: currentUser.uid
        });
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 4. Loading Screen
  if (authLoading) {
    // We check local storage here to ensure the loading screen matches the theme too
    const isDark = localStorage.getItem('appTheme') === 'dark';
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-[#0f0f0f]' : 'bg-slate-50'}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // 5. The Router
  return (
    <BrowserRouter>
      <Routes>
        
        {/* --- Public Routes --- */}
        <Route 
          path="/" 
          element={!user ? <LandingPage /> : <Navigate to="/dashboard" />} 
        />
        <Route 
          path="/login" 
          element={!user ? <LoginPage /> : <Navigate to="/dashboard" />} 
        />
        <Route 
          path="/signup" 
          element={!user ? <SignupPage /> : <Navigate to="/dashboard" />} 
        />
        <Route 
          path="/privacy" 
          element={<PrivacyPage />} 
        />
        <Route 
          path="/terms" 
          element={<TermsPage />} 
        />

        {/* --- Protected Routes --- */}
        <Route 
          path="/dashboard" 
          element={user ? <Dashboard user={user} /> : <Navigate to="/" />} 
        />
        <Route 
          path="/settings" 
          element={user ? <SettingsPage /> : <Navigate to="/" />} 
        />
        <Route 
          path="/help" 
          element={user ? <HelpPage /> : <Navigate to="/" />} 
        />
        <Route 
          path="/docs" 
          element={user ? <DocsPage /> : <Navigate to="/" />} 
        />

      </Routes>
    </BrowserRouter>
  );
}