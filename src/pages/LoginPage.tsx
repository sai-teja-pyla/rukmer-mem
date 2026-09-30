import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth } from '../firebase'; 
import { 
  signInWithEmailAndPassword, 
  GoogleAuthProvider, 
  signInWithPopup,
  sendPasswordResetEmail 
} from 'firebase/auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/overview'); 
    } catch (err) {
      setError("Failed to sign in. Check your email/password.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      navigate('/overview'); 
    } catch (err) {
      setError("Google sign-in failed.");
    }
  };

  // --- PASSWORD RESET LOGIC ---
  const handleForgotPassword = async () => {
    if (!email) {
      setError("Please enter your email address first so we can send a reset link.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      alert("🚀 Password reset link sent! Please check your inbox (and spam folder).");
      setError(''); // Clear any previous errors
    } catch (err) {
      console.error("Reset Error:", err);
      if (err.code === 'auth/user-not-found') {
        setError("No account found with this email address.");
      } else {
        setError("Could not send reset email. Please try again later.");
      }
    }
  };

  return (
    <div className="min-h-screen w-full bg-gray-50 flex flex-col">
      
      {/* Main Content Area */}
      <div className="flex-grow flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-gray-100">
          
          {/* Header */}
          <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-900">Welcome back</h2>
              <p className="text-sm text-gray-500 mt-1">Continue your journey</p>
          </div>

          {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                  {error}
              </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white !text-black focus:ring-2 focus:ring-[#7c3aed] focus:border-[#7c3aed] outline-none transition-all placeholder:text-gray-400"
                style={{ color: '#000000' }}
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-bold text-gray-900">Password</label>
                  {/* FORGOT PASSWORD BUTTON */}
                  <button 
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs text-[#7c3aed] font-semibold hover:underline transition-colors"
                  >
                    Forgot?
                  </button>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white !text-black focus:ring-2 focus:ring-[#7c3aed] focus:border-[#7c3aed] outline-none transition-all placeholder:text-gray-400"
                style={{ color: '#000000' }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#7c3aed] hover:bg-[#6d28d9] text-white font-bold py-3.5 rounded-lg shadow-sm disabled:opacity-50 transition-colors"
            >
              {loading ? 'Signing In...' : 'Sign In'}
            </button>

            <button
              type="button"
              onClick={handleGoogleLogin}
              className="w-full bg-white hover:bg-gray-50 text-gray-900 font-medium py-3.5 rounded-lg border border-gray-300 transition-colors flex items-center justify-center gap-2"
            >
              <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5" />
              Continue with Google
            </button>

            <div className="text-center pt-2">
              <Link to="/signup" className="text-[#7c3aed] hover:underline font-bold text-sm">
                New here? Create account
              </Link>
            </div>

            <div className="mt-6 text-center border-t border-gray-100 pt-6">
               <p className="text-sm text-gray-500">
                Welcome back. Please login to your account to continue.
               </p>
            </div>
          </form>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="w-full py-8 border-t border-gray-200 bg-white text-center">
        <div className="flex flex-col items-center gap-2">
          <div className="flex justify-center space-x-6 text-sm text-gray-500">
            <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 transition-colors">Terms</a>
            <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 transition-colors">Privacy</a>
            <a href="/cookies.html" target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 transition-colors">Cookies</a>
          </div>
          <p className="text-xs text-gray-400">
            &copy; 2026 Rukmer Inc. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}