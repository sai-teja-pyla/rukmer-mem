import React, { useState } from 'react';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { MessageSquare, Bug, Lightbulb, X, Send, Loader2, CheckCircle } from 'lucide-react';

export default function FeedbackForm({ user, darkMode, onClose }) {
  const [formData, setFormData] = useState({ type: 'feedback', subject: '', description: '' });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Logic to collect actionable user insights through structured feedback
      await addDoc(collection(db, "feedback"), {
        uid: user?.uid || "anonymous",
        email: user?.email || "no-email",
        ...formData,
        timestamp: serverTimestamp(),
        status: 'new'
      });
      setSubmitted(true);
      // Closing the loop with users builds loyalty
      setTimeout(() => { if (onClose) onClose(); }, 2000);
    } catch (error) {
      console.error("Error submitting feedback:", error);
    } finally {
      setLoading(false);
    }
  };

  const theme = {
    card: darkMode ? 'bg-[#111] border-[#333] text-white' : 'bg-white border-gray-200 text-gray-900',
    input: darkMode ? 'bg-[#1a1a1a] border-[#333] text-white' : 'bg-white border-gray-300',
    typeBtn: darkMode ? 'bg-[#222] border-[#444]' : 'bg-gray-100 border-gray-200'
  };

  if (submitted) {
    return (
      <div className={`${theme.card} p-8 rounded-2xl border text-center shadow-2xl`}>
        <CheckCircle className="mx-auto text-green-500 mb-4" size={48} />
        <h2 className="text-xl font-bold">Thank you!</h2>
        <p className="text-gray-500 mt-2">Your insight helps Rukmer AI grow.</p>
      </div>
    );
  }

  return (
    <div className={`${theme.card} p-6 rounded-2xl border shadow-2xl w-full max-w-md`}>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <MessageSquare size={20} className="text-[#7c3aed]" /> Help us improve
        </h2>
        {onClose && <button onClick={onClose} className="hover:opacity-70"><X size={20}/></button>}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Type Selector handles Feedback, Bugs, and Feature Requests */}
        <div className="grid grid-cols-3 gap-2">
          {['feedback', 'bug', 'feature'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFormData({ ...formData, type: t })}
              className={`p-3 rounded-xl border text-xs font-bold uppercase transition-all flex flex-col items-center gap-2 ${
                formData.type === t ? 'border-[#7c3aed] bg-[#7c3aed]/10 text-[#7c3aed]' : theme.typeBtn
              }`}
            >
              {t === 'bug' ? <Bug size={16}/> : t === 'feature' ? <Lightbulb size={16}/> : <MessageSquare size={16}/>}
              {t === 'feature' ? 'Request' : t}
            </button>
          ))}
        </div>

        <div>
          <label className="text-xs font-bold opacity-50 mb-1 block">Subject</label>
          <input
            required
            className={`w-full p-3 rounded-xl outline-none border transition-all ${theme.input} focus:border-[#7c3aed]`}
            placeholder={formData.type === 'bug' ? "What went wrong?" : "What's on your mind?"}
            value={formData.subject}
            onChange={(e) => setFormData({...formData, subject: e.target.value})}
          />
        </div>

        <div>
          <label className="text-xs font-bold opacity-50 mb-1 block">Description</label>
          <textarea
            required
            rows={4}
            className={`w-full p-3 rounded-xl outline-none border transition-all ${theme.input} focus:border-[#7c3aed] resize-none`}
            placeholder={formData.type === 'bug' ? "Describe the steps to reproduce..." : "Give us more details..."}
            value={formData.description}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
          />
        </div>

        <button
          disabled={loading}
          className="w-full bg-[#7c3aed] text-white py-3.5 rounded-xl font-bold transition flex justify-center items-center gap-2 hover:bg-[#6d28d9]"
        >
          {loading ? <Loader2 className="animate-spin" /> : <><Send size={18}/> Submit Feedback</>}
        </button>
      </form>
    </div>
  );
}