import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import LoiDocument from '../components/LoiDocument';

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

        <p className="text-gray-600 mb-8">By creating an account you agree to the letter below, these terms, and the privacy policy, on behalf of yourself and your organization. The same letter is at <a className="underline" href="/loi">/loi</a> and on <a className="underline" href="/terms.html">the terms page</a>.</p>
        <LoiDocument />

      </div>
    </div>
  );
}