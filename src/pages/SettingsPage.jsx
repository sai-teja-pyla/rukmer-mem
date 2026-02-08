import React from 'react';
import { useUserSettings } from '../hooks/useUserSettings';
import { useNavigate } from 'react-router-dom'; 
import { User, Zap, Moon, Sun, Mail, Save, ArrowLeft } from 'lucide-react'; 

export default function SettingsPage() {
  const { settings, updateSettings, loading } = useUserSettings();
  const navigate = useNavigate();

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!settings) return <div className="min-h-screen flex items-center justify-center">Please log in.</div>;

  // 1. Determine active theme (Default to dark if undefined)
  const isDark = settings.theme === 'dark';

  // 2. Define colors based on theme
  const theme = {
    bg: isDark ? 'bg-[#0f0f0f]' : 'bg-slate-50',
    text: isDark ? 'text-gray-200' : 'text-gray-800',
    card: isDark ? 'bg-[#1a1a1a] border-gray-800' : 'bg-white border-gray-200',
    header: isDark ? 'text-white' : 'text-gray-900',
    subtext: isDark ? 'text-gray-400' : 'text-gray-500',
    input: isDark ? 'bg-[#0f0f0f] border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
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

        {/* Header */}
        <div className={`mb-8 border-b pb-4 ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
          <h1 className={`text-3xl font-bold mb-2 ${theme.header}`}>Account Settings</h1>
          <p className={theme.subtext}>Manage your profile and AI preferences.</p>
        </div>

        {/* Section 1: Profile Info */}
        <div className={`rounded-xl p-6 mb-6 border shadow-lg ${theme.card}`}>
          <h2 className={`text-xl font-semibold mb-6 flex items-center gap-2 ${theme.header}`}>
            <User size={20} className="text-blue-500"/> 
            Profile Information
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-1 ${theme.subtext}`}>Display Name</label>
              <input
                type="text"
                value={settings.displayName || ''}
                onChange={(e) => updateSettings({ displayName: e.target.value })}
                className={`w-full rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none transition ${theme.input}`}
                placeholder="Enter your name"
              />
            </div>
            
            <div>
              <label className={`block text-sm font-medium mb-1 ${theme.subtext}`}>Email Address</label>
              <div className={`flex items-center gap-3 border rounded-lg p-3 cursor-not-allowed ${isDark ? 'bg-[#252525] border-gray-800 text-gray-400' : 'bg-gray-100 border-gray-200 text-gray-500'}`}>
                <Mail size={16} />
                <span>{settings.email}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: AI Personalization */}
        <div className={`rounded-xl p-6 mb-6 border shadow-lg ${theme.card}`}>
          <h2 className={`text-xl font-semibold mb-6 flex items-center gap-2 ${theme.header}`}>
            <Zap size={20} className="text-yellow-500"/> 
            AI Personalization
          </h2>

          <div className="mb-2">
            <div className="flex justify-between mb-2">
              <label className={`text-sm font-medium ${theme.subtext}`}>Creativity Level</label>
              <span className="text-sm text-yellow-500 font-mono font-bold">
                {Math.round((settings.aiCreativity || 0.7) * 100)}%
              </span>
            </div>
            
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.aiCreativity || 0.7}
              onChange={(e) => updateSettings({ aiCreativity: parseFloat(e.target.value) })}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500 hover:accent-yellow-400"
            />
            
            <div className={`flex justify-between text-xs mt-3 font-medium ${theme.subtext}`}>
              <span>Strict & Factual</span>
              <span>Balanced</span>
              <span>Creative & Wild</span>
            </div>
          </div>
        </div>

        {/* Section 3: Appearance */}
        <div className={`rounded-xl p-6 mb-6 border shadow-lg flex items-center justify-between ${theme.card}`}>
          <div>
            <h2 className={`text-xl font-semibold mb-1 flex items-center gap-2 ${theme.header}`}>
               {isDark ? <Moon size={20} className="text-purple-500"/> : <Sun size={20} className="text-orange-500"/>}
               Appearance
            </h2>
            <p className={`text-sm ${theme.subtext}`}>Toggle between light and dark themes.</p>
          </div>

          <button
            onClick={() => updateSettings({ theme: isDark ? 'light' : 'dark' })}
            style={{
              backgroundColor: isDark ? '#9333ea' : '#9ca3af',
              transition: 'background-color 0.2s'
            }}
            className="relative inline-flex h-7 w-12 items-center rounded-full focus:outline-none"
          >
            <span
              style={{
                transform: isDark ? 'translateX(26px)' : 'translateX(4px)',
                transition: 'transform 0.2s'
              }}
              className="inline-block h-5 w-5 rounded-full bg-white"
            />
          </button>
        </div>
        
        {/* Save Indicator */}
        <div className="flex justify-end text-sm text-green-500 flex items-center gap-2 opacity-70">
           <Save size={14} /> Changes save automatically
        </div>

      </div>
    </div>
  );
}