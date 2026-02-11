import React, { useState } from 'react';
import { X, Check, Zap, Shield, Rocket } from 'lucide-react';

export default function PricingModal({ isOpen, onClose, onCheckout }) {
  const [billingCycle, setBillingCycle] = useState('monthly'); // 'monthly' or 'yearly'

  if (!isOpen) return null;

  // Replace these with your actual IDs from the Stripe Dashboard
  const PRICE_IDS = {
    monthly: 'price_1Sz7s82NaqjgxJZ3lEwj7RkC',
    yearly: 'price_1Sz7s82NaqjgxJZ32GnHY47G'
  };

  const features = [
    "Unlimited AI Asset Reports",
    "Advanced Construction VLM Analysis",
    "Priority Chat Support",
    "500MB+ Large File Uploads",
    "Custom PDF Export Branding"
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white dark:bg-[#111] w-full max-w-lg rounded-3xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-2xl relative">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-[#222] transition-colors text-gray-500"
        >
          <X size={20} />
        </button>

        <div className="p-8 text-center">
          <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-[#7c3aed]/10 mb-4">
            <Rocket className="text-[#7c3aed]" size={32} />
          </div>
          <h2 className="text-3xl font-bold dark:text-white mb-2">Upgrade to Pro</h2>
          <p className="text-gray-500 dark:text-gray-400">Unlock the full power of Rukmer AI.</p>

          {/* Billing Toggle */}
          <div className="mt-8 flex justify-center items-center gap-4">
            <span className={`text-sm font-medium ${billingCycle === 'monthly' ? 'text-[#7c3aed]' : 'text-gray-500'}`}>Monthly</span>
            <button 
              onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'yearly' : 'monthly')}
              className="w-12 h-6 rounded-full bg-gray-200 dark:bg-[#222] relative transition-colors"
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-[#7c3aed] transition-all duration-300 ${billingCycle === 'yearly' ? 'left-7' : 'left-1'}`} />
            </button>
            <span className={`text-sm font-medium ${billingCycle === 'yearly' ? 'text-[#7c3aed]' : 'text-gray-500'}`}>
              Yearly <span className="text-[10px] bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full ml-1 font-bold">SAVE 17%</span>
            </span>
          </div>

          {/* Pricing Display */}
          <div className="mt-8 mb-10">
            <div className="flex justify-center items-baseline gap-1">
              <span className="text-5xl font-extrabold dark:text-white">
                {billingCycle === 'monthly' ? '$30' : '$300'}
              </span>
              <span className="text-gray-500 font-medium">
                {billingCycle === 'monthly' ? '/mo' : '/yr'}
              </span>
            </div>
          </div>

          {/* Features List */}
          <div className="space-y-4 mb-10 text-left max-w-xs mx-auto">
            {features.map((feature, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#7c3aed]/10 flex items-center justify-center">
                  <Check size={12} className="text-[#7c3aed]" strokeWidth={3} />
                </div>
                <span className="text-sm dark:text-gray-300">{feature}</span>
              </div>
            ))}
          </div>

          {/* Checkout Button */}
          <button
            onClick={() => onCheckout(PRICE_IDS[billingCycle])}
            className="w-full bg-[#7c3aed] hover:bg-[#6d28d9] text-white py-4 rounded-2xl font-bold text-lg transition-all shadow-lg shadow-purple-500/25 flex items-center justify-center gap-2 group"
          >
            <Zap size={20} fill="white" className="group-hover:scale-110 transition-transform" />
            Start My Pro Plan
          </button>
          
          <p className="mt-4 text-[10px] text-gray-500 uppercase tracking-widest flex items-center justify-center gap-2">
            <Shield size={12} /> Secure Checkout via Stripe
          </p>
        </div>
      </div>
    </div>
  );
}