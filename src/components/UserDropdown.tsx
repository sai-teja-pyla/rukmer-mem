// src/components/UserDropdown.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useUserSettings } from '../hooks/useUserSettings';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { 
  User, 
  Settings, 
  LogOut, 
  HelpCircle, 
  Zap,
  ChevronDown,
  MessageSquare,
  CreditCard // Added for Subscription management
} from 'lucide-react';
import FeedbackModal from './FeedbackModal';

// ADDED: isPro prop to conditionally show upgrade/manage options
export default function UserDropdown({ user, onUpgradeClick, isPro }) {
  const { settings } = useUserSettings(); 
  const [isOpen, setIsOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false); 
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  const isDark = settings?.theme === 'dark';

  const displayName = settings?.displayName || user?.displayName || user?.email?.split('@')[0] || "User";

  const theme = {
    menuBg: isDark ? 'bg-[#1a1a1a] border-gray-800' : 'bg-white border-gray-200',
    text: isDark ? 'text-gray-200' : 'text-gray-700',
    subText: isDark ? 'text-gray-500' : 'text-gray-500',
    hover: isDark ? 'hover:bg-[#2a2a2a]' : 'hover:bg-gray-100',
    headerBg: isDark ? 'bg-[#202020]' : 'bg-gray-50',
    divider: isDark ? 'border-gray-800' : 'border-gray-100',
    iconColor: isDark ? 'text-gray-400' : 'text-gray-400'
  };

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    setIsOpen(false);
    void signOut(auth);
    window.location.assign('/login');
  };

  const initial = settings?.displayName ? settings.displayName.charAt(0).toUpperCase() : "U";

  return (
    <div className="relative" ref={dropdownRef}>
      
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center p-1 rounded-full transition-all hover:ring-2 hover:ring-indigo-500"
      >
        <div 
          className="h-8 w-8 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-sm border border-slate-700"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }} 
        >
          {initial}
        </div>
      </button>

      {isOpen && (
        <div className={`absolute bottom-full left-0 mb-2 w-64 rounded-xl border shadow-2xl z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-bottom-left ${theme.menuBg}`}>
          
          <div className={`px-4 py-4 border-b ${theme.divider} ${theme.headerBg}`}>
            <p className={`font-semibold truncate ${theme.text}`}>
              {displayName}
            </p>
            <p className={`text-xs truncate ${theme.subText}`}>
              {settings?.email || user?.email || "user@example.com"}
            </p>
          </div>

          <div className="py-2">
            
            {/* 1. MANAGE SUBSCRIPTION: Always visible to let users see their current status */}
            <button 
              onClick={() => { setIsOpen(false); navigate('/subscription'); }}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition ${theme.hover} ${theme.text}`}
            >
              <CreditCard size={16} className={theme.iconColor}/>
              <span>Manage Subscription</span>
            </button>

            {/* 2. UPGRADE PLAN: Only shows if user is not already Pro */}
            {!isPro && (
              <button
                onClick={() => {
                  setIsOpen(false); 
                  onUpgradeClick(); 
                }}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition font-medium text-yellow-500 ${theme.hover}`}
              >
                <Zap size={16} fill="currentColor" />
                <span>Upgrade plan</span>
              </button>
            )}

            <button 
              onClick={() => { setIsOpen(false); navigate('/settings'); }}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition ${theme.hover} ${theme.text}`}
            >
              <Settings size={16} className={theme.iconColor}/>
              <span> Account Settings</span>
            </button>
          </div>

          <div className={`border-t mx-2 ${theme.divider}`}></div>

          <div className="py-2">
            <button 
              onClick={() => { setIsOpen(false); navigate('/help'); }}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition ${theme.hover} ${theme.text}`}
            >
              <HelpCircle size={16} className={theme.iconColor}/>
              <span>Help</span>
            </button>

            <button 
              onClick={() => { 
                setIsOpen(false); 
                setIsFeedbackOpen(true); 
              }}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition ${theme.hover} ${theme.text}`}
            >
              <MessageSquare size={16} className="text-[#7c3aed]"/>
              <span>Give Feedback</span>
            </button>

            <button 
              onClick={handleLogout}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition text-red-500 ${theme.hover}`}
            >
              <LogOut size={16} />
              <span>Log out</span>
            </button>
          </div>
        </div>
      )}

      <FeedbackModal 
        user={user} 
        darkMode={settings?.theme === 'dark'} 
        isOpen={isFeedbackOpen} 
        onClose={() => setIsFeedbackOpen(false)} 
      />
    </div>
  );
}