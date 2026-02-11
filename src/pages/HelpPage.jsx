import React, { useState } from 'react';
import { useUserSettings } from '../hooks/useUserSettings';
import { useNavigate } from 'react-router-dom'; 
import { auth } from '../firebase';
import { ArrowLeft, Search, ChevronDown, ChevronUp, Mail, MessageCircle, FileText } from 'lucide-react'; 
import FeedbackModal from '../components/FeedbackModal';

export default function HelpPage() {
  const { settings } = useUserSettings();
  const navigate = useNavigate();
  
  // State for FAQ accordion
  const [openFaq, setOpenFaq] = useState(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

  // Theme Logic
  const isDark = settings?.theme === 'dark';
  const theme = {
    bg: isDark ? 'bg-[#0f0f0f]' : 'bg-slate-50',
    text: isDark ? 'text-gray-200' : 'text-gray-800',
    card: isDark ? 'bg-[#1a1a1a] border-gray-800' : 'bg-white border-gray-200',
    header: isDark ? 'text-white' : 'text-gray-900',
    subtext: isDark ? 'text-gray-400' : 'text-gray-500',
    input: isDark ? 'bg-[#252525] border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
  };

  // FAQ Data
  const faqs = [
    {
      question: "How do I upload a new project?",
      answer: "Navigate to the Dashboard and click the 'New Chat' button. You can then drag and drop images, videos, or PDFs into the upload area."
    },
    {
      question: "Can I export my reports to PDF?",
      answer: "Yes! Once an analysis is complete, click the 'Export PDF' icon in the top right corner of the report card."
    },
    {
      question: "How do I change my display name?",
      answer: "Go to the User Menu (top right avatar) > Settings. You can update your Display Name and it will save automatically."
    },
    {
      question: "Is my data secure?",
      answer: "Absolutely. We use enterprise-grade security. Your data is stored in encrypted cloud storage and only accessible by you."
    }
  ];

  const toggleFaq = (index) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className={`min-h-screen ${theme.bg} ${theme.text} p-8 transition-colors duration-300`}>
      <div className="max-w-3xl mx-auto">
        
        {/* Back Button */}
        <button 
          onClick={() => navigate('/dashboard')} 
          className={`flex items-center gap-2 mb-8 transition-colors group ${theme.subtext} hover:text-blue-500`}
        >
          <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform"/>
          Back to Dashboard
        </button>

        {/* Header Section */}
        <div className="text-center mb-12">
          <h1 className={`text-4xl font-bold mb-4 ${theme.header}`}>How can we help?</h1>
          <div className="relative max-w-lg mx-auto">
            <Search className={`absolute left-4 top-3.5 ${theme.subtext}`} size={20} />
            <input 
              type="text" 
              placeholder="Search for answers..." 
              className={`w-full pl-12 pr-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition shadow-sm ${theme.input}`}
            />
          </div>
        </div>

        {/* Quick Links Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          <div 
            onClick={() => navigate('/docs')}
            className={`p-6 rounded-xl border text-center hover:scale-105 transition cursor-pointer ${theme.card}`}
          >
            <FileText size={32} className="mx-auto mb-3 text-blue-500" />
            <h3 className="font-bold mb-1">Documentation</h3>
            <p className={`text-sm ${theme.subtext}`}>Read the guides</p>
          </div>

          <div className={`p-6 rounded-xl border text-center hover:scale-105 transition cursor-pointer ${theme.card}`}>
            <Mail size={32} className="mx-auto mb-3 text-purple-500" />
            <h3 className="font-bold mb-1">Email Us</h3>
            <h4 className="font-bold mb-1">tech@rukmer.com</h4>
            <p className={`text-sm ${theme.subtext}`}>Get a response in 24h</p>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="mb-12">
          <h2 className={`text-2xl font-bold mb-6 ${theme.header}`}>Frequently Asked Questions</h2>
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div 
                key={index} 
                className={`border rounded-xl overflow-hidden transition-all ${theme.card}`}
              >
                <button 
                  onClick={() => toggleFaq(index)}
                  className="w-full flex justify-between items-center p-5 text-left font-medium hover:opacity-80"
                >
                  {faq.question}
                  {openFaq === index ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>
                
                {/* Accordion Content */}
                {openFaq === index && (
                  <div className={`px-5 pb-5 ${theme.subtext} leading-relaxed`}>
                    {faq.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Contact Footer */}
        <div className={`text-center p-8 rounded-2xl border border-dashed ${isDark ? 'border-gray-800' : 'border-gray-300'}`}>
            <h3 className="text-xl font-bold mb-2">Still need help?</h3>
            <p className={`mb-4 ${theme.subtext}`}>Our support team is just a click away.</p>
            <button onClick={() => setIsFeedbackOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition">
                Contact Support
            </button>
        </div>

        <FeedbackModal
          user={auth.currentUser}
          darkMode={isDark}
          isOpen={isFeedbackOpen}
          onClose={() => setIsFeedbackOpen(false)}
        />
      </div>
    </div>
  );
}