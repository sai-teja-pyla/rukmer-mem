import { useState } from 'react';
import { jwtDecode } from "jwt-decode";
import LandingPage from './components/LandingPage';
// import Dashboard from './components/Dashboard';

export default function App() {
  const [user, setUser] = useState(null);

  const handleLoginSuccess = (credentialResponse) => {
    try {
      const decoded = jwtDecode(credentialResponse.credential);
      console.log("Login Success:", decoded);
      setUser(decoded);
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLoginError = () => {
    console.log('Login Failed');
  };

  const handleLogout = () => {
    setUser(null);
  };

  return (
    <>
      {user ? (
        <Dashboard 
          user={user} 
          onLogout={handleLogout} 
        />
      ) : (
        <LandingPage 
          onLoginSuccess={handleLoginSuccess} 
          onLoginError={handleLoginError} 
        />
      )}
    </>
  );
}