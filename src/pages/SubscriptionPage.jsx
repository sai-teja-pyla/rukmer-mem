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
  
  const { settings } = useUserSettings();
  // STABILITY FIX: Default to false if settings are loading to prevent white flash
  const isDark = settings?.theme === 'dark';

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
      
      if (data?.url) {
        window.location.href = data.url; // Use href for better cross-browser compatibility
      }
    } catch (err) {
      console.error("Portal Error:", err);
      alert("Stripe Portal error. Ensure it is enabled in Stripe Dashboard.");
    } finally {
      setLoading(false);
    }
  };

  return (
    /* STABILITY FIX: Added 'w-full' and used a standard hex fallback for older engines */
    <div 
      style={{ backgroundColor: isDark ? '#000000' : '#f8fafc' }}
      className={`min-h-screen w-full p-8 transition-colors duration-300 ${
        isDark ? 'text-white' : 'text-slate-900'
      }`}
    >
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

        <div className={`border rounded-2xl p-6 shadow-sm ${
          isDark ? 'bg-[#111111] border-[#333333]' : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${
                isPro ? 'bg-purple-100 text-[#7c3aed]' : 
                isDark ? 'bg-[#222222] text-gray-500' : 'bg-slate-100 text-slate-500'
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
              isDark ? 'bg-[#222222] text-gray-400' : 'bg-slate-100 text-slate-600'
            }`}>
              {isPro ? 'ACTIVE' : 'DEFAULT'}
            </span>
          </div>

          <div className={`space-y-4 border-t pt-6 ${
            isDark ? 'border-[#222222]' : 'border-slate-100'
          }`}>
            <button 
              onClick={isPro ? handleManageBilling : () => navigate('/dashboard?upgrade=true')}
              disabled={loading}
              className="w-full bg-[#7c3aed] text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#6d28d9] transition-all shadow-lg"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : (
                <React.Fragment>
                  {isPro ? <CreditCard size={18}/> : <Zap size={18}/>} 
                  {isPro ? 'Manage Billing & Cancel' : 'Upgrade to Pro'}
                </React.Fragment>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}