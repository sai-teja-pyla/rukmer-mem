import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { 
  Upload, Loader2, X, Sparkles, MessageCircle, Send, RotateCcw, 
  LogOut, FileVideo, FileText, Moon, Sun, Camera, ShieldAlert, Ruler, 
  CheckCircle2, AlertTriangle, ArrowRight
} from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase";
import { collection, addDoc, getDocs, query, where, orderBy, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

export default function Dashboard({ user, onLogout }) {
  // --- STATE ---
  const [mediaItems, setMediaItems] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Chat State
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  
  // UI State
  const [darkMode, setDarkMode] = useState(false);
  
  // Refs
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatSessionRef = useRef(null);

  // Inside your Dashboard component
  const [pastReports, setPastReports] = useState([]); // Stores the list of history
  const [showHistory, setShowHistory] = useState(false); // Toggles the sidebar view

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // --- HANDLERS ---
  // --- DEBUG VERSION OF UPLOAD HANDLER ---
  const handleFileUpload = (e) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);

    // 1. PREPARE ITEMS (Immediate UI Update)
    const newItems = files.map(file => {
        // Basic validation
        if (file.size > 50 * 1024 * 1024) {
             alert(`File ${file.name} is too large!`);
             return null;
        }

        return {
            id: Math.random().toString(36).substr(2, 9),
            file, // Keeps the raw file for the Report Generator
            preview: URL.createObjectURL(file), // Instant Preview (Like Old Code)
            type: file.type.startsWith('video/') ? 'video' : 'image',
            name: file.name,
            uploadStatus: 'uploading' // We can track this!
        };
    }).filter(item => item !== null);

    // 2. UPDATE STATE IMMEDIATELY (User sees images instantly)
    setMediaItems(prev => [...prev, ...newItems]);

    // 3. START BACKGROUND UPLOAD (Doesn't block the UI)
    newItems.forEach(async (item) => {
        try {
            // Clean filename
            const cleanProject = (projectName || "Uncategorized").replace(/\s+/g, '_');
            const storagePath = `projects/${cleanProject}/${reportDate}/${Date.now()}_${item.name}`;
            
            // Reference to your Custom Bucket
            const storageRef = ref(storage, storagePath);

            // Upload
            console.log(`🚀 Background uploading: ${item.name}`);
            const snapshot = await uploadBytes(storageRef, item.file);
            const downloadURL = await getDownloadURL(snapshot.ref);

            console.log(`✅ Uploaded to GCS: ${item.name}`);

            // Optional: Update the item in state to mark it as "done"
            setMediaItems(prevItems => 
                prevItems.map(prev => 
                    prev.id === item.id ? { ...prev, uploadStatus: 'done', gcsUrl: downloadURL } : prev
                )
            );

        } catch (error) {
            console.error(`❌ Background Upload Failed for ${item.name}:`, error);
            // We don't alert the user here because we don't want to interrupt their workflow
            setMediaItems(prevItems => 
                prevItems.map(prev => 
                    prev.id === item.id ? { ...prev, uploadStatus: 'error' } : prev
                )
            );
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

      setReport({
        projectName: reportData.projectName,
        date: reportDate,
        summary: reportData.summary
      });

      saveReportToDB(reportData);

      const saveReportToDB = async (aiResult) => {
    try {
      if (!user) return; // Only save if logged in

      await addDoc(collection(db, "reports"), {
        userId: user.uid,
        userName: user.name || "Anonymous",
        projectName: projectName || "Untitled Project",
        date: reportDate,
        createdAt: serverTimestamp(),
        // Save the AI Summary
        status: aiResult.summary.status, // 'on_track' or 'at_risk'
        accomplishments: aiResult.summary.accomplishments,
        concerns: aiResult.summary.concerns,
        // Save references to the images (optional, but good for context)
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

  // Load reports when user logs in
  useEffect(() => {
    if (user) fetchReports();
  }, [user]);


      // Initialize Chat
      const chatModel = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash",
        systemInstruction: "You are a helpful AI assistant for this construction project."
      });

      chatSessionRef.current = chatModel.startChat({
        history: [
          { role: "user", parts: [{ text: "Here are the project files:" }, ...mediaParts] },
          { role: "model", parts: [{ text: `I have analyzed the files. Status: ${reportData.summary.status}.` }] }
        ]
      });

      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ **Analysis Complete!** I'm ready to answer questions about the site.`
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
    
    if (!chatSessionRef.current) {
        alert("Please generate a report first!");
        return;
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
    doc.setTextColor(124, 58, 237); // Purple 600
    doc.text(report.projectName, 14, 22);
    
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Date: ${report.date}`, 14, 30);

    doc.autoTable({
        startY: 40,
        headStyles: { fillColor: [124, 58, 237] }, // Purple Header
        head: [['Category', 'Details']],
        body: [
            ['Status', report.summary.status.toUpperCase()],
            ['Accomplishments', report.summary.accomplishments.join('\n• ')],
            ['Concerns', report.summary.concerns.join('\n• ')],
            ['Next Steps', report.summary.nextSteps.join('\n• ')]
        ],
    });
    doc.save(`${report.projectName}_Report.pdf`);
  };

  const resetApp = () => {
    setMediaItems([]);
    setReport(null);
    setChatMessages([]);
    chatSessionRef.current = null;
  };

  // --- THEME PALETTE (MATCHING YOUR SCREENSHOTS) ---
  const theme = {
    // Backgrounds
    bg: darkMode ? 'bg-black' : 'bg-[#f8fafc]',
    card: darkMode ? 'bg-[#111111] border-[#333]' : 'bg-white border-gray-200',
    header: darkMode ? 'bg-[#111111] border-[#333]' : 'bg-white border-gray-200',
    
    // Text
    text: darkMode ? 'text-gray-100' : 'text-[#0f172a]', // Slate-900
    subText: darkMode ? 'text-gray-400' : 'text-[#64748b]', // Slate-500
    
    // Inputs
    input: darkMode 
        ? 'bg-[#1a1a1a] border-[#333] text-white focus:ring-[#7c3aed]' 
        : 'bg-white border-gray-300 text-gray-900 focus:ring-[#7c3aed]',
    
    // Chat Bubbles
    chatUser: darkMode ? 'bg-[#7c3aed] text-white' : 'bg-[#7c3aed] text-white', // Violet-600
    chatAI: darkMode ? 'bg-[#1a1a1a] text-gray-200 border border-[#333]' : 'bg-[#f3f4f6] text-gray-800',
    
    // Accents
    border: darkMode ? 'border-[#333]' : 'border-gray-200',
    primary: 'text-[#7c3aed]', // Violet-600
    glow: darkMode ? 'shadow-[0_0_40px_-10px_rgba(124,58,237,0.3)]' : 'shadow-none' // The Purple Glow
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${theme.bg} ${theme.text}`}>
      
      {/* HEADER */}
      <header className={`${theme.header} border-b px-6 py-4 flex justify-between items-center sticky top-0 z-50`}>
        <div className="flex items-center gap-2">
          {/* Green "Live" Dot if in Dark Mode, matching screenshot 3 */}
          {darkMode && <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e] animate-pulse"></div>}
          <h1 className="text-xl font-bold tracking-tight">RUKMER <span className="text-[#7c3aed]">AI</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
            <button 
                onClick={() => setDarkMode(!darkMode)}
                className={`p-2 rounded-full transition-colors ${darkMode ? 'bg-[#222] text-white' : 'bg-gray-100 text-slate-600'}`}
            >
                {darkMode ? <Sun size={18} className="text-yellow-400"/> : <Moon size={18}/>}
            </button>

            <span className={`text-sm ${theme.subText} hidden sm:inline font-medium`}>
                {user?.name || "Guest"}
            </span>
            <button onClick={onLogout} className="text-red-500 hover:bg-red-50/10 px-3 py-2 rounded transition">
                <LogOut size={18} />
            </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4 lg:p-8 grid lg:grid-cols-12 gap-6 h-[calc(100vh-80px)]">
        
        {/* LEFT PANEL: INPUT & REPORT (Span 5 columns) */}
        <div className="lg:col-span-5 flex flex-col gap-6 h-full overflow-y-auto pr-2 custom-scrollbar">
            
            {!report ? (
                <div className={`${theme.card} p-8 rounded-2xl shadow-sm border text-center transition-all duration-300`}>
                    
                    {/* Icon Circle */}
                    <div className="mb-6 flex justify-center">
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${darkMode ? 'bg-[#222]' : 'bg-[#f3e8ff]'}`}>
                            <Upload className={darkMode ? 'text-[#a78bfa]' : 'text-[#7c3aed]'} size={32} />
                        </div>
                    </div>

                    <h2 className="text-2xl font-bold mb-2">Ready to Generate Your Report?</h2>
                    <p className={`${theme.subText} mb-8`}>
                        Upload construction site photos, videos, or PDFs and let AI analyze progress.
                    </p>

                    <input 
                        type="text" 
                        placeholder="Project Name (Optional)" 
                        className={`w-full p-3 rounded-xl mb-4 outline-none border transition-all ${theme.input}`}
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                    />
                    
                    <input 
                        ref={fileInputRef} 
                        type="file" 
                        multiple 
                        accept="image/*,video/*,application/pdf"
                        className="hidden" 
                        onChange={handleFileUpload}
                    />

                    {mediaItems.length === 0 ? (
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            className={`w-full py-10 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 hover:opacity-80 transition ${theme.border} ${theme.subText}`}
                        >
                            <span className="font-semibold">Click to browse files</span>
                            <span className="text-xs opacity-70">Max 20MB per file</span>
                        </button>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-4 gap-2">
                                {mediaItems.map(item => (
                                    <div key={item.id} className="relative aspect-square rounded-lg overflow-hidden group bg-gray-100 border border-gray-200">
                                        {item.type === 'video' && <FileVideo className="absolute inset-0 m-auto text-gray-800" />}
                                        {item.type === 'pdf' && <FileText className="absolute inset-0 m-auto text-red-500" />}
                                        {item.type === 'image' && <img src={item.preview} className="w-full h-full object-cover" />}
                                        <button onClick={() => removeMedia(item.id)} className="absolute top-1 right-1 bg-red-500 p-1 rounded-full text-white opacity-0 group-hover:opacity-100 transition">
                                            <X size={10} />
                                        </button>
                                    </div>
                                ))}
                                <button onClick={() => fileInputRef.current?.click()} className={`border-2 border-dashed rounded-lg flex items-center justify-center ${theme.border}`}>
                                    <Upload size={16} className={theme.subText} />
                                </button>
                            </div>

                            <button 
                                onClick={analyzeSite} 
                                disabled={analyzing}
                                className="w-full bg-[#7c3aed] hover:bg-[#6d28d9] text-white py-3.5 rounded-xl font-bold transition flex justify-center items-center gap-2 shadow-lg shadow-purple-500/20"
                            >
                                {analyzing ? <Loader2 className="animate-spin" /> : <><Sparkles size={18}/> Generate Report</>}
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div className={`${theme.card} p-6 rounded-2xl shadow-sm border animate-in fade-in slide-in-from-bottom-4`}>
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h2 className="text-xl font-bold">{report.projectName}</h2>
                            <p className={`text-sm ${theme.subText}`}>{report.date}</p>
                        </div>
                        <div className="flex gap-2">
                             <button onClick={downloadPDF} className={`p-2 rounded-lg border hover:bg-gray-50/10 transition ${theme.border}`} title="Download PDF">
                                <FileText size={18} />
                            </button>
                            <button onClick={resetApp} className={`p-2 rounded-lg border hover:bg-gray-50/10 transition ${theme.border} text-blue-500`} title="New Project">
                                <RotateCcw size={18} />
                            </button>
                        </div>
                    </div>
                    
                    <div className={`p-3 rounded-lg mb-6 border ${
                        report.summary.status === 'on_track' ? 'bg-green-500/10 text-green-600 border-green-500/20' : 
                        report.summary.status === 'delayed' ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' : 
                        'bg-red-500/10 text-red-600 border-red-500/20'
                    }`}>
                        <div className="flex items-center gap-2 font-bold text-lg">
                            {report.summary.status === 'on_track' ? <CheckCircle2 size={20}/> : <AlertTriangle size={20}/>}
                            {report.summary.status.replace('_', ' ').toUpperCase()}
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <h3 className="font-semibold mb-2 text-[#7c3aed] flex items-center gap-2">Accomplishments</h3>
                            <ul className={`list-disc pl-5 text-sm ${theme.subText} space-y-1`}>
                                {report.summary.accomplishments.map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                        </div>
                         <div>
                            <h3 className="font-semibold mb-2 text-red-500 flex items-center gap-2">Concerns</h3>
                            <ul className={`list-disc pl-5 text-sm ${theme.subText} space-y-1`}>
                                {report.summary.concerns.map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                        </div>
                    </div>
                </div>
            )}
        </div>

        {/* RIGHT PANEL: CHAT INTERFACE (Span 7 columns) */}
        <div className="lg:col-span-7 h-full flex flex-col">
            <div className={`${theme.card} flex-1 rounded-2xl border overflow-hidden flex flex-col ${theme.glow}`}>
                
                {/* Chat Header - Matches Screenshot 2 (Purple) or Screenshot 3 (Dark) */}
                <div className={`p-4 border-b ${theme.border} ${darkMode ? 'bg-[#111]' : 'bg-[#7c3aed] text-white'} flex items-center justify-between`}>
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${darkMode ? 'bg-[#222]' : 'bg-white/20'}`}>
                             <MessageCircle className={darkMode ? "text-[#7c3aed]" : "text-white"} size={20} />
                        </div>
                        <div>
                            <h3 className={`font-bold ${darkMode ? 'text-white' : 'text-white'}`}>
                                {darkMode ? "Rukmer AI Live Demo" : "AI Assistant"}
                            </h3>
                            <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-purple-100'}`}>
                                {report ? "Online • Context Loaded" : "Ask me anything about your project"}
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
                            <h3 className="text-lg font-medium">Your AI Assistant is Ready</h3>
                            <p className="text-sm max-w-xs mt-2">Upload images to start asking questions about defects, measurements, and safety.</p>
                            
                            {/* Suggested Chips (Light Mode Screenshot Style) */}
                            {!darkMode && (
                                <div className="flex flex-wrap gap-2 justify-center mt-6">
                                    {["Defect Analysis", "Measurements", "Safety Checks"].map(chip => (
                                        <span key={chip} className="px-3 py-1 bg-[#f3e8ff] text-[#7c3aed] rounded-full text-xs font-medium">
                                            {chip}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        chatMessages.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                                {msg.role === 'assistant' && (
                                    <div className={`mr-2 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${darkMode ? 'bg-[#7c3aed]' : 'bg-[#7c3aed]'}`}>
                                        <Sparkles size={14} className="text-white" />
                                    </div>
                                )}
                                <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm leading-relaxed ${msg.role === 'user' ? theme.chatUser : theme.chatAI}`}>
                                    {msg.content.split('\n').map((line, idx) => <p key={idx} className="mb-1 last:mb-0">{line}</p>)}
                                </div>
                            </div>
                        ))
                    )}
                    {chatLoading && (
                         <div className="flex justify-start items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${darkMode ? 'bg-[#7c3aed]' : 'bg-[#7c3aed]'}`}>
                                <Sparkles size={14} className="text-white" />
                            </div>
                            <div className={`${theme.chatAI} px-4 py-3 rounded-2xl flex items-center gap-2`}>
                                <Loader2 className="animate-spin text-[#7c3aed]" size={16} /> 
                                <span className="text-sm">Processing imagery...</span>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>

                {/* Suggested Questions (Chips) - Show only if report is generated */}
                {report && (
                    <div className={`px-4 py-3 border-t ${theme.border} ${theme.bg} overflow-x-auto whitespace-nowrap flex gap-2 custom-scrollbar`}>
                        {["🔍 Main concerns?", "📏 Surface area?", "🦺 Safety check?", "📋 Summary"].map((suggestion) => (
                            <button 
                                key={suggestion}
                                onClick={() => sendChatMessage(suggestion)}
                                className={`text-xs px-3 py-1.5 rounded-full border transition hover:scale-105 ${darkMode ? 'bg-[#1a1a1a] border-[#333] hover:bg-[#222] text-gray-300' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-600'}`}
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>
                )}
                
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold">Project Files</h2>
                    <button 
                        onClick={() => setShowHistory(!showHistory)}
                        className="text-sm text-purple-600 font-medium hover:underline"
                    >
                        {showHistory ? "Back to Upload" : "View Past Reports"}
                    </button>
                </div>
                {showHistory ? (
                    <div className="space-y-3">
                        {pastReports.length === 0 && <p className="text-gray-400">No reports saved yet.</p>}
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
                                            concerns: hist.concerns
                                        }
                                    });
                                    setProjectName(hist.projectName);
                                    setShowHistory(false);
                                }}
                                className="p-4 border rounded-xl hover:bg-gray-50 cursor-pointer transition group"
                            >
                                <div className="flex justify-between items-start">
                                    <h3 className="font-bold text-gray-800">{hist.projectName}</h3>
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                        hist.status === 'on_track' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                    }`}>
                                        {hist.status === 'on_track' ? 'ON TRACK' : 'AT RISK'}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-400 mt-1">{hist.date}</p>
                            </div>
                        ))}
                    </div>
                ) : null}

                

                {/* Input Area */}
                <div className={`p-4 border-t ${theme.border} ${darkMode ? 'bg-[#111]' : 'bg-white'}`}>
                    <div className="relative flex items-center">
                        <input 
                            className={`w-full pl-4 pr-12 py-3.5 rounded-xl outline-none transition-all shadow-sm ${theme.input}`}
                            placeholder="Ask anything about the site..."
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                            disabled={chatLoading}
                        />
                        <button 
                            onClick={() => sendChatMessage()} 
                            disabled={chatLoading}
                            className={`absolute right-2 p-2 rounded-lg transition-colors ${darkMode ? 'bg-[#7c3aed] text-white hover:bg-[#6d28d9]' : 'bg-[#7c3aed] text-white hover:bg-[#6d28d9]'}`}
                        >
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