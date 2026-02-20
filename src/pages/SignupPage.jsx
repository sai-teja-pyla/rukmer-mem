import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth, db } from '../firebase'; 
import { createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

export default function SignupPage() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 1. Handle Sign Up
  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // A. Create Auth User
      const userCredential = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
      const user = userCredential.user;

      // B. Update Display Name
      await updateProfile(user, { displayName: formData.name });

      // C. Create User Document in Firestore
      await setDoc(doc(db, "users", user.uid), {
        displayName: formData.name,
        email: formData.email,
        theme: "light",
        createdAt: new Date(),
        plan: "free"
      });

      navigate('/dashboard'); 
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setError("This email is already registered.");
      } else if (err.code === 'auth/weak-password') {
        setError("Password should be at least 6 characters.");
      } else {
        setError("Failed to create account. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // 2. Handle Google Sign Up
  const handleGoogleSignup = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      navigate('/dashboard');
    } catch (err) {
      setError("Google sign-in failed.");
    }
  };

  return (
    /* 1. FLEX-COL + MIN-H-SCREEN ensures the footer pushes to the bottom */
    <div className="min-h-screen flex flex-col bg-gray-50">
      
      {/* 2. FLEX-GROW content area */}
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
          
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">Create your account</h2>

          {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                  {error}
              </div>
          )}

          <form onSubmit={handleSignup} className="space-y-5">
            {/* Name Field */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">Full Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                placeholder="Your Name"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white !text-black text-gray-900 focus:ring-2 focus:ring-[#7c3aed] focus:border-[#7c3aed] outline-none transition-all placeholder:text-gray-400"
                style={{ color: '#000000' }}
              />
            </div>

            {/* Email Field */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">Email address</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white !text-black text-gray-900 focus:ring-2 focus:ring-[#7c3aed] focus:border-[#7c3aed] outline-none transition-all placeholder:text-gray-400"
                style={{ color: '#000000' }}
              />
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">Password</label>
              <input
                type="password"
                required
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                placeholder="Create a password"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white !text-black text-gray-900 focus:ring-2 focus:ring-[#7c3aed] focus:border-[#7c3aed] outline-none transition-all placeholder:text-gray-400"
                style={{ color: '#000000' }}
              />
            </div>

            {/* Sign Up Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#7c3aed] hover:bg-[#6d28d9] text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating Account...' : 'Sign Up'}
            </button>

            {/* Google Button */}
            <button
              type="button"
              onClick={handleGoogleSignup}
              className="w-full bg-white hover:bg-gray-50 text-gray-900 font-medium py-3.5 rounded-lg border border-gray-300 transition-colors flex items-center justify-center gap-2"
            >
              <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5" />
              Sign up with Google
            </button>

            {/* Login Link */}
            <div className="text-center mt-4">
              <p className="text-sm font-medium text-gray-600">
                Already have an account?{' '}
                <Link to="/login" className="text-[#7c3aed] hover:underline font-bold">
                  Sign In
                </Link>
              </p>
            </div>

            {/* --- Terms & Privacy Text --- */}
            <div className="mt-6 text-center border-t border-gray-100 pt-4">
              <p className="text-[11px] text-gray-500 leading-relaxed">
                By signing up, you agree to our{" "}
                <a 
                  href="/terms.html" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-[#7c3aed] hover:underline font-medium"
                >
                  Terms of Service
                </a>
                {" "}and{" "}
                <a 
                  href="/privacy.html" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-[#7c3aed] hover:underline font-medium"
                >
                  Privacy Policy
                </a>.
              </p>
            </div>
          </form>
        </div>
      </div>

      {/* 3. GLOBAL FOOTER correctly placed at the bottom */}
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