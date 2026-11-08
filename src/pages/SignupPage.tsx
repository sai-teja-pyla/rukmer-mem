import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth, db } from '../firebase'; 
import { 
  createUserWithEmailAndPassword, 
  updateProfile, 
  GoogleAuthProvider, 
  sendEmailVerification, 
  signInWithPopup 
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import TerminalAuth, { signUpLines } from '../components/TerminalAuth';

export default function SignupPage() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 1. Handle Email/Password Sign Up
  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // A. Create Auth User
      const userCredential = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
      const user = userCredential.user;

      // B. Update Profile & Sync Local State
      await updateProfile(user, { displayName: formData.name });
      await user.reload();

      // C. Send Branded Verification Email
      await sendEmailVerification(user);

      // D. Create User Document in Firestore
      await setDoc(doc(db, "users", user.uid), {
        displayName: formData.name,
        email: formData.email,
        theme: "light",
        createdAt: serverTimestamp(), // Use serverTimestamp for better data consistency
        plan: "free"
      });

      navigate('/dashboard'); 
    } catch (err) {
      console.error("Signup Error:", err);
      if (err.code === 'auth/email-already-in-use') {
        setError("This email is already registered.");
      } else if (err.code === 'auth/weak-password') {
        setError("Password should be at least 6 characters.");
      } else {
        setError("Account creation failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // 2. Handle Google Sign Up
  const handleGoogleSignup = async () => {
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Sync Firestore: Ensure doc exists without overwriting specific fields
      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        await setDoc(userDocRef, {
          displayName: user.displayName,
          email: user.email,
          theme: "light",
          createdAt: serverTimestamp(),
          plan: "free"
        });
      }

      navigate('/dashboard');
    } catch (err) {
      console.error("Google Error:", err);
      setError("Google sign-in failed.");
    }
  };

  return (
    <TerminalAuth title="SIGN UP" lines={signUpLines}>
      <form onSubmit={handleSignup} className="space-y-4">
        {error && <p>&gt; {error}</p>}
        <label className="block">
          <span className="block mb-1">&gt; name</span>
          <input
            type="text"
            required
            autoComplete="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Your name"
            className="term-input w-full bg-transparent border-0 border-b border-black/15 focus:border-black outline-none py-2 text-black placeholder:text-black/30"
          />
        </label>
        <label className="block">
          <span className="block mb-1">&gt; email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="you@example.com"
            className="term-input w-full bg-transparent border-0 border-b border-black/15 focus:border-black outline-none py-2 text-black placeholder:text-black/30"
          />
        </label>
        <label className="block">
          <span className="block mb-1">&gt; password</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder="at least 6 characters"
            className="term-input w-full bg-transparent border-0 border-b border-black/15 focus:border-black outline-none py-2 text-black placeholder:text-black/30"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-black text-white py-3 tracking-[0.18em] hover:bg-neutral-800 disabled:opacity-60"
        >
          {loading ? 'CREATING ACCOUNT...' : 'CREATE ACCOUNT'}
        </button>
        <button
          type="button"
          onClick={handleGoogleSignup}
          className="w-full flex items-center justify-center gap-2 border border-black/15 py-3 hover:border-black"
        >
          <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="" className="w-4 h-4" />
          CONTINUE WITH GOOGLE
        </button>
        <p>
          &gt; already have an account?{' '}
          <Link to="/login" className="underline underline-offset-4">sign in</Link>
        </p>
        <p className="text-black/60">
          &gt; by creating an account you agree to the{' '}
          <a href="/terms.html" target="_blank" className="text-black underline underline-offset-4">terms</a>
          {' '}and{' '}
          <a href="/privacy.html" target="_blank" className="text-black underline underline-offset-4">privacy policy</a>
        </p>
      </form>
    </TerminalAuth>
  );
}
