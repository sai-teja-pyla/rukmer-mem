import { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import { auth } from './firebase'; // Import your firebase config
import { onAuthStateChanged, signOut } from 'firebase/auth'; // Import Firebase hooks
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // Prevents "flicker" of login screen

  // 1. The Listener: Automatically detects login/logout
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        console.log("Auth State Changed: User Logged In", currentUser);
        // Normalize user data for your Dashboard
        setUser({
          name: currentUser.displayName || currentUser.email.split('@')[0], // Use email if name is missing
          email: currentUser.email,
          photo: currentUser.photoURL,
          uid: currentUser.uid
        });
      } else {
        console.log("Auth State Changed: User Logged Out");
        setUser(null);
      }
      setLoading(false); // Stop loading once we know the status
    });

    // Cleanup listener on unmount
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth); // Tells Firebase to close session
      setUser(null);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  // 2. Show a loading spinner while Firebase checks if you are logged in
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <>
      {user ? (
        <Dashboard 
          user={user} 
          onLogout={handleLogout} 
        />
      ) : (
        <LandingPage 
          // We don't strictly need to pass data manually anymore because 
          // the useEffect listener above catches the login automatically!
          onLoginSuccess={() => {}} 
        />
      )}
    </>
  );
}