import React from 'react';
import FeedbackForm from './FeedbackForm';

export default function FeedbackModal({ user, darkMode, isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    // We use z-[9999] to stay above the dashboard and sidebar
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6">
      
      {/* 1. The Backdrop (The blur you are seeing) */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-md animate-in fade-in duration-300" 
        onClick={onClose} 
      />
      
      {/* 2. The Form Container (The part that is currently missing) */}
      <div className="relative z-[10000] w-full max-w-md transform animate-in zoom-in-95 duration-200">
        <FeedbackForm 
          user={user} 
          darkMode={darkMode} 
          onClose={onClose} 
        />
      </div>
    </div>
  );
}