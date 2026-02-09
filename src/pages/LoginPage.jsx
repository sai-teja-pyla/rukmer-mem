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
      navigate('/dashboard'); 
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
      navigate('/dashboard'); 
    } catch (err) {
      setError("Google sign-in failed.");
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!email) {
      setError("Please enter your email address first.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      alert("Password reset link sent! Check your inbox.");
    } catch (error) {
      setError("Reset Error: " + error.message);
    }
  };

  return (
    /* STRETCH THE VIEWPORT: Using flex-col and min-h-screen ensures the page grows with content */
    <div className="min-h-screen w-full bg-gray-50 flex flex-col items-center justify-start py-20 px-4 overflow-y-auto">
      
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-gray-100 flex flex-col">
        
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
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#7c3aed] focus:border-[#7c3aed] outline-none"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-bold text-gray-900">Password</label>
                {/* FORGOT PASSWORD: Moved here for maximum visibility */}
                <button 
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs text-[#7c3aed] font-semibold hover:underline"
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
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#7c3aed] focus:border-[#7c3aed] outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#7c3aed] hover:bg-[#6d28d9] text-white font-bold py-3.5 rounded-lg shadow-sm disabled:opacity-50"
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

          {/* LEGAL SECTION: Added padding-top and border to separate from form */}
          <div className="mt-10 pt-6 border-t border-gray-100 text-center">
            <p className="text-[10px] text-gray-400 italic mb-4">
              AI-generated insights are for guidance only. Always verify critical safety data with a professional.
            </p>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              By signing in, you agree to our{' '}
              <a href="/privacy.html" target="_blank" className="underline font-bold text-gray-800">Privacy Policy</a>
              {' '}and{' '}
              <a href="/cookies.html" target="_blank" className="underline font-bold text-gray-800">Cookie Policy</a>.
            </p>
          </div>
        </form>
      </div>
      
      {/* Visual spacer for mobile scrolling */}
      <div className="h-20 w-full"></div>
    </div>
  );
}