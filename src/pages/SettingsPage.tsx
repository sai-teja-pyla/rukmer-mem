import React, { useState } from 'react';
import { useUserSettings } from '../hooks/useUserSettings';
import { useNavigate } from 'react-router-dom'; 
import { 
  User, Zap, Moon, Sun, Mail, Save, ArrowLeft, 
  Trash2, Loader2, Lock, ShieldCheck 
} from 'lucide-react';
import { auth } from "../firebase";
import { 
  deleteUser, 
  EmailAuthProvider, 
  reauthenticateWithCredential, 
  updatePassword 
} from "firebase/auth";


const API_BASE_URL = ((import.meta as any).env as any).VITE_GEMINI_API_KEY || 'http://localhost:5001/api';
//const API_BASE_URL = "https://rukmer-saas-service-361739908342.us-central1.run.app";

export default function SettingsPage() {
  const { settings, updateSettings, loading } = useUserSettings();
  const navigate = useNavigate();

  // State for Password Form
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [passLoading, setPassLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!settings) return <div className="min-h-screen flex items-center justify-center">Please log in.</div>;

  const isDark = settings.theme === 'dark';

  // --- PASSWORD UPDATE LOGIC ---
  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user || !user.email) return alert("You must be logged in.");
    
    if (passwords.new !== passwords.confirm) {
      return alert("New passwords do not match.");
    }
    if (passwords.new.length < 6) {
      return alert("New password must be at least 6 characters.");
    }

    try {
      setPassLoading(true);
      
      // 1. Re-authenticate (Required for sensitive Auth changes)
      const credential = EmailAuthProvider.credential(user.email, passwords.current);
      await reauthenticateWithCredential(user, credential);
      
      // 2. Update the password in Firebase Auth
      await updatePassword(user, passwords.new);
      
      alert("✅ Password updated successfully!");
      setPasswords({ current: '', new: '', confirm: '' }); // Reset form
    } catch (error: any) {
      console.error("Password update error:", error);
      if (error.code === 'auth/wrong-password') {
        alert("❌ Current password is incorrect.");
      } else {
        alert(`❌ Error: ${error.message}`);
      }
    } finally {
      setPassLoading(false);
    }
  };

  // --- DELETE ACCOUNT LOGIC ---
  const handleDeleteAccount = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const confirmFirst = window.confirm("⚠️ WARNING: This will permanently delete your account and all data. Proceed?");

    if (confirmFirst) {
      const feedback = window.prompt("We're sorry to see you go! Why are you leaving? (optional):");
      const confirmSecond = window.prompt("To confirm, please type 'DELETE' below:");
      
      if (confirmSecond === "DELETE") {
        try {
          setIsDeleting(true);
          const user = auth.currentUser;
          if (!user) return;
          const token = await user.getIdToken();

          if (feedback) {
            await fetch(`${API_BASE_URL}/api/user/exit-feedback`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: feedback, email: user.email })
            });
          }

          const response = await fetch(`${API_BASE_URL}/api/user/delete-complete`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (!response.ok) throw new Error("Backend cleanup failed.");

          await deleteUser(user);
          alert("Account successfully deleted.");
          window.location.href = "/";
          navigate('/'); 
        } catch (error: any) {
          console.error("Delete Error:", error);
          alert(error.code === 'auth/requires-recent-login' ? "Security: Please re-log to delete account." : error.message);
        } finally {
          setIsDeleting(false);
        }
      }
    }
  };

  const theme = {
    bg: isDark ? 'bg-[#0f0f0f]' : 'bg-slate-50',
    text: isDark ? 'text-gray-200' : 'text-gray-800',
    card: isDark ? 'bg-[#1a1a1a] border-gray-800' : 'bg-white border-gray-200',
    header: isDark ? 'text-white' : 'text-gray-900',
    subtext: isDark ? 'text-gray-400' : 'text-gray-500',
    input: isDark ? 'bg-[#0f0f0f] border-gray-700 text-white shadow-inner' : 'bg-white border-gray-300 text-gray-900 shadow-sm'
  };

  return (
    <div className={`min-h-screen ${theme.bg} ${theme.text} p-8 transition-colors duration-300`}>
      <div className="max-w-3xl mx-auto">
        
        <button onClick={() => navigate('/dashboard')} className={`flex items-center gap-2 mb-8 transition-colors group ${theme.subtext} hover:text-blue-500`}>
          <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform"/>
          Back to Dashboard
        </button>

        <div className={`mb-8 border-b pb-4 ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
          <h1 className={`text-3xl font-bold mb-2 ${theme.header}`}>Account Settings</h1>
          <p className={theme.subtext}>Manage your Rukmer AI profile and security.</p>
        </div>

        {/* Section 1: Profile Info */}
        <div className={`rounded-xl p-6 mb-6 border shadow-lg ${theme.card}`}>
          <h2 className={`text-xl font-semibold mb-6 flex items-center gap-2 ${theme.header}`}>
            <User size={20} className="text-blue-500"/> Profile Information
          </h2>
          <div className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-1 ${theme.subtext}`}>Display Name</label>
              <input
                type="text"
                value={settings.displayName || ''}
                onChange={(e) => updateSettings({ displayName: e.target.value })}
                className={`w-full rounded-lg p-3 outline-none transition ${theme.input} focus:ring-2 focus:ring-blue-500`}
                placeholder="Enter your name"
              />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1 ${theme.subtext}`}>Email Address</label>
              <div className={`flex items-center gap-3 border rounded-lg p-3 cursor-not-allowed ${isDark ? 'bg-[#252525] border-gray-800 text-gray-400' : 'bg-gray-100 border-gray-200 text-gray-500'}`}>
                <Mail size={16} /> <span>{settings.email}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Security & Password */}
        <div className={`rounded-xl p-6 mb-6 border shadow-lg ${theme.card}`}>
          <h2 className={`text-xl font-semibold mb-6 flex items-center gap-2 ${theme.header}`}>
            <ShieldCheck size={20} className="text-green-500"/> Security
          </h2>
          <form onSubmit={handlePasswordUpdate} className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-1 ${theme.subtext}`}>Current Password</label>
              <input
                type="password"
                required
                value={passwords.current}
                onChange={(e) => setPasswords({...passwords, current: e.target.value})}
                className={`w-full rounded-lg p-3 outline-none transition ${theme.input} focus:ring-2 focus:ring-blue-500`}
                placeholder="••••••••"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={`block text-sm font-medium mb-1 ${theme.subtext}`}>New Password</label>
                <input
                  type="password"
                  required
                  value={passwords.new}
                  onChange={(e) => setPasswords({...passwords, new: e.target.value})}
                  className={`w-full rounded-lg p-3 outline-none transition ${theme.input} focus:ring-2 focus:ring-blue-500`}
                  placeholder="Min 6 characters"
                />
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${theme.subtext}`}>Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={passwords.confirm}
                  onChange={(e) => setPasswords({...passwords, confirm: e.target.value})}
                  className={`w-full rounded-lg p-3 outline-none transition ${theme.input} focus:ring-2 focus:ring-blue-500`}
                  placeholder="Repeat new password"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={passLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-6 rounded-lg transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {passLoading ? <Loader2 className="animate-spin" size={18} /> : "Update Password"}
            </button>
          </form>
        </div>

        {/* Section 3: AI Personalization */}
        <div className={`rounded-xl p-6 mb-6 border shadow-lg ${theme.card}`}>
          <h2 className={`text-xl font-semibold mb-6 flex items-center gap-2 ${theme.header}`}>
            <Zap size={20} className="text-yellow-500"/> AI Personalization
          </h2>
          <div className="mb-2 text-sm font-medium">Creativity Level: <span className="text-yellow-500">{Math.round((settings.aiCreativity || 0.7) * 100)}%</span></div>
          <input
            type="range" min="0" max="1" step="0.1"
            value={settings.aiCreativity || 0.7}
            onChange={(e) => updateSettings({ aiCreativity: parseFloat(e.target.value) })}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
          />
        </div>

        {/* Section 4: Appearance */}
        <div className={`rounded-xl p-6 mb-6 border shadow-lg flex items-center justify-between ${theme.card}`}>
          <div>
            <h2 className={`text-xl font-semibold mb-1 flex items-center gap-2 ${theme.header}`}>
               {isDark ? <Moon size={20} className="text-purple-500"/> : <Sun size={20} className="text-orange-500"/>} Appearance
            </h2>
            <p className={`text-sm ${theme.subtext}`}>Switch between light and dark modes.</p>
          </div>
          <button
            onClick={() => updateSettings({ theme: isDark ? 'light' : 'dark' })}
            style={{ backgroundColor: isDark ? '#9333ea' : '#9ca3af' }}
            className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors"
          >
            <span style={{ transform: isDark ? 'translateX(26px)' : 'translateX(4px)' }} className="inline-block h-5 w-5 rounded-full bg-white transition-transform" />
          </button>
        </div>

        {/* Section 5: Danger Zone */}
        <div className={`rounded-xl p-6 mb-6 border shadow-lg flex flex-col md:flex-row items-center justify-between ${isDark ? 'bg-red-950/10 border-red-900/20' : 'bg-red-50 border-red-200'}`}>
          <div className="mb-4 md:mb-0 text-center md:text-left">
            <h2 className={`text-xl font-semibold mb-1 flex items-center justify-center md:justify-start gap-2 ${isDark ? 'text-red-400' : 'text-red-700'}`}>
               <Trash2 size={20} /> Danger Zone
            </h2>
            <p className={`text-sm ${isDark ? 'text-red-400/60' : 'text-red-600/70'}`}>Permanently delete your Rukmer AI account and site data.</p>
          </div>
          <button
            onClick={handleDeleteAccount}
            disabled={isDeleting}
            className="w-full md:w-auto bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-6 rounded-lg transition-all disabled:opacity-50"
          >
            {isDeleting ? <Loader2 className="animate-spin mx-auto" size={18} /> : "Delete Account"}
          </button>
        </div>

        <div className="flex justify-end text-sm text-green-500 items-center gap-2 opacity-70">
           <Save size={14} /> Changes save automatically
        </div>
      </div>
    </div>
  );
}