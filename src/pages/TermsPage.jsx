import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function TermsPage() {
  const navigate = useNavigate();

  // Scroll to top on load
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-8">
      <div className="max-w-4xl mx-auto bg-white p-12 rounded-2xl shadow-sm border border-gray-200">
        
        {/* Back Button */}
        <button 
          onClick={() => navigate(-1)} 
          className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-blue-600 mb-8 transition-colors"
        >
          <ArrowLeft size={16} /> Back
        </button>

        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-gray-500 mb-8">Last updated: February 2026</p>

        {/* Placeholder Content - Replace this with your real Terms if you have them */}
        <div className="space-y-6 text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-black mb-2">1. Acceptance of Terms</h2>
            <p>By accessing and using Rukmer AI, you accept and agree to be bound by the terms and provision of this agreement.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-black mb-2">2. Use of Service</h2>
            <p>You agree to use the service only for lawful purposes. You are prohibited from using the service to upload content that is illegal, harmful, or violates the rights of others.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-black mb-2">3. Intellectual Property</h2>
            <p>You retain all rights to the data and images you upload. We claim no ownership over your intellectual property.</p>
          </section>
        </div>

      </div>
    </div>
  );
}