import React, { useState } from 'react';
import { db } from '../firebase';
import { collection, addDoc, onSnapshot } from 'firebase/firestore';
import { Zap, CreditCard, ArrowLeft, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useUserSettings } from '../hooks/useUserSettings';

export default function SubscriptionPage({ user, isPro }) {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  
  // THEME SYNC: Get settings to determine if dark mode is active
  const { settings } = useUserSettings();
  const isDark = settings?.theme === 'dark';

  // This opens the Stripe Customer Portal
  const handleManageBilling = async () => {
    setLoading(true);
    try {
      const functions = getFunctions();
      const createPortalLink = httpsCallable(
        functions, 
        'ext-firestore-stripe-payments-createPortalLink'
      );
      
      const { data } = await createPortalLink({
        returnUrl: window.location.origin + '/subscription',
      });
      
      if (data.url) {
        window.location.assign(data.url); // Redirect to Stripe Portal
      }
    } catch (err) {
      console.error("Portal Error:", err);
      alert("Stripe Portal error. Check if it is enabled in your Stripe Dashboard.");
    } finally {
      setLoading(false);
    }
  };

  return (
    // FIX: Dynamically toggle bg and text colors based on isDark state
    <div className={`min-h-screen p-8 transition-colors duration-300 ${
      isDark ? 'bg-black text-white' : 'bg-[#f8fafc] text-slate-900'
    }`}>
      <button 
        onClick={() => navigate('/dashboard')} 
        className={`flex items-center gap-2 mb-8 transition-colors ${
          isDark ? 'text-gray-400 hover:text-white' : 'text-slate-500 hover:text-[#7c3aed]'
        }`}
      >
        <ArrowLeft size={18} /> Back to Dashboard
      </button>

      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Subscription & Billing</h1>
        <p className={`${isDark ? 'text-gray-400' : 'text-slate-500'} mb-8`}>
          Manage your Rukmer AI plan and invoices.
        </p>

        {/* FIX: Ensure card background and border respect the theme */}
        <div className={`border rounded-2xl p-6 shadow-sm ${
          isDark ? 'bg-[#111] border-[#333]' : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${
                isPro ? 'bg-purple-100 dark:bg-purple-900/30 text-[#7c3aed]' : 
                isDark ? 'bg-[#222] text-gray-500' : 'bg-slate-100 text-slate-500'
              }`}>
                <Zap size={24} fill={isPro ? "currentColor" : "none"} />
              </div>
              <div>
                <p className={`text-sm font-medium ${isDark ? 'text-gray-500' : 'text-slate-500'}`}>
                  Current Plan
                </p>
                <h3 className="text-xl font-bold">{isPro ? 'Pro Plan' : 'Free Plan'}</h3>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
              isPro ? 'bg-green-100 text-green-700' : 
              isDark ? 'bg-[#222] text-gray-400' : 'bg-slate-100 text-slate-600'
            }`}>
              {isPro ? 'ACTIVE' : 'DEFAULT'}
            </span>
          </div>

          <div className={`space-y-4 border-t pt-6 ${
            isDark ? 'border-[#222]' : 'border-slate-100'
          }`}>
            <button 
              // REDIRECT: Logic to send upgrade signal to dashboard
              onClick={isPro ? handleManageBilling : () => navigate('/dashboard?upgrade=true')}
              disabled={loading}
              className="w-full bg-[#7c3aed] text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#6d28d9] transition-all shadow-lg shadow-purple-500/10"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : (
                <>{isPro ? <CreditCard size={18}/> : <Zap size={18}/>} 
                {isPro ? 'Manage Billing & Cancel' : 'Upgrade to Pro'}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}