import React, { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { Eye, ArrowRight, User, Loader2 } from 'lucide-react';
// IMPORT FIREBASE FUNCTIONS
import { auth, googleProvider } from '../firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signInWithPopup, 
  updateProfile,
  sendPasswordResetEmail // Added this
} from "firebase/auth";

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
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: fullName });
        onLoginSuccess(userCredential.user);
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        onLoginSuccess(userCredential.user);
      }
    } catch (err) {
      setError(err.message.replace('Firebase: ', ''));
    } finally {
      setLoading(false);
    }
  };

  // 2. Handle Google Login
  const handleGoogleSignIn = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        onLoginSuccess(result.user);
    } catch (error) {
        console.error(error);
        setError("Google Sign-In Failed");
    }
  };

  // --- NEW: PASSWORD RESET LOGIC ---
  const handleForgotPassword = async () => {
    if (!email) {
      setError("Please enter your email address first.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      alert("🚀 Reset link sent! Check your email inbox.");
      setError('');
    } catch (err) {
      setError("Reset Error: " + err.message.replace('Firebase: ', ''));
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex flex-1 w-full">
        
        {/* LEFT SIDE (Dark) */}
        <div className="hidden lg:flex w-1/2 bg-[#0f172a] p-12 flex-col justify-center relative overflow-hidden">
          <div className="relative z-10 max-w-lg">
            <h1 className="text-6xl font-bold text-white leading-tight mb-6">
              Your <br /> Dark Data <br /> is Costing You Decisions
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed">
              Turn your untapped images, videos and documents into actionable insights.
            </p>
          </div>
        </div>

        {/* RIGHT SIDE (Form) */}
        <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-8">
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
              {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded border border-red-200">{error}</div>}

              {isSignUp && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-900">Full Name</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      placeholder="Your Name"
                      className="w-full px-4 py-3 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#6366f1]/20 !text-black"
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
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#6366f1]/20 !text-black"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-900">Password</label>
                <input 
                  type="password" 
                  placeholder="********"
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#6366f1]/20 !text-black"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                
                {/* FORGOT PASSWORD LINK (Only shows on Sign In mode) */}
                {!isSignUp && (
                  <div className="flex justify-end">
                    <button 
                      onClick={handleForgotPassword}
                      className="text-xs text-[#6366f1] font-medium hover:underline transition-all"
                    >
                      Forgot Password?
                    </button>
                  </div>
                )}
              </div>

              <button 
                  onClick={handleAuth}
                  disabled={loading}
                  className="w-full bg-[#6366f1] hover:bg-[#4f46e5] text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                {loading ? <Loader2 className="animate-spin" /> : (isSignUp ? "Create Account" : "Sign In")}
              </button>

              <div style={{ colorScheme: "dark" }}>
                <button 
                  onClick={handleGoogleSignIn}
                  className="w-full flex items-center justify-center gap-3 py-3 border border-slate-700 rounded-lg hover:bg-slate-800 bg-slate-900 text-white transition-all"
                >
                   <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5 h-5" alt="Google" />
                   <span>Continue with Google</span>
                </button>
              </div>

              <div className="text-center mt-6">
                 <button onClick={() => setIsSignUp(!isSignUp)} className="text-blue-600 font-semibold hover:underline">
                   {isSignUp ? "Already have an account? Sign in" : "New here? Create account"}
                 </button>
              </div>

              <div className="mt-6 text-center border-t border-slate-100 pt-6">
                {isSignUp ? (
                  <p className="text-[11px] text-gray-500 leading-relaxed max-w-xs mx-auto">
                    By signing up, you agree to our{" "}
                    <a href="/terms.html" target="_blank" className="text-[#6366f1] hover:underline font-medium">Terms of Service</a>
                    {" "}and{" "}
                    <a href="/privacy.html" target="_blank" className="text-[#6366f1] hover:underline font-medium">Privacy Policy</a>.
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">
                    Welcome back. Please login to your account to continue.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="w-full py-8 border-t border-gray-100 bg-white text-center">
        <div className="flex flex-col items-center gap-2">
          <div className="flex justify-center space-x-6 text-sm text-gray-500">
            <a href="/terms.html" className="hover:text-slate-900 transition-colors">Terms</a>
            <a href="/privacy.html" className="hover:text-slate-900 transition-colors">Privacy</a>
            <a href="/cookies.html" className="hover:text-slate-900 transition-colors">Cookies</a>
          </div>
          <p className="text-xs text-gray-400">
            &copy; 2026 Rukmer Inc. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}