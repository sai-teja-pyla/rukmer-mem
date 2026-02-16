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

      // B. Update Display Name (so it shows in your menu)
      await updateProfile(user, { displayName: formData.name });

      // C. Create User Document in Firestore (For your settings page)
      await setDoc(doc(db, "users", user.uid), {
        displayName: formData.name,
        email: formData.email,
        theme: "light",
        createdAt: new Date(),
        plan: "free"
      });

      navigate('/dashboard'); // Success!
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
      // Note: We don't strictly need to create the Firestore doc here 
      // because your useUserSettings hook handles "New User" detection automatically!
      navigate('/dashboard');
    } catch (err) {
      setError("Google sign-in failed.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        
        {/* --- Terms & Privacy Text --- */}
        <div className="mt-6 text-center border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-500">
            By signing up, you agree to our{' '}
            <a 
              href="/privacy.html" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-[#5b67e8] hover:underline font-semibold transition-colors"
            >
              Terms of Service
            </a>
            {' '}and{' '}
            <a 
              href="/privacy.html" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-[#5b67e8] hover:underline font-semibold transition-colors"
          >
            Privacy Policy
          </a>.
        </p>
      </div>

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
              placeholder="John Doe"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#5b67e8] focus:border-[#5b67e8] outline-none transition-all placeholder-gray-400"
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
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#5b67e8] focus:border-[#5b67e8] outline-none transition-all placeholder-gray-400"
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
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#5b67e8] focus:border-[#5b67e8] outline-none transition-all placeholder-gray-400"
            />
          </div>

          {/* Sign Up Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#5b67e8] hover:bg-[#4a55d9] text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* Footer Links */}
          <div className="text-center mt-6">
            <p className="text-sm font-medium text-gray-900">
              Already have an account?{' '}
              <Link to="/login" className="text-[#5b67e8] hover:underline font-bold">
                Sign In
              </Link>
            </p>
          </div>
        </form>

      </div>
    </div>
  );
}