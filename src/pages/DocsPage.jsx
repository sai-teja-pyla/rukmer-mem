import React, { useState } from 'react';
import { useUserSettings } from '../hooks/useUserSettings';
import { useNavigate } from 'react-router-dom'; 
import { ArrowLeft, Book, FileText, Video, Layers, Shield, Zap } from 'lucide-react'; 

export default function DocsPage() {
  const { settings } = useUserSettings();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('getting-started');

  // Theme Logic
  const isDark = settings?.theme === 'dark';
  const theme = {
    bg: isDark ? 'bg-[#0f0f0f]' : 'bg-slate-50',
    text: isDark ? 'text-gray-200' : 'text-gray-800',
    sidebar: isDark ? 'bg-[#1a1a1a] border-gray-800' : 'bg-white border-gray-200',
    card: isDark ? 'bg-[#1a1a1a] border-gray-800' : 'bg-white border-gray-200',
    activeLink: isDark ? 'bg-blue-600/10 text-blue-500 border-blue-500' : 'bg-blue-50 text-blue-600 border-blue-600',
    inactiveLink: isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900',
    header: isDark ? 'text-white' : 'text-gray-900',
  };

  // Content Data
  const content = {
    'getting-started': {
      title: "Getting Started",
      icon: <Zap size={24} className="text-yellow-500"/>,
      body: (
        <div className="space-y-6">
          <p>Welcome to Rukmer AI! This platform helps construction managers analyze site photos and generate reports automatically.</p>
          <div className={`p-4 rounded-lg border-l-4 border-blue-500 ${isDark ? 'bg-blue-900/20' : 'bg-blue-50'}`}>
            <strong>Quick Start:</strong> Upload your first site photo on the Dashboard to see the AI in action.
          </div>
          <h3 className="text-xl font-bold mt-4">System Requirements</h3>
          <ul className="list-disc pl-5 space-y-2">
            <li>Modern Web Browser (Chrome, Firefox, Safari)</li>
            <li>Stable Internet Connection</li>
            <li>Images in JPG, PNG, or WEBP format</li>
          </ul>
        </div>
      )
    },
    'uploading': {
      title: "Uploading Assets",
      icon: <Layers size={24} className="text-blue-500"/>,
      body: (
        <div className="space-y-6">
            <p>You can upload multiple files at once. The AI analyzes them as a batch.</p>
            <h3 className="text-xl font-bold">Supported File Types</h3>
            <div className="grid grid-cols-2 gap-4">
                <div className={`p-4 border rounded-lg ${theme.card}`}>
                    <span className="font-bold block mb-1">Images</span>
                    <span className="text-sm opacity-70">.jpg, .png, .webp (Max 5MB)</span>
                </div>
                <div className={`p-4 border rounded-lg ${theme.card}`}>
                    <span className="font-bold block mb-1">Documents</span>
                    <span className="text-sm opacity-70">.pdf (Max 10MB)</span>
                </div>
            </div>
        </div>
      )
    },
    'reports': {
        title: "Generating Reports",
        icon: <FileText size={24} className="text-green-500"/>,
        body: (
          <div className="space-y-4">
            <p>Once your files are analyzed, a report is generated automatically. You can export this report to PDF.</p>
            <ol className="list-decimal pl-5 space-y-3">
                <li>Upload files</li>
                <li>Wait for AI Analysis (approx 5-10 seconds)</li>
                <li>Review the "Accomplishments" and "Concerns"</li>
                <li>Click the <strong>PDF Icon</strong> to download.</li>
            </ol>
          </div>
        )
      },
    'security': {
      title: "Data Security",
      icon: <Shield size={24} className="text-purple-500"/>,
      body: (
        <div className="space-y-4">
          <p>Your data security is our top priority.</p>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Encryption:</strong> All data is encrypted at rest and in transit.</li>
            <li><strong>Privacy:</strong> We do not use your data to train public AI models.</li>
            <li><strong>Ownership:</strong> You retain full ownership of all uploaded assets.</li>
          </ul>
        </div>
      )
    }
  };

  return (
    <div className={`min-h-screen flex flex-col md:flex-row ${theme.bg} ${theme.text} transition-colors duration-300`}>
      
      {/* SIDEBAR NAVIGATION */}
      <aside className={`w-full md:w-64 border-r p-6 flex-shrink-0 ${theme.sidebar}`}>
        <button 
          onClick={() => navigate('/help')} 
          className="flex items-center gap-2 mb-8 text-sm font-medium hover:text-blue-500 transition-colors"
        >
          <ArrowLeft size={16} /> Back to Help
        </button>

        <h2 className="text-xs font-bold uppercase tracking-wider opacity-50 mb-4">Documentation</h2>
        
        <nav className="space-y-1">
          <button 
            onClick={() => setActiveTab('getting-started')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'getting-started' ? theme.activeLink : theme.inactiveLink}`}
          >
            <Zap size={18} /> Getting Started
          </button>
          
          <button 
            onClick={() => setActiveTab('uploading')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'uploading' ? theme.activeLink : theme.inactiveLink}`}
          >
            <Layers size={18} /> Uploading Assets
          </button>

          <button 
            onClick={() => setActiveTab('reports')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'reports' ? theme.activeLink : theme.inactiveLink}`}
          >
            <FileText size={18} /> Reports & PDF
          </button>

          <button 
            onClick={() => setActiveTab('security')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'security' ? theme.activeLink : theme.inactiveLink}`}
          >
            <Shield size={18} /> Security
          </button>
        </nav>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 p-8 md:p-12 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
            
            {/* Dynamic Header */}
            <div className="flex items-center gap-4 mb-8 border-b pb-6 border-gray-700/20">
                <div className={`p-3 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-white shadow-sm border'}`}>
                    {content[activeTab].icon}
                </div>
                <h1 className={`text-3xl font-bold ${theme.header}`}>{content[activeTab].title}</h1>
            </div>

            {/* Dynamic Body */}
            <div className="leading-relaxed text-lg opacity-90">
                {content[activeTab].body}
            </div>

        </div>
      </main>

    </div>
  );
}