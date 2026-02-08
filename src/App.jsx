import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'; // <--- NEW IMPORTS
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import SettingsPage from './pages/SettingsPage'; // <--- Import Settings
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import HelpPage from './pages/HelpPage';
import DocsPage from './pages/DocsPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import PrivacyPage from './pages/PrivacyPage';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // 1. Auth Listener
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
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Loading Screen
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // 3. The Router (Replaces the if/else logic)
  return (
    <BrowserRouter>
      <Routes>
        
        {/* Route 1: Landing Page (Public) */}
        <Route 
          path="/" 
          element={!user ? <LandingPage /> : <Navigate to="/dashboard" />} 
        />

        {/* Route 2: Dashboard (Protected) */}
        <Route 
          path="/dashboard" 
          element={user ? <Dashboard user={user} /> : <Navigate to="/" />} 
        />

        {/* Route 3: Settings (Protected) */}
        <Route 
          path="/settings" 
          element={user ? <SettingsPage /> : <Navigate to="/" />} 
        />
        {/* Route 4: Help (Protected) */}
        <Route 
          path="/help" 
          element={user ? <HelpPage /> : <Navigate to="/" />} 
        />
        {/* Route 5: Docs (Protected) */}
        <Route 
          path="/docs" 
          element={user ? <DocsPage /> : <Navigate to="/" />} 
        />
        {/* Route 6: Login (Public) */}
        <Route 
          path="/login" 
          element={!user ? <LoginPage /> : <Navigate to="/dashboard" />} 
        />
        {/* Route 7: Signup (Public) */}
        <Route 
          path="/signup" 
          element={!user ? <SignupPage /> : <Navigate to="/dashboard" />} 
        />
        {/* Route 8: Privacy Policy (Public) */}
        <Route 
          path="/privacy" 
          element={<PrivacyPage />} 
        />
      </Routes>
    </BrowserRouter>
  );
}