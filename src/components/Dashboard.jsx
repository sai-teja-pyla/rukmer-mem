import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom'; 
import { GoogleGenerativeAI } from "@google/generative-ai";
import { 
  Upload, Loader2, X, Sparkles, MessageCircle, Send, 
  FileVideo, FileText, Moon, Sun, CheckCircle2, AlertTriangle,
  SquarePen, Hexagon, Plus, FileStack, Edit2, Trash2, LayoutGrid,
  ImageIcon 
} from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

import UserDropdown from '../components/UserDropdown';
import { useUserSettings } from '../hooks/useUserSettings';

// FIREBASE IMPORTS
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, addDoc, getDocs, getDoc, query, where, orderBy, serverTimestamp, doc, updateDoc, deleteDoc } from "firebase/firestore"; 
import { storage, db } from "../firebase";

export default function Dashboard({ user }) {
  // --- 1. STATE ---
  const [searchParams, setSearchParams] = useSearchParams(); 
  const [mediaItems, setMediaItems] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  
  const [report, setReport] = useState(null); 
  const [reportId, setReportId] = useState(null);

  const [projectName, setProjectName] = useState('');
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [pastReports, setPastReports] = useState([]); 
  const [showHistory, setShowHistory] = useState(false);
  const [reportIdToDelete, setReportIdToDelete] = useState(null);

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  
  const { settings, updateSettings } = useUserSettings(); 
  const darkMode = settings?.theme === 'dark';

  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatSessionRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // --- 2. RESTORE SESSION ---
  useEffect(() => {
    async function restoreSession() {
        const idFromUrl = searchParams.get('id');
        if (idFromUrl && idFromUrl !== reportId && user) {
            loadReportById(idFromUrl);
        }
    }
    restoreSession();
  }, [searchParams, user]); 

  // --- 3. HELPER: LOAD REPORT & SHOW IMAGE IN CHAT ---
  const loadReportById = async (id) => {
    try {
        const docRef = doc(db, "reports", id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // 1. Restore Report Data
            setReportId(docSnap.id);
            setProjectName(data.projectName);
            setReport({
                projectName: data.projectName,
                date: data.date,
                summary: {
                    status: data.status,
                    accomplishments: data.accomplishments || [],
                    concerns: data.concerns || [],
                    nextSteps: data.nextSteps || []
                }
            });

            // 2. Restore Images & Get Thumbnail
            let thumbnail = null;
            if (data.images && Array.isArray(data.images)) {
                setMediaItems(data.images.map(img => ({
                    id: Math.random().toString(36),
                    preview: img.url,
                    type: img.type,
                    name: img.name,
                    uploadStatus: 'done'
                })));
                // Grab the first image to show in chat
                if (data.images.length > 0) thumbnail = data.images[0].url;
            } else {
                setMediaItems([]);
            }

            setShowHistory(false); 

            // 3. Initialize Chat Context
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            
            chatSessionRef.current = model.startChat({
                history: [
                    { role: "user", parts: [{ text: `System: User loaded report "${data.projectName}". Status: ${data.status}.` }] },
                    { role: "model", parts: [{ text: `I have loaded the context for ${data.projectName}.` }] }
                ]
            });

            // 4. Add system message WITH IMAGE to chat UI
            setChatMessages(prev => [
                ...prev, 
                { 
                    role: 'assistant', 
                    content: `📂 **Opened Report:** ${data.projectName}`,
                    image: thumbnail // <--- PASS IMAGE URL HERE
                }
            ]);

        } else {
            console.warn("Report not found, clearing ID");
            setSearchParams({});
        }
    } catch (error) {
        console.error("Failed to load report:", error);
    }
  };


  // --- 4. DATABASE FUNCTIONS ---

  const handleRenameProject = async (newName) => {
    if (!reportId || !newName.trim()) return;
    try {
      const reportRef = doc(db, "reports", reportId);
      await updateDoc(reportRef, { projectName: newName });
      setReport(prev => ({ ...prev, projectName: newName }));
      setPastReports(prev => 
        prev.map(r => r.id === reportId ? { ...r, projectName: newName } : r)
      );
    } catch (error) {
      console.error("Error renaming:", error);
    }
  };

  const deleteReport = async (e, id) => {
    e.stopPropagation(); 
    if (!window.confirm("Are you sure you want to delete this report?")) return;

    try {
        await deleteDoc(doc(db, "reports", id));
        setPastReports(prev => prev.filter(r => r.id !== id));
        if (reportId === id) {
            resetApp();
        }
    } catch (error) {
        console.error("Error deleting report:", error);
        alert("Failed to delete report.");
    }
  };

  const saveReportToDB = async (aiResult, uploadedImages) => {
    try {
      if (!user) return; 

      const docRef = await addDoc(collection(db, "reports"), {
        userId: user.uid,
        userName: user.name || "Anonymous",
        projectName: projectName || "Untitled Project",
        date: reportDate,
        createdAt: serverTimestamp(),
        status: aiResult.summary.status, 
        accomplishments: aiResult.summary.accomplishments,
        concerns: aiResult.summary.concerns,
        images: uploadedImages, 
        imageCount: uploadedImages.length
      });
      
      setReportId(docRef.id);
      setSearchParams({ id: docRef.id }); 
      fetchReports(); 
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

  useEffect(() => {
    if (user) fetchReports();
  }, [user]);


  // --- 5. HANDLERS ---

  const handleFileUpload = (e) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);

    const newItems = files.map(file => {
        return {
            id: Math.random().toString(36).substr(2, 9),
            file, 
            preview: URL.createObjectURL(file), 
            type: file.type.startsWith('video/') ? 'video' : 'image',
            name: file.name,
            uploadStatus: 'pending' 
        };
    });

    setMediaItems(prev => [...prev, ...newItems]);
  };

  const removeMedia = (id) => {
    setMediaItems(prev => prev.filter(item => item.id !== id));
  };

  const analyzeSite = async () => {
    if (mediaItems.length === 0) return;
    setAnalyzing(true);
    
    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key Missing");

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", 
        generationConfig: { responseMimeType: "application/json" } 
      });

      // 1. Prepare Base64
      const mediaParts = await Promise.all(mediaItems.map(async (item) => {
        if (item.file) {
            return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ inlineData: { data: reader.result.split(',')[1], mimeType: item.file.type } });
            reader.readAsDataURL(item.file);
            });
        }
        return null; 
      }));

      const validMediaParts = mediaParts.filter(p => p !== null);

      // 2. Upload Images to Firebase
      const uploadedImages = await Promise.all(mediaItems.map(async (item) => {
        if (!item.file) return { url: item.preview, type: item.type, name: item.name }; 

        const storageRef = ref(storage, `reports/${user.uid}/${Date.now()}_${item.name}`);
        await uploadBytes(storageRef, item.file);
        const url = await getDownloadURL(storageRef);
        return { url, type: item.type, name: item.name };
      }));

      // 3. Call Gemini
      const prompt = `Analyze these files. Return JSON: { "projectName": "${projectName}", "summary": { "status": "on_track", "accomplishments": [], "concerns": [], "nextSteps": [] } }`;
      
      const result = await model.generateContent([prompt, ...validMediaParts]);
      const reportData = JSON.parse(result.response.text());

      setReport({
        projectName: reportData.projectName || projectName,
        date: reportDate,
        summary: reportData.summary
      });

      saveReportToDB(reportData, uploadedImages); 

      const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      chatSessionRef.current = chatModel.startChat({
          history: [
              { role: "user", parts: [{ text: `System: User just generated this report for ${reportData.projectName}.` }] },
              { role: "model", parts: [{ text: "Context loaded." }] }
          ]
      });

      setChatMessages([{ role: 'assistant', content: `Analysis Complete! Saved to history.` }]);

    } catch (error) {
      if (error.message.includes("429") || error.message.includes("Quota")) {
        alert("⚠️ AI Usage Limit Reached. Please wait a minute and try again.");
      } else {
        alert(`Error: ${error.message}`);
      }
      console.error(error);
    } finally {
      setAnalyzing(false);
    }
  };

  // --- 6. AI AGENT LOGIC (Long-Context Upgrade) ---
  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput;
    setChatInput('');
    setChatLoading(true);
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);

    try {
        if (!chatSessionRef.current) {
             const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
             chatSessionRef.current = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).startChat();
        }

        // 1. CONTEXT INJECTION (The "No-Database RAG")
        // We format a "Mini-Database" of your reports right into the prompt.
        // Since Gemini 1.5 Flash has 1M context, we can fit hundreds of reports here easily.
        const reportContext = pastReports.map(r => `
          [REPORT]
          ID: ${r.id}
          Name: "${r.projectName}"
          Date: ${r.date}
          Status: ${r.status}
          Key Issues: ${r.concerns ? r.concerns.slice(0, 3).join(", ") : "None"} 
          --------------------------------
        `).join("\n");
        
        const agentPrompt = `
        ${msg}
        
        [SYSTEM DATA - YOUR KNOWLEDGE BASE]
        You have instant access to the following project reports. 
        Use this data to answer questions like "Which project has roof issues?" or "Show me the report from last week".
        
        ${reportContext}

        [INSTRUCTIONS]
        1. If the user asks to "show", "open", or "load" a specific report, reply ONLY with: [[LOAD:ID]] using the ID from above.
        2. If the user asks about specific problems (e.g. "Which site has cracks?"), look at the "Key Issues" above and answer nicely.
        3. If you find the answer, tell them the project name and ask if they want to open it.
        `;

        const result = await chatSessionRef.current.sendMessage(agentPrompt);
        const responseText = result.response.text();

        const loadCommand = responseText.match(/\[\[LOAD:(.*?)\]\]/);

        if (loadCommand) {
            const targetId = loadCommand[1];
            const targetReport = pastReports.find(r => r.id === targetId);
            const rName = targetReport ? targetReport.projectName : "the report";

            setChatMessages(prev => [...prev, { role: 'assistant', content: `Sure! Opening **${rName}**...` }]);
            await loadReportById(targetId);
            setSearchParams({ id: targetId }); 

        } else {
            setChatMessages(prev => [...prev, { role: 'assistant', content: responseText }]);
        }

    } catch (error) {
        let errorMsg = "Sorry, I encountered an error.";
        if (error.message.includes("429")) errorMsg = "⚠️ Rate Limit. Please wait a moment.";
        setChatMessages(prev => [...prev, { role: 'assistant', content: errorMsg }]);
    } finally {
        setChatLoading(false);
    }
  };

  const downloadPDF = () => {
    if (!report) return;
    const doc = new jsPDF();
    doc.text(report.projectName || "Report", 14, 22);
    doc.autoTable({
        startY: 40,
        head: [['Category', 'Details']],
        body: [
            ['Status', report.summary.status],
            ['Accomplishments', report.summary.accomplishments.join('\n')],
            ['Concerns', report.summary.concerns.join('\n')]
        ],
    });
    doc.save(`${report.projectName}.pdf`);
  };

  const resetApp = () => {
    setMediaItems([]);
    setReport(null);
    setReportId(null);
    setProjectName('');
    setChatMessages([]);
    setShowHistory(false); 
    setSearchParams({}); // Clear URL
  };

  // --- 7. THEME & RENDER ---
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
        <div className="flex items-center gap-2">
          {darkMode && <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e] animate-pulse"></div>}
          <h1 className="text-xl font-bold tracking-tight">RUKMER <span className="text-[#7c3aed]">AI</span></h1>
        </div>
        <div className="flex items-center gap-4">
            <button 
                onClick={() => updateSettings({ theme: darkMode ? 'light' : 'dark' })}
                className={`p-2 rounded-full transition-colors ${darkMode ? 'bg-[#222] text-white' : 'bg-gray-100 text-slate-600'}`}
            >
                {darkMode ? <Sun size={18} className="text-yellow-400"/> : <Moon size={18}/>}
            </button>
            <UserDropdown />
        </div>
      </header>

      {/* h-[calc(100vh-80px)] added to force calculation based on viewport */}
      <div className="max-w-7xl mx-auto p-4 lg:p-8 grid lg:grid-cols-12 gap-6 h-[calc(100vh-80px)]">
        
        {/* LEFT PANEL - min-h-0 added to allow content to shrink */}
        <div className="lg:col-span-5 flex flex-col h-full min-h-0 overflow-y-auto pr-2 custom-scrollbar flex-shrink-0">
            
            <div className="mb-6 space-y-1">
                <button 
                    onClick={() => { setShowHistory(false); if (report) resetApp(); }}
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

                <button className="w-full flex items-center gap-3 p-3.5 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-[#222] transition-all font-semibold opacity-60 cursor-not-allowed">
                    <LayoutGrid size={20} />
                    <span>More Models</span>
                    <span className="ml-auto text-[10px] bg-gray-100 dark:bg-[#333] px-2 py-0.5 rounded-full">SOON</span>
                </button>

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

            <div className="flex-1 min-h-0 overflow-y-auto">
                {showHistory ? (
                    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Recent Reports</h3>
                        {pastReports.map(hist => (
                            <div 
                                key={hist.id} 
                                onClick={() => setSearchParams({ id: hist.id })}
                                className={`p-4 rounded-xl cursor-pointer transition-all duration-200 relative overflow-hidden group 
                                    ${theme.card} border border-transparent
                                    ${darkMode 
                                        ? 'hover:bg-[#1a1a1a] hover:border-[#7c3aed]/50 hover:shadow-[0_0_20px_-10px_rgba(124,58,237,0.3)]' 
                                        : 'hover:bg-gray-50 hover:border-[#7c3aed] hover:shadow-md'
                                    }`}
                                style={{ transform: 'translateZ(0)' }}
                            >
                                {/* TOP ROW: Title and Status */}
                                <div className="flex justify-between items-start mb-1">
                                    <h3 className="font-bold truncate pr-4 flex-1">{hist.projectName}</h3>
                                    
                                    {/* Status Badge */}
                                    <span className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                                        hist.status === 'on_track' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                    }`}>
                                        {hist.status?.replace('_', ' ')}
                                    </span>
                                </div>

                                {/* BOTTOM ROW: Info and Actions */}
                                <div className="flex justify-between items-end mt-4">
                                    {/* Left: Date and Assets */}
                                    <div className="text-[11px] text-gray-400 space-y-1">
                                        <p>{hist.date}</p>
                                        <span className="flex items-center gap-1.5"><FileStack size={12}/> {hist.imageCount || 0} Assets</span>
                                    </div>

                                    {/* Right: Delete Action (Fixed at Bottom-Right) */}
                                    <div className="opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0">
                                        <div className="backdrop-blur-md bg-white/5 dark:bg-black/40 rounded-lg border border-white/10 p-0.5 shadow-sm">
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (reportIdToDelete === hist.id) {
                                                        deleteReport(e, hist.id);
                                                        setReportIdToDelete(null);
                                                    } else {
                                                        setReportIdToDelete(hist.id);
                                                        setTimeout(() => setReportIdToDelete(null), 3000);
                                                    }
                                                }}
                                                className={`p-1.5 rounded-md transition-all duration-200 flex items-center gap-2 ${
                                                    reportIdToDelete === hist.id 
                                                        ? "bg-red-600 text-white px-3" 
                                                        : "text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                                }`}
                                            >
                                                {reportIdToDelete === hist.id ? (
                                                    <span className="text-[10px] font-bold uppercase tracking-tight">Confirm?</span>
                                                ) : (
                                                    <Trash2 size={15} />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
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
                                                <img src={item.preview} className="w-full h-full object-cover" />}
                                                <button onClick={() => removeMedia(item.id)} className="absolute top-1 right-1 bg-red-500 p-1 rounded-full text-white opacity-0 group-hover:opacity-100 transition"><X size={10} /></button>
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={analyzeSite} disabled={analyzing} className="w-full bg-[#7c3aed] hover:bg-[#6d28d9] text-white py-3.5 rounded-xl font-bold transition flex justify-center items-center gap-2 shadow-lg shadow-purple-500/20">
                                        {analyzing ? <Loader2 className="animate-spin" /> : <><Sparkles size={18}/> Generate Report</>}
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className={`${theme.card} p-6 rounded-2xl shadow-sm border animate-in fade-in slide-in-from-bottom-4`}>
                            <div className="flex justify-between items-start mb-6">
                                <div className="flex-1 mr-4">
                                    <div className="flex items-center gap-2 mb-1 group">
                                        <input 
                                            value={projectName}
                                            onChange={(e) => setProjectName(e.target.value)}
                                            onBlur={() => handleRenameProject(projectName)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleRenameProject(projectName)}
                                            className={`text-xl font-bold bg-transparent outline-none border-b border-transparent focus:border-[#7c3aed] transition-colors w-full ${theme.text}`}
                                        />
                                        <Edit2 size={14} className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                    <p className={`text-sm ${theme.subText}`}>{report.date}</p>
                                </div>
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

                            {/* --- RESTORED IMAGES GRID --- */}
                            {mediaItems.length > 0 && (
                                <div className="mt-8 pt-6 border-t border-gray-200/50">
                                    <h3 className="font-semibold mb-3 flex items-center gap-2"><ImageIcon size={16}/> Project Assets</h3>
                                    <div className="grid grid-cols-5 gap-2">
                                        {mediaItems.map((item, i) => (
                                            <div key={i} className="aspect-square rounded-lg overflow-hidden border border-gray-200/50 bg-gray-50">
                                                <img src={item.preview} className="w-full h-full object-cover" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                        </div>
                    )}
                    </>
                )}
            </div>
        </div>

        {/* RIGHT PANEL - CHAT (min-h-0 allows internal flex-1 to scroll) */}
        <div className="lg:col-span-7 h-full flex flex-col min-h-0">
            <div className={`${theme.card} flex-1 rounded-2xl border overflow-hidden flex flex-col ${theme.glow}`}>
                {/* flex-shrink-0 protects header height */}
                <div className={`p-4 border-b ${theme.border} ${darkMode ? 'bg-[#111]' : 'bg-[#7c3aed] text-white'} flex items-center justify-between flex-shrink-0`}>
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

                {/* flex-1 overflow-y-auto handles the internal scroll logic */}
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
                                    
                                    {/* --- CHAT IMAGE RENDER LOGIC --- */}
                                    {msg.image && (
                                        <div className="mb-3 rounded-lg overflow-hidden border border-gray-200/20">
                                            <img src={msg.image} className="w-full h-32 object-cover" />
                                        </div>
                                    )}
                                    
                                    {msg.content.split('\n').map((line, idx) => <p key={idx} className="mb-1">{line}</p>)}
                                </div>
                            </div>
                        ))
                    )}
                    {chatLoading && <div className="flex justify-start items-center gap-3"><Loader2 className="animate-spin text-[#7c3aed]" size={16} /> <span className="text-sm">Processing...</span></div>}
                    <div ref={chatEndRef} />
                </div>

                {/* flex-shrink-0 protects input bar height */}
                <div className={`p-4 border-t ${theme.border} ${darkMode ? 'bg-[#111]' : 'bg-white'} flex-shrink-0`}>
                    <div className="relative flex items-center">
                        <input 
                            className={`w-full pl-4 pr-12 py-3.5 rounded-xl outline-none transition-all shadow-sm ${theme.input}`}
                            placeholder="Ask or say 'Show me Project X'..."
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