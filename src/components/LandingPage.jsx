import React, { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { Eye, ArrowRight, User, Loader2 } from 'lucide-react';
// IMPORT FIREBASE FUNCTIONS
import { auth, googleProvider } from '../firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, updateProfile } from "firebase/auth";

export default function LandingPage({ onLoginSuccess }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 1. Handle Email/Password Login & Signup
  const handleAuth = async () => {
    setError('');
    setLoading(true);
    try {
      if (isSignUp) {
        // --- CREATE ACCOUNT ---
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        // Add Name to Profile
        await updateProfile(userCredential.user, { displayName: fullName });
        // Send user data back to App.jsx
        onLoginSuccess(userCredential.user);
      } else {
        // --- SIGN IN ---
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        onLoginSuccess(userCredential.user);
      }
    } catch (err) {
      setError(err.message.replace('Firebase: ', ''));
    } finally {
      setLoading(false);
    }
  };

  // 2. Handle Google Login (via Firebase Popup is easier than the custom hook for backend)
  const handleGoogleSignIn = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        onLoginSuccess(result.user);
    } catch (error) {
        console.error(error);
        setError("Google Sign-In Failed");
    }
  };

  return (
    <div className="min-h-screen flex w-full">
      {/* LEFT SIDE (Same as before) */}
      <div className="hidden lg:flex w-1/2 bg-[#0f172a] p-12 flex-col justify-center relative overflow-hidden">
        {/* ... (Keep your existing background code) ... */}
        <div className="relative z-10 max-w-lg">
          <h1 className="text-6xl font-bold text-white leading-tight mb-6">
            Your <br /> Dark Data <br /> is Costing You Decisions
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed">
            Turn your images, videos and documents into actionable insights.
          </p>
        </div>
      </div>

      {/* RIGHT SIDE */}
      <div className="w-full lg:w-1/2 bg-white flex flex-col justify-center items-center p-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-slate-900">
              {isSignUp ? "Get started" : "Welcome back"}
            </h2>
            <p className="mt-2 text-slate-500">
              {isSignUp ? "Create your free account" : "Continue your journey"}
            </p>
          </div>

          <div className="space-y-6 mt-8">
            
            {/* Show Error Message */}
            {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded border border-red-200">{error}</div>}

            {isSignUp && (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-900">Full Name</label>
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="John Doe"
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 outline-none"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                  <User className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-900">Email address</label>
              <input 
                type="email" 
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-lg border border-slate-200 outline-none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-900">Password</label>
              <div className="relative">
                <input 
                  type="password" 
                  placeholder="********"
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 outline-none"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <button 
                onClick={handleAuth}
                disabled={loading}
                className="w-full bg-[#6366f1] hover:bg-[#4f46e5] text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" /> : (isSignUp ? "Create Account" : "Sign In")}
            </button>

            {/* Google Button (Using Firebase now) */}
            <div style={{ colorScheme: "dark" }}>
            <button 
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 py-3 border border-slate-700 rounded-lg hover:bg-slate-800 bg-slate-900 text-white"
            >
               {/* ... (Keep your Google Icon SVG) ... */}
               <span>Continue with Google</span>
            </button>
            </div>

            <div className="text-center mt-6">
               <button onClick={() => setIsSignUp(!isSignUp)} className="text-blue-600 font-semibold hover:underline">
                 {isSignUp ? "Already have an account? Sign in" : "New here? Create account"}
               </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}