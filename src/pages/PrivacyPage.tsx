import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function PrivacyPage() {
  const navigate = useNavigate();

  // Scroll to top when page opens
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // 🔴 PASTE YOUR TERMLY HTML CODE BELOW BETWEEN THE BACKTICKS (``)
  // delete the text "PASTE_HERE" and paste your code.
  const termlyHTML = ``
  

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto bg-white p-8 md:p-12 rounded-2xl shadow-sm border border-gray-200">
        
        {/* Navigation Header */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-100">
          <button 
            onClick={() => navigate(-1)} 
            className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-blue-600 transition-colors"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <span className="text-xs text-gray-400 uppercase tracking-wider">Legal Document</span>
        </div>

        {/* This displays your Termly Code exactly as provided */}
        <div 
          dangerouslySetInnerHTML={{ __html: termlyHTML }} 
          className="termly-content"
        />

      </div>
    </div>
  );
}