import React, { useState, useRef, useEffect } from 'react';
import { useUserSettings } from '../hooks/useUserSettings';
import { auth } from '../firebase';
import { useNavigate } from 'react-router-dom';
import { 
  User, 
  Settings, 
  LogOut, 
  HelpCircle, 
  Zap,
  ChevronDown,
  MessageSquare // Added icon import
} from 'lucide-react';
import FeedbackModal from './FeedbackModal';

export default function UserDropdown({ user }) {
  const { settings } = useUserSettings(); 
  const [isOpen, setIsOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false); // New state for feedback
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  // 1. Detect Theme (Default to Dark if loading)
  const isDark = settings?.theme === 'dark';

  // 2. Define Dynamic Styles
  const theme = {
    menuBg: isDark ? 'bg-[#1a1a1a] border-gray-800' : 'bg-white border-gray-200',
    text: isDark ? 'text-gray-200' : 'text-gray-700',
    subText: isDark ? 'text-gray-500' : 'text-gray-500',
    hover: isDark ? 'hover:bg-[#2a2a2a]' : 'hover:bg-gray-100',
    headerBg: isDark ? 'bg-[#202020]' : 'bg-gray-50',
    divider: isDark ? 'border-gray-800' : 'border-gray-100',
    iconColor: isDark ? 'text-gray-400' : 'text-gray-400' // Icons stay neutral
  };

  // Close dropdown if clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await auth.signOut();
    navigate('/'); 
  };

  const initial = settings?.displayName ? settings.displayName.charAt(0).toUpperCase() : "U";

  return (
    <div className="relative" ref={dropdownRef}>
      
      {/* 1. The Trigger Button (Theme Aware) */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 p-1.5 rounded-full transition-all ${theme.hover}`}
      >
        {/* Avatar Circle */}
        <div 
          className={`h-8 w-8 rounded-full flex items-center justify-center text-white font-bold shadow-sm ${
            isDark ? 'border border-gray-700' : 'border-2 border-white ring-1 ring-gray-200'
          }`}
          style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }} 
        >
          {initial}
        </div>
        
        {/* Chevron Icon */}
        <ChevronDown size={14} className={isDark ? "text-gray-400" : "text-gray-600"} />
      </button>

      {/* 2. The Dropdown Menu */}
      {isOpen && (
        <div className={`absolute right-0 mt-2 w-64 rounded-xl border shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right ${theme.menuBg}`}>
          
          {/* User Info Header */}
          <div className={`px-4 py-4 border-b ${theme.divider} ${theme.headerBg}`}>
            <p className={`font-semibold truncate ${theme.text}`}>
              {settings?.displayName || "User"}
            </p>
            <p className={`text-xs truncate ${theme.subText}`}>
              {settings?.email || "user@example.com"}
            </p>
          </div>

          {/* Menu Items */}
          <div className="py-2">
            
            <button className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition font-medium text-yellow-500 ${theme.hover}`}>
              <Zap size={16} />
              <span>Upgrade plan</span>
            </button>

            <button 
              onClick={() => { setIsOpen(false); navigate('/settings'); }}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition ${theme.hover} ${theme.text}`}
            >
              <Settings size={16} className={theme.iconColor}/>
              <span> Account Settings</span>
            </button>
          </div>

          {/* Divider */}
          <div className={`border-t mx-2 ${theme.divider}`}></div>

          {/* Footer Items */}
          <div className="py-2">
            <button 
              onClick={() => { setIsOpen(false); navigate('/help'); }}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition ${theme.hover} ${theme.text}`}
            >
              <HelpCircle size={16} className={theme.iconColor}/>
              <span>Help</span>
            </button>

            {/* NEW: Feedback Trigger */}
            <button 
              onClick={() => { 
                setIsOpen(false); 
                setIsFeedbackOpen(true); // 2. This triggers the modal
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

      {/* 3. Feedback Modal - Positioned outside the dropdown relative container */}
      <FeedbackModal 
        user={user} 
        darkMode={settings?.theme === 'dark'} 
        isOpen={isFeedbackOpen} 
        onClose={() => setIsFeedbackOpen(false)} 
      />
    </div>
  );
}