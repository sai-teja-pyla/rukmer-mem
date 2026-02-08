import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase'; // Ensure this path is correct!
import { 
  signInWithEmailAndPassword, 
  GoogleAuthProvider, 
  signInWithPopup 
} from 'firebase/auth';
import { Link } from 'react-router-dom';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 1. Handle Email/Password Login
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/dashboard'); // Success! Go to dashboard
    } catch (err) {
      setError("Failed to sign in. Check your email/password.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // 2. Handle Google Login
  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      navigate('/dashboard'); // Success!
    } catch (err) {
      setError("Google sign-in failed.");
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        
        {/* Header */}
        <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Sign In</h2>
            <p className="text-sm text-gray-500 mt-1">Welcome back to Rukmer AI</p>
        </div>

        {/* Error Message */}
        {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                {error}
            </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          
          {/* Email Field */}
          <div>
            <label className="block text-sm font-bold text-gray-900 mb-2">
              Email address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#5b67e8] focus:border-[#5b67e8] outline-none transition-all placeholder-gray-400"
            />
          </div>

          {/* Password Field */}
          <div>
            <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-bold text-gray-900">
                Password
                </label>
                <a href="#" className="text-xs text-[#5b67e8] font-semibold hover:underline">Forgot?</a>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#5b67e8] focus:border-[#5b67e8] outline-none transition-all placeholder-gray-400"
            />
          </div>

          {/* Sign In Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#5b67e8] hover:bg-[#4a56d6] text-white font-bold py-3.5 rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </button>

          {/* Divider */}
          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-gray-200"></div>
            <span className="flex-shrink-0 mx-4 text-gray-400 text-xs">OR</span>
            <div className="flex-grow border-t border-gray-200"></div>
          </div>

          {/* Google Button */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full bg-white hover:bg-gray-50 text-gray-900 font-medium py-3.5 rounded-lg border border-gray-300 transition-colors flex items-center justify-center gap-2"
          >
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5" />
            Continue with Google
          </button>

          {/* Footer Links */}
          <Link to="/signup" className="text-[#5b67e8] hover:underline font-bold">
          Create account
          </Link>

        </form>

        {/* Terms Disclaimer */}
        <p className="text-xs text-gray-500 text-center mt-8 leading-relaxed">
          By signing up, you agree to our{' '}
          <a href="#" className="underline hover:text-gray-800">Terms of Service</a>
          {' '}and{' '}
          <a href="#" className="underline hover:text-gray-800">Privacy Policy</a>.
        </p>

      </div>
    </div>
  );
}