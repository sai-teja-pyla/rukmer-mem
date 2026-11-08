import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth } from '../firebase';
import { safeNext } from '../services/safeNext';
import TerminalAuth, { signInLines } from '../components/TerminalAuth'; 
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
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate(safeNext(new URLSearchParams(window.location.search).get('next'))); 
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
      navigate(safeNext(new URLSearchParams(window.location.search).get('next'))); 
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
      setNotice('Reset link sent. Check your inbox.');
      setError('');
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
    <TerminalAuth title="SIGN IN" lines={signInLines}>
      <form onSubmit={handleLogin} className="space-y-4">
        {error && <p>&gt; {error}</p>}
        {notice && <p>&gt; {notice}</p>}

        <label className="block">
          <span className="block mb-1">&gt; email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="term-input w-full bg-transparent border-0 border-b border-black/15 focus:border-black outline-none py-2 text-black placeholder:text-black/30"
          />
        </label>

        <label className="block">
          <span className="flex items-center justify-between mb-1">
            <span>&gt; password</span>
            <button type="button" onClick={handleForgotPassword} className="text-black/60 hover:text-black">
              forgot?
            </button>
          </span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="********"
            className="term-input w-full bg-transparent border-0 border-b border-black/15 focus:border-black outline-none py-2 text-black placeholder:text-black/30"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-black text-white py-3 tracking-[0.18em] hover:bg-neutral-800 disabled:opacity-60"
        >
          {loading ? 'AUTHENTICATING...' : 'SIGN IN'}
        </button>
        {loading && (
          <div className="h-2.5 bg-black origin-left" style={{ width: '40%', animation: 'term-in 0.6s ease' }} />
        )}

        <button
          type="button"
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-2 border border-black/15 py-3 hover:border-black"
        >
          <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="" className="w-4 h-4" />
          CONTINUE WITH GOOGLE
        </button>

        <p>
          &gt; new here?{' '}
          <Link to="/signup" className="underline underline-offset-4">create account</Link>
        </p>
      </form>
    </TerminalAuth>
  );
}