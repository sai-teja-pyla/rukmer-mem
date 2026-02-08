import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { 
  Upload, Loader2, X, Sparkles, MessageCircle, Send, RotateCcw, 
  LogOut, FileVideo, FileText, Moon, Sun, CheckCircle2, AlertTriangle, ArrowRight, Settings, 
  User as UserIcon, HelpCircle, ChevronDown, CreditCard, SquarePen, LayoutGrid, Hexagon, Plus, FileStack
} from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import UserDropdown from '../components/UserDropdown';

// FIREBASE IMPORTS
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, addDoc, getDocs, query, where, orderBy, serverTimestamp } from "firebase/firestore";
import { storage, db } from "../firebase";

export default function Dashboard({ user, onLogout }) {
  // --- 1. STATE ---
  const [mediaItems, setMediaItems] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  
  // History State
  const [pastReports, setPastReports] = useState([]); 
  const [showHistory, setShowHistory] = useState(false);

  // Chat State
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  
  // UI State
  const [darkMode, setDarkMode] = useState(false);

  // --- NEW STATE FOR PROFILE MENU ---
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileMenuRef = useRef(null);
  
  // Refs
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatSessionRef = useRef(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setIsProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);


  // --- 2. DATABASE FUNCTIONS ---

  const saveReportToDB = async (aiResult) => {
    try {
      if (!user) return; 

      await addDoc(collection(db, "reports"), {
        userId: user.uid,
        userName: user.name || "Anonymous",
        projectName: projectName || "Untitled Project",
        date: reportDate,
        createdAt: serverTimestamp(),
        // Save the AI Summary
        status: aiResult.summary.status, 
        accomplishments: aiResult.summary.accomplishments,
        concerns: aiResult.summary.concerns,
        imageCount: mediaItems.length
      });
      
      console.log("💾 Report saved to Firestore!");
      fetchReports(); // Refresh the list immediately
    } catch (error) {
      console.error("❌ Error saving report:", error);
    }
  };

  const fetchReports = async () => {
    if (!user) return;
    try {
      const q = query(
        collection(db, "reports"), 
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc")
      );
      const querySnapshot = await getDocs(q);
      const reports = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPastReports(reports);
    } catch (error) {
      console.error("Error fetching reports:", error);
    }
  };

  // Load reports on startup
  useEffect(() => {
    if (user) fetchReports();
  }, [user]);


  // --- 3. HANDLERS ---

  const handleFileUpload = (e) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);

    // A. Immediate UI Update
    const newItems = files.map(file => {
        if (file.size > 50 * 1024 * 1024) {
             alert(`File ${file.name} is too large!`);
             return null;
        }
        return {
            id: Math.random().toString(36).substr(2, 9),
            file, 
            preview: URL.createObjectURL(file), 
            type: file.type.startsWith('video/') ? 'video' : 'image',
            name: file.name,
            uploadStatus: 'uploading' 
        };
    }).filter(item => item !== null);

    setMediaItems(prev => [...prev, ...newItems]);

    // B. Background Upload
    newItems.forEach(async (item) => {
        try {
            const cleanProject = (projectName || "Uncategorized").replace(/\s+/g, '_');
            const storagePath = `projects/${cleanProject}/${reportDate}/${Date.now()}_${item.name}`;
            const storageRef = ref(storage, storagePath);

            const snapshot = await uploadBytes(storageRef, item.file);
            const downloadURL = await getDownloadURL(snapshot.ref);

            setMediaItems(prevItems => 
                prevItems.map(prev => 
                    prev.id === item.id ? { ...prev, uploadStatus: 'done', gcsUrl: downloadURL } : prev
                )
            );
        } catch (error) {
            console.error(`❌ Upload Failed for ${item.name}:`, error);
        }
    });
  };

  const removeMedia = (id) => {
    setMediaItems(prev => prev.filter(item => item.id !== id));
  };

  const analyzeSite = async () => {
    if (mediaItems.length === 0) return;
    setAnalyzing(true);
    
    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) throw new Error("Missing Gemini API Key");
      
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", 
        systemInstruction: "You are a Senior Construction Manager. Analyze site photos, videos, and PDFs. Return ONLY valid JSON.",
        generationConfig: { responseMimeType: "application/json" } 
      });

      // Prepare Files
      const mediaPromises = mediaItems.map(async (item) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({
            inlineData: {
              data: reader.result.split(',')[1],
              mimeType: item.file.type 
            }
          });
          reader.onerror = reject;
          reader.readAsDataURL(item.file);
        });
      });
      const mediaParts = await Promise.all(mediaPromises);

      const prompt = `Analyze these files. Return JSON:
      {
        "projectName": "${projectName || "Site Analysis"}",
        "summary": {
            "status": "on_track|delayed|risk",
            "accomplishments": ["item1", "item2"],
            "concerns": ["issue1", "issue2"],
            "nextSteps": ["action1", "action2"]
        }
      }`;

      const result = await model.generateContent([prompt, ...mediaParts]);
      const reportData = JSON.parse(result.response.text());

      // 1. Set Local State
      setReport({
        projectName: reportData.projectName,
        date: reportDate,
        summary: reportData.summary
      });

      // 2. Save to Firestore 
      saveReportToDB(reportData);

      // 3. Initialize Chat
      const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      chatSessionRef.current = chatModel.startChat({
        history: [
          { role: "user", parts: [{ text: "Context:" }, ...mediaParts] },
          { role: "model", parts: [{ text: `Analysis complete. Status: ${reportData.summary.status}` }] }
        ]
      });

      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ **Analysis Complete!** Saved to Project History.`
      }]);

    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const sendChatMessage = async (manualMsg = null) => {
    const msg = manualMsg || chatInput;
    if (!msg.trim() || chatLoading) return;
    
    // If no session exists (e.g., loaded from history), create a basic one
    if (!chatSessionRef.current) {
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        chatSessionRef.current = model.startChat();
    }

    setChatInput('');
    setChatLoading(true);
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);

    try {
        const result = await chatSessionRef.current.sendMessage(msg);
        setChatMessages(prev => [...prev, { role: 'assistant', content: result.response.text() }]);
    } catch (error) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: "Error: " + error.message }]);
    } finally {
        setChatLoading(false);
    }
  };

  const downloadPDF = () => {
    if (!report) return;
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.setTextColor(124, 58, 237);
    doc.text(report.projectName || "Report", 14, 22);
    
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Date: ${report.date}`, 14, 30);

    doc.autoTable({
        startY: 40,
        head: [['Category', 'Details']],
        body: [
            ['Status', report.summary.status],
            ['Accomplishments', report.summary.accomplishments.join('\n')],
            ['Concerns', report.summary.concerns.join('\n')],
            ['Next Steps', (report.summary.nextSteps || []).join('\n')]
        ],
    });
    doc.save(`${report.projectName}.pdf`);
  };

  const resetApp = () => {
    setMediaItems([]);
    setReport(null);
    setChatMessages([]);
    chatSessionRef.current = null;
    setShowHistory(false); // Reset history view
  };

  // --- 4. THEME & RENDER ---
  const theme = {
    bg: darkMode ? 'bg-black' : 'bg-[#f8fafc]',
    card: darkMode ? 'bg-[#111111] border-[#333]' : 'bg-white border-gray-200',
    header: darkMode ? 'bg-[#111111] border-[#333]' : 'bg-white border-gray-200',
    text: darkMode ? 'text-gray-100' : 'text-[#0f172a]',
    subText: darkMode ? 'text-gray-400' : 'text-[#64748b]',
    input: darkMode ? 'bg-[#1a1a1a] border-[#333] text-white' : 'bg-white border-gray-300 text-gray-900',
    chatUser: 'bg-[#7c3aed] text-white',
    chatAI: darkMode ? 'bg-[#1a1a1a] text-gray-200 border border-[#333]' : 'bg-[#f3f4f6] text-gray-800',
    border: darkMode ? 'border-[#333]' : 'border-gray-200',
    glow: darkMode ? 'shadow-[0_0_40px_-10px_rgba(124,58,237,0.3)]' : 'shadow-none'
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${theme.bg} ${theme.text}`}>
      
      {/* HEADER */}
      <header className={`${theme.header} border-b px-6 py-3 flex justify-between items-center sticky top-0 z-50`}>
        
        {/* Logo Section */}
        <div className="flex items-center gap-2">
          {darkMode && <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e] animate-pulse"></div>}
          <h1 className="text-xl font-bold tracking-tight">RUKMER <span className="text-[#7c3aed]">AI</span></h1>
        </div>
        
        {/* Right Side Actions */}
        <div className="flex items-center gap-4">
            
            {/* Theme Toggle */}
            <button 
                onClick={() => setDarkMode(!darkMode)}
                className={`p-2 rounded-full transition-colors ${darkMode ? 'bg-[#222] text-white' : 'bg-gray-100 text-slate-600'}`}
            >
                {darkMode ? <Sun size={18} className="text-yellow-400"/> : <Moon size={18}/>}
            </button>

            {/* PROFILE DROPDOWN */}
            <div className="relative" ref={profileMenuRef}>
                
                {/* Trigger Button */}
                <button 
                    onClick={() => setIsProfileOpen(!isProfileOpen)}
                    className={`flex items-center gap-3 pl-2 pr-3 py-1.5 rounded-lg border transition-all ${
                        darkMode ? 'border-[#333] hover:bg-[#222]' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                >
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#7c3aed] to-[#a78bfa] flex items-center justify-center text-white font-bold text-xs shadow-md">
                        {(() => {
                            if (!user?.name) return "GU";
                            const names = user.name.trim().split(' ');
                            if (names.length === 1) return names[0].substring(0, 2).toUpperCase();
                            return (names[0][0] + names[names.length - 1][0]).toUpperCase();
                        })()}
                    </div>
                    
                    {/* Text Info */}
                    <div className="hidden sm:block text-left">
                        <p className={`text-xs font-bold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                            {user?.name || "Guest User"}
                        </p>
                        <p className="text-[10px] text-gray-500 font-medium">Free Plan</p>
                    </div>

                    <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${isProfileOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
                {isProfileOpen && (
                    <div className={`absolute right-0 mt-2 w-64 rounded-xl border shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 z-50 ${
                        darkMode ? 'bg-[#1a1a1a] border-[#333] text-gray-200' : 'bg-white border-gray-100 text-gray-800'
                    }`}>
                        <div className={`p-4 border-b ${darkMode ? 'border-[#333]' : 'border-gray-100'}`}>
                            <p className="font-bold text-sm">{user?.name || "Guest"}</p>
                            <p className="text-xs text-gray-500">@{user?.email?.split('@')[0] || "user"}</p>
                        </div>

                        <div className="p-2 space-y-1">
                            <button className={`w-full text-left flex items-center gap-3 p-2.5 rounded-lg text-sm transition ${darkMode ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
                                <Sparkles size={16} className="text-yellow-500" /> 
                                <span>Upgrade plan</span>
                            </button>
                            <button className={`w-full text-left flex items-center gap-3 p-2.5 rounded-lg text-sm transition ${darkMode ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
                                <UserIcon size={16} className="text-blue-500" /> 
                                <span>Personalization</span>
                            </button>
                            <button className={`w-full text-left flex items-center gap-3 p-2.5 rounded-lg text-sm transition ${darkMode ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
                                <Settings size={16} className="text-gray-400" /> 
                                <span>Settings</span>
                            </button>
                        </div>
                        <div className={`h-px mx-2 ${darkMode ? 'bg-[#333]' : 'bg-gray-100'}`}></div>
                        <div className="p-2 space-y-1">
                            <button className={`w-full text-left flex items-center gap-3 p-2.5 rounded-lg text-sm transition ${darkMode ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
                                <HelpCircle size={16} className="text-gray-400" /> 
                                <span>Help</span>
                            </button>
                            <button 
                                onClick={onLogout}
                                className={`w-full text-left flex items-center gap-3 p-2.5 rounded-lg text-sm transition text-red-500 ${darkMode ? 'hover:bg-red-900/20' : 'hover:bg-red-50'}`}
                            >
                                <LogOut size={16} /> 
                                <span>Log out</span>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4 lg:p-8 grid lg:grid-cols-12 gap-6 h-[calc(100vh-80px)]">
        
        {/* LEFT PANEL: NAVIGATION & WORKSPACE */}
        <div className="lg:col-span-5 flex flex-col h-full overflow-y-auto pr-2 custom-scrollbar">
            
            {/* NAVIGATION MENU */}
            <div className="mb-6 space-y-1">
                {/* 1. New Chat */}
                <button 
                    onClick={() => {
                        setShowHistory(false);
                        if (report) resetApp(); 
                    }}
                    className={`w-full flex items-center justify-between p-3.5 rounded-xl transition-all group ${
                        !showHistory && !report ? (darkMode ? 'bg-[#222] text-white' : 'bg-white shadow-sm border border-gray-200 text-gray-900') : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-[#222]'
                    }`}
                >
                    <div className="flex items-center gap-3 font-semibold">
                        <SquarePen size={20} className={(!showHistory && !report) ? "text-[#7c3aed]" : "text-gray-400"} />
                        <span>New Chat</span>
                    </div>
                    <Plus size={18} className="text-gray-400 group-hover:text-gray-600" />
                </button>

                {/* 2. Community Agents */}
                <button className="w-full flex items-center gap-3 p-3.5 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-[#222] transition-all font-semibold opacity-60 cursor-not-allowed">
                    <LayoutGrid size={20} />
                    <span>More Models</span>
                    <span className="ml-auto text-[10px] bg-gray-100 dark:bg-[#333] px-2 py-0.5 rounded-full">SOON</span>
                </button>

                {/* 3. Asset Reports */}
                <button 
                    onClick={() => setShowHistory(true)}
                    className={`w-full flex items-center gap-3 p-3.5 rounded-xl transition-all font-semibold ${
                        showHistory ? (darkMode ? 'bg-[#222] text-white' : 'bg-white shadow-sm border border-gray-200 text-gray-900') : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-[#222]'
                    }`}
                >
                    <Hexagon size={20} className={showHistory ? "text-[#7c3aed]" : "text-gray-400"} />
                    <span>Asset Reports</span>
                </button>
            </div>

            {/* DYNAMIC CONTENT AREA */}
            <div className="flex-1">
                {showHistory ? (
                    // --- HISTORY VIEW ---
                    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Recent Reports</h3>
                        {pastReports.length === 0 && (
                            <div className={`p-8 text-center border-dashed border-2 rounded-xl ${theme.border}`}>
                                <p className={theme.subText}>No assets analyzed yet.</p>
                            </div>
                        )}
                        {pastReports.map(hist => (
                            <div 
                                key={hist.id} 
                                onClick={() => {
                                    setReport({
                                        projectName: hist.projectName,
                                        date: hist.date,
                                        summary: {
                                            status: hist.status,
                                            accomplishments: hist.accomplishments,
                                            concerns: hist.concerns,
                                            nextSteps: hist.nextSteps || []
                                        }
                                    });
                                    setProjectName(hist.projectName);
                                    setShowHistory(false); 
                                    setChatMessages([]); 
                                }}
                                className={`p-4 border rounded-xl cursor-pointer transition hover:scale-[1.01] ${theme.card} hover:shadow-md group`}
                            >
                                <div className="flex justify-between items-start">
                                    <h3 className="font-bold truncate pr-4">{hist.projectName}</h3>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                                        hist.status === 'on_track' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                    }`}>
                                        {hist.status?.replace('_', ' ')}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center mt-3 text-xs text-gray-400">
                                    <span>{hist.date}</span>
                                    <span className="flex items-center gap-1"><FileStack size={12}/> {hist.imageCount || 0} Assets</span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    // --- UPLOAD / REPORT VIEW ---
                    <>
                    {!report ? (
                        <div className={`${theme.card} p-8 rounded-2xl shadow-sm border text-center transition-all duration-300 animate-in fade-in`}>
                            <div className="mb-6 flex justify-center">
                                <div className={`w-16 h-16 rounded-full flex items-center justify-center ${darkMode ? 'bg-[#222]' : 'bg-[#f3e8ff]'}`}>
                                    <Upload className={darkMode ? 'text-[#a78bfa]' : 'text-[#7c3aed]'} size={32} />
                                </div>
                            </div>

                            <h2 className="text-2xl font-bold mb-2">New Analysis</h2>
                            <p className={`${theme.subText} mb-8`}>Upload photos, videos & documents to generate a new asset report.</p>

                            <input 
                                type="text" 
                                placeholder="Project Name" 
                                className={`w-full p-3 rounded-xl mb-4 outline-none border transition-all ${theme.input}`}
                                value={projectName}
                                onChange={(e) => setProjectName(e.target.value)}
                            />
                            
                            <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,application/pdf" className="hidden" onChange={handleFileUpload} />

                            {mediaItems.length === 0 ? (
                                <button onClick={() => fileInputRef.current?.click()} className={`w-full py-10 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 hover:opacity-80 transition ${theme.border} ${theme.subText}`}>
                                    <span className="font-semibold">Click to browse files</span>
                                </button>
                            ) : (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-4 gap-2">
                                        {mediaItems.map(item => (
                                            <div key={item.id} className="relative aspect-square rounded-lg overflow-hidden group bg-gray-100 border border-gray-200">
                                                {item.type === 'video' ? <FileVideo className="absolute inset-0 m-auto text-gray-800" /> : 
                                                item.type === 'pdf' ? <FileText className="absolute inset-0 m-auto text-red-500" /> : 
                                                <img src={item.preview} className="w-full h-full object-cover" />}
                                                <button onClick={() => removeMedia(item.id)} className="absolute top-1 right-1 bg-red-500 p-1 rounded-full text-white opacity-0 group-hover:opacity-100 transition"><X size={10} /></button>
                                            </div>
                                        ))}
                                        <button onClick={() => fileInputRef.current?.click()} className={`border-2 border-dashed rounded-lg flex items-center justify-center ${theme.border}`}>
                                            <Upload size={16} className={theme.subText} />
                                        </button>
                                    </div>
                                    <button onClick={analyzeSite} disabled={analyzing} className="w-full bg-[#7c3aed] hover:bg-[#6d28d9] text-white py-3.5 rounded-xl font-bold transition flex justify-center items-center gap-2 shadow-lg shadow-purple-500/20">
                                        {analyzing ? <Loader2 className="animate-spin" /> : <><Sparkles size={18}/> Generate Report</>}
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        // --- ACTIVE REPORT CARD ---
                        <div className={`${theme.card} p-6 rounded-2xl shadow-sm border animate-in fade-in slide-in-from-bottom-4`}>
                            <div className="flex justify-between items-center mb-6">
                                <div><h2 className="text-xl font-bold">{report.projectName}</h2><p className={`text-sm ${theme.subText}`}>{report.date}</p></div>
                                <div className="flex gap-2">
                                    <button onClick={downloadPDF} className={`p-2 rounded-lg border hover:bg-gray-50/10 transition ${theme.border}`}><FileText size={18} /></button>
                                </div>
                            </div>
                            
                            <div className={`p-3 rounded-lg mb-6 border ${
                                report.summary.status === 'on_track' ? 'bg-green-500/10 text-green-600 border-green-500/20' : 
                                'bg-red-500/10 text-red-600 border-red-500/20'
                            }`}>
                                <div className="flex items-center gap-2 font-bold text-lg">
                                    {report.summary.status === 'on_track' ? <CheckCircle2 size={20}/> : <AlertTriangle size={20}/>}
                                    {report.summary.status?.replace('_', ' ').toUpperCase()}
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div><h3 className="font-semibold mb-2 text-[#7c3aed]">Accomplishments</h3><ul className={`list-disc pl-5 text-sm ${theme.subText}`}>{report.summary.accomplishments.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                                <div><h3 className="font-semibold mb-2 text-red-500">Concerns</h3><ul className={`list-disc pl-5 text-sm ${theme.subText}`}>{report.summary.concerns.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                            </div>
                        </div>
                    )}
                    </>
                )}
            </div>
        </div>

        {/* RIGHT PANEL: CHAT INTERFACE */}
        <div className="lg:col-span-7 h-full flex flex-col">
            <div className={`${theme.card} flex-1 rounded-2xl border overflow-hidden flex flex-col ${theme.glow}`}>
                
                {/* Chat Header */}
                <div className={`p-4 border-b ${theme.border} ${darkMode ? 'bg-[#111]' : 'bg-[#7c3aed] text-white'} flex items-center justify-between`}>
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${darkMode ? 'bg-[#222]' : 'bg-white/20'}`}>
                             <MessageCircle className={darkMode ? "text-[#7c3aed]" : "text-white"} size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold">{darkMode ? "Rukmer AI" : "AI Assistant"}</h3>
                            <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-purple-100'}`}>
                                {report ? "Context Loaded" : "Ready to chat"}
                            </p>
                        </div>
                    </div>
                    {darkMode && <button onClick={resetApp} className="text-xs text-gray-500 hover:text-white transition">Reset</button>}
                </div>

                {/* Chat Area */}
                <div className={`flex-1 overflow-y-auto p-6 space-y-6 ${darkMode ? 'bg-black' : 'bg-slate-50'}`}>
                    {chatMessages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
                            <MessageCircle size={48} className="mb-4 text-[#7c3aed]" />
                            <h3 className="text-lg font-medium">Assistant Ready</h3>
                            <p className="text-sm max-w-xs mt-2">Upload files to enable AI analysis.</p>
                        </div>
                    ) : (
                        chatMessages.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                                <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm leading-relaxed ${msg.role === 'user' ? theme.chatUser : theme.chatAI}`}>
                                    {msg.content.split('\n').map((line, idx) => <p key={idx} className="mb-1">{line}</p>)}
                                </div>
                            </div>
                        ))
                    )}
                    {chatLoading && <div className="flex justify-start items-center gap-3"><Loader2 className="animate-spin text-[#7c3aed]" size={16} /> <span className="text-sm">Processing...</span></div>}
                    <div ref={chatEndRef} />
                </div>

                {/* Input Area */}
                <div className={`p-4 border-t ${theme.border} ${darkMode ? 'bg-[#111]' : 'bg-white'}`}>
                    <div className="relative flex items-center">
                        <input 
                            className={`w-full pl-4 pr-12 py-3.5 rounded-xl outline-none transition-all shadow-sm ${theme.input}`}
                            placeholder="Ask anything..."
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                            disabled={chatLoading}
                        />
                        <button onClick={() => sendChatMessage()} disabled={chatLoading} className={`absolute right-2 p-2 rounded-lg transition-colors ${darkMode ? 'bg-[#7c3aed] text-white' : 'bg-[#7c3aed] text-white'}`}>
                            <Send size={18} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}