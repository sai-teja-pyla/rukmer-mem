import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Loader2, X, Plus, Home, Settings, MessageSquare, Plug, Clock } from 'lucide-react';

// FIREBASE IMPORTS
import { collection, addDoc, getDocs, getDoc, query, where, orderBy, serverTimestamp, doc, updateDoc, deleteDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { getAuth } from "firebase/auth";

// SERVICES & TYPES
import { sendChatMessage as saveToDB } from '../services/api';
import PricingModal from './PricingModal';
import type { UserProfile } from '../types';

// IMPORTED EXTRACTED COMPONENTS
import { ChatHistory } from './ChatHistory';
import { ChatInput } from './ChatInput';
import { WelcomeState } from './WelcomeState';
import { MessageBubble } from './MessageBubble.tsx';
import { useUserSettings } from '../hooks/useUserSettings';
import UserDropdown from './UserDropdown';

interface DashboardProps {
  user: UserProfile;
  isPro: boolean;
}

// --- HELPER FUNCTIONS (Outside Component) ---
async function callGemini(prompt: string): Promise<string> {
  try {
    const apiKey = ((import.meta as any).env as any).VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Missing VITE_GEMINI_API_KEY');
    
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      // 🧠 MATCHING THE PERSONALITY
      systemInstruction: "You are Rukmer, a friendly workplace companion. Be helpful, conversational, and use a touch of wit. Avoid sounding like a dry manual."
    });
    
    // Add temperature here as well
    const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 }
    });
    const response = await result.response;
    return response.text();
  } catch (error: any) {
    return "Ouch, my brain stalled for a second! Try asking me that again?";
  }
}

type ViewState = 'home' | 'chat';
type SidebarState = 'none' | 'history' | 'apps';

export default function Dashboard({ user, isPro }: DashboardProps) {
    // --- 1. CORE LAYOUT STATE ---
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { settings } = useUserSettings();
    const displayName = settings?.displayName || user?.name || 'Guest';
    const [currentView, setCurrentView] = useState<ViewState>('home');
    const [activeSidebar, setActiveSidebar] = useState<SidebarState>('none');
    const [showPricing, setShowPricing] = useState(false);

    // --- 2. CHAT & ANALYSIS STATE ---
    const [chatMessages, setChatMessages] = useState<any[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [chatLoading, setChatLoading] = useState(false);
    
    const [mediaItems, setMediaItems] = useState<any[]>([]);
    const [report, setReport] = useState<any>(null);
    const [reportId, setReportId] = useState<string | null>(null);
    const [pastReports, setPastReports] = useState<any[]>([]);
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const [appConnections, setAppConnections] = useState<Record<string, boolean>>({});

    useEffect(() => {
    const auth = getAuth();
    const fetchToken = async () => {
        const user = auth.currentUser;
        if (user) {
            const token = await user.getIdToken();
            console.log("--------------------------");
            console.log("YOUR TEST TOKEN (COPY THIS):");
            console.log(token);
            console.log("--------------------------");
        }
    };
    fetchToken();
}, []);

    // --- 3. EFFECTS ---
    useEffect(() => {
    if (!user?.uid) return;
    
    console.log("📡 Starting listener for:", user.uid);
    const connRef = doc(db, "userConnections", user.uid);

    const unsubscribe = onSnapshot(connRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            console.log("🟢 Data received in Dashboard:", data);
            setAppConnections(data);
        } else {
            console.log("⚪ Document does not exist yet for this user.");
        }
    }, (error) => {
        console.error("🔴 Listener Error:", error);
    });

    return () => unsubscribe();
}, [user?.uid]);

    // Fetch chat history from backend
    useEffect(() => {
        if (!user?.uid) return;
        
        const fetchChatHistory = async () => {
            try {
                const idToken = await auth.currentUser?.getIdToken();
                console.log("📡 Fetching chat history for user:", user.uid);
                
                const response = await fetch(`/api/history?userId=${user.uid}`, {
                    headers: {
                        'Authorization': `Bearer ${idToken}`
                    }
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Failed to fetch history: ${response.status} - ${errorText}`);
                }
                
                const chats = await response.json();
                console.log("✅ Got chat history:", chats);
                
                // Transform database rows into display format
                const formattedChats = chats.map((chat: any) => ({
                    id: chat.id,
                    title: chat.user_message?.substring(0, 50) || 'Chat',
                    userMessage: chat.user_message,
                    aiReply: chat.ai_reply,
                    date: new Date(chat.created_at)
                }));
                
                console.log("✅ Formatted chats:", formattedChats);
                setPastReports(formattedChats);
            } catch (error) {
                console.error('❌ Error fetching chat history:', error);
            }
        };
        
        fetchChatHistory();
    }, [user?.uid]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    // --- 4. DATA FORMATTING ---
    const groupedHistory = useMemo(() => {
        const groups: Record<string, any[]> = { 'TODAY': [], 'YESTERDAY': [], 'PREVIOUS 7 DAYS': [] };
        const now = new Date();
        const yesterday = new Date();
        yesterday.setDate(now.getDate() - 1);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(now.getDate() - 7);

        pastReports.forEach(r => {
            // Use the date field we stored (it's already a Date object)
            const chatDate = r.date instanceof Date ? r.date : new Date(r.date);
            
            if (chatDate.toDateString() === now.toDateString()) {
                groups['TODAY'].push(r);
            } else if (chatDate.toDateString() === yesterday.toDateString()) {
                groups['YESTERDAY'].push(r);
            } else if (chatDate >= sevenDaysAgo) {
                groups['PREVIOUS 7 DAYS'].push(r);
            }
        });
        return groups;
    }, [pastReports]);

    const toggleConnection = async (appId: string) => {
        if (!user?.uid) return;
        const isConnected = appConnections[appId] || false;

        if (isConnected) {
            // DISCONNECT LOGIC: If they are already connected, allow them to disconnect
            if (window.confirm(`Are you sure you want to disconnect ${appId}? Rukmer will stop syncing data.`)) {
                try {
                    const connRef = doc(db, "userConnections", user.uid);
                    await setDoc(connRef, { [appId]: false }, { merge: true });
                    // Optional: Call your backend to actually revoke the token from Slack/Google
                } catch (error) {
                    console.error("Error disconnecting:", error);
                }
            }
        } else {
            // CONNECT LOGIC: Redirect to your backend to start OAuth
            const backendUrl = window.location.origin;
            
            // Special handling for Microsoft apps (Outlook, OneDrive & Teams)
            if (appId === 'outlook' || appId === 'onedrive' || appId === 'teams') {
                const oauthUrl = `${backendUrl}/api/auth/microsoft?userId=${user.uid}&type=${appId}`;
                window.location.href = oauthUrl;
            } else {
                // Standard OAuth apps (Slack, Gmail, Google Drive)
                const oauthUrl = `${backendUrl}/api/auth/${appId}?userId=${user.uid}`;
                window.location.href = oauthUrl;
            }
        }
    };

    const AVAILABLE_APPS = [
        { id: 'slack', name: 'Slack', icon: 'https://cdn.worldvectorlogo.com/logos/slack-new-logo.svg' },
        { id: 'gmail', name: 'Gmail', icon: 'https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png' },
        { id: 'gdrive', name: 'Google Drive', icon: 'https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png' },
        { id: 'outlook', name: 'Outlook', icon: 'https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/svg/outlook_48x1.svg' },
        { id: 'teams', name: 'Microsoft Teams', icon: 'https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/svg/teams_48x1.svg' },
        { id: 'onedrive', name: 'OneDrive', icon: 'https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/svg/onedrive_48x1.svg' },
    ];

    // --- 5. LOGIC: UTILS & API ---
    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good morning';
        if (hour < 18) return 'Good afternoon';
        return 'Good evening';
    };

    const resetSession = () => {
        setMediaItems([]); setReport(null); setReportId(null); 
        setChatMessages([]); setActiveSidebar('none');
        setCurrentView('chat');
    };

    const loadReportById = async (id: string | number) => {
        try {
            console.log("📂 Loading chat with ID:", id, "Type:", typeof id);
            console.log("📋 Available chats:", pastReports.map(r => ({ id: r.id, type: typeof r.id })));
            
            // Convert both to strings for comparison
            const idStr = String(id);
            const chatRecord = pastReports.find(report => String(report.id) === idStr);
            
            if (chatRecord) {
                console.log("✅ Found chat record:", chatRecord);
                setReportId(idStr);
                setReport(chatRecord);
                setActiveSidebar('none');
                
                // Load the messages
                if (chatRecord.userMessage && chatRecord.aiReply) {
                    setChatMessages([
                        { role: 'user', content: chatRecord.userMessage },
                        { role: 'assistant', content: chatRecord.aiReply }
                    ]);
                    console.log("✅ Chat messages loaded");
                }
                
                setCurrentView('chat');
            } else {
                console.warn("⚠️  Chat not found in pastReports");
                // Fallback to Firestore reports (if they still exist)
                try {
                    const docSnap = await getDoc(doc(db, "reports", idStr));
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        setReportId(docSnap.id);
                        setReport({ ...data, id: docSnap.id });
                        setMediaItems(data.images?.map((img: any) => ({ preview: img.url, status: 'done' })) || []);
                        setCurrentView('chat');
                        setActiveSidebar('none');
                        setChatMessages([{ role: 'assistant', content: `📂 **Loaded Context:** ${data.projectName}` }]);
                    }
                } catch (firestoreErr) {
                    console.error("Firestore fallback failed:", firestoreErr);
                }
            }
        } catch (error) { 
            console.error("❌ Error loading report:", error); 
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const files = Array.from(e.target.files);
        if (mediaItems.length + files.length > 10) return alert("Max 10 files allowed.");

        const newItems = files.map(file => ({
            id: Math.random().toString(36).substr(2, 9),
            file, preview: URL.createObjectURL(file), type: file.type.split('/')[0], name: file.name
        }));
        setMediaItems(prev => [...prev, ...newItems]);
        setCurrentView('chat');
    };

    const sendChatMessage = async (overrideMessage: string | null = null) => {
    const msg = overrideMessage || chatInput;
    if (!msg.trim() || chatLoading) return;
    
    setChatInput('');
    setChatLoading(true);
    setCurrentView('chat');
    
    // Add user message to UI immediately
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);

    try {
        const idToken = await auth.currentUser?.getIdToken();
        
        // 🔥 CALL YOUR BACKEND INSTEAD OF GEMINI DIRECTLY
        const response = await fetch(`/api/ai/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                userId: user.uid,
                prompt: msg  // Send as 'prompt' field
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Backend failed');
        }

        const data = await response.json();
        
        // Use the reply returned by your backend
        const aiReply = data.reply || data.ai_reply;
        setChatMessages(prev => [...prev, { 
            role: 'assistant', 
            content: aiReply
        }]);
        
        // Add to history with the real ID from backend
        const newChat = {
            id: data.chatId || Math.random().toString(36).substr(2, 9),
            title: msg.substring(0, 50),
            userMessage: msg,
            aiReply: aiReply,
            date: data.createdAt ? new Date(data.createdAt) : new Date()
        };
        setPastReports(prev => [newChat, ...prev]);

    } catch (error) {
        console.error("Chat Error:", error);
        setChatMessages(prev => [...prev, { 
            role: 'assistant', 
            content: "Rukmer encountered an issue connecting to the service." 
        }]);
    } finally {
        setChatLoading(false);
    }
};

    // --- 6. RENDER ---
    return (
        <div className="flex h-screen bg-white font-sans overflow-hidden">
            
            {/* LAYER 1: Navigation Rail */}
            <aside className="w-[72px] bg-[#0B1120] flex flex-col items-center py-6 z-50 shrink-0 border-r border-slate-800/50">
                <nav className="flex flex-col gap-6 w-full px-3">
                    <SidebarRailItem 
                        icon={<Home size={20}/>} 
                        label="Home" 
                        active={currentView === 'home' && activeSidebar === 'none'} 
                        onClick={() => { setCurrentView('home'); setActiveSidebar('none'); }} 
                    />
                    <SidebarRailItem 
                        icon={<MessageSquare size={20}/>} 
                        label="Chat" 
                        active={currentView === 'chat' && activeSidebar === 'none'} 
                        onClick={() => { setCurrentView('chat'); setActiveSidebar('none'); }} 
                    />
                    <SidebarRailItem 
                        icon={<Clock size={20}/>} 
                        label="History" 
                        active={activeSidebar === 'history'} 
                        onClick={() => setActiveSidebar(prev => prev === 'history' ? 'none' : 'history')} 
                    />
                    <SidebarRailItem 
                        icon={<Plug size={20}/>} 
                        label="Apps" 
                        active={activeSidebar === 'apps'} 
                        onClick={() => setActiveSidebar(prev => prev === 'apps' ? 'none' : 'apps')} 
                    />
                </nav>

                <div className="mt-auto pb-2 flex flex-col gap-6 items-center w-full">
                    <SidebarRailItem 
                        icon={<Settings size={20}/>} 
                        label="Settings" 
                        onClick={() => navigate('/settings')} 
                    />
                    <UserDropdown 
                        user={user} 
                        isPro={isPro} 
                        onUpgradeClick={() => setShowPricing(true)} 
                    />
                </div>
            </aside>

            {/* LAYER 2A: Sliding History Drawer */}
            {activeSidebar === 'history' && (
                <ChatHistory 
                    groupedHistory={groupedHistory}
                    activeChatId={reportId}
                    onSelectChat={loadReportById}
                    onClose={() => setActiveSidebar('none')}
                />
            )}

            {/* LAYER 2B: Sliding Apps Drawer */}
            {activeSidebar === 'apps' && (
                <div className="w-[280px] bg-[#0B1120] border-r border-slate-800/80 flex flex-col z-40 animate-in slide-in-from-left duration-200 shadow-2xl">
                    <div className="p-5 flex justify-between items-center">
                        <h2 className="text-white font-bold text-base">App Connections</h2>
                        <button onClick={() => setActiveSidebar('none')} className="text-slate-400 hover:text-white transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-4 mt-2">
                        <div className="space-y-2">
                            <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4">Integrations</h3>
                            {AVAILABLE_APPS.map(app => {
                                // Check Firebase state to see if this specific app is true/false
                                const isConnected = !!appConnections[app.id];
                                
                                return (
                                    <div 
                                        key={app.id} 
                                        onClick={() => toggleConnection(app.id)}
                                        className="flex items-center justify-between py-2 cursor-pointer transition-all group"
                                    >
                                        <div className="flex items-center gap-4">
                                            {/* Logo gets highlighted if connected */}
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors border overflow-hidden ${
                                                isConnected 
                                                    ? 'bg-white border-slate-300' 
                                                    : 'bg-slate-800/80 border-slate-700/50 group-hover:border-indigo-400'
                                            }`}>
                                                <img src={app.icon} alt={app.name} className="w-5 h-5 object-contain" />
                                            </div>
                                            <span className="text-[14px] font-medium text-slate-200 group-hover:text-white transition-colors">
                                                {app.name}
                                            </span>
                                        </div>
                                        {/* Status Dot */}
                                        <div className={`w-2 h-2 rounded-full transition-colors ${
                                            isConnected 
                                                ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' // Glows green!
                                                : 'bg-slate-700'
                                        }`} />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* LAYER 3: Main Dynamic Content */}
            <main className="flex-1 flex flex-col relative bg-white overflow-hidden shadow-[-10px_0_30px_rgba(0,0,0,0.05)]">
                
                {/* VIEW: HOME */}
                {currentView === 'home' && (
                    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white">
                        
                        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-6 pt-10 pb-16">
                            <div className="w-full max-w-3xl flex flex-col items-center animate-in fade-in duration-500">
                                <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-3 tracking-tight text-center">
                                    {getGreeting()}, {displayName.split(' ')[0]}
                                </h1>
                                <p className="text-slate-500 text-base md:text-lg mb-10 font-medium text-center">
                                    I can help you manage integrations, analyze data, and automate workflows.
                                </p>
                                
                                <WelcomeState onAction={(prompt) => {
                                    setChatInput(prompt);
                                    // Optional: sendChatMessage(prompt)
                                }} />
                            </div>
                        </div>

                        {/* Bottom Sticky Input - FIXED NESTING */}
                        <div className="w-full pb-8 pt-4 px-6 md:px-12 bg-white shrink-0">
                            <div className="max-w-3xl mx-auto">
                                <ChatInput 
                                    value={chatInput}
                                    onChange={setChatInput}
                                    onSend={() => sendChatMessage()}
                                    loading={chatLoading}
                                    showDisclaimer={true}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* VIEW: CHAT & ANALYSIS */}
                {currentView === 'chat' && (
                    <div className="flex-1 flex flex-col h-full bg-white">
                        <header className="h-16 border-b border-slate-100 flex items-center justify-between px-8 shrink-0">
                            <div className="flex items-center gap-3">
                                <h3 className="font-bold text-slate-800">{report?.projectName || "New Session"}</h3>
                            </div>
                            <button onClick={resetSession} className="text-slate-500 hover:text-indigo-600 px-4 py-2 text-sm font-semibold flex items-center gap-2 transition-colors">
                                <Plus size={16}/> New Chat
                            </button>
                        </header>
                        
                        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                            {chatMessages.map((m, i) => (
                                <MessageBubble key={i} message={m} />
                            ))}
                            {chatLoading && <TypingIndicator />}
                            <div ref={chatEndRef} />
                        </div>

                        <div className="p-6 border-t border-slate-100 bg-white">
                            <div className="max-w-4xl mx-auto flex flex-col gap-3">
                                {mediaItems.length > 0 && (
                                    <div className="flex gap-2 overflow-x-auto p-2 bg-slate-50 border border-slate-200 rounded-xl">
                                        {mediaItems.map((item) => (
                                            <div key={item.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 shrink-0">
                                                <img src={item.preview} className="w-full h-full object-cover" alt="upload" />
                                                <button onClick={() => setMediaItems(prev => prev.filter(i => i.id !== item.id))} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 hover:bg-red-500"><X size={12}/></button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                
                                <ChatInput 
                                    value={chatInput}
                                    onChange={setChatInput}
                                    onSend={() => sendChatMessage()}
                                    loading={chatLoading}
                                    onAttach={() => fileInputRef.current?.click()}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </main>

            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileUpload} />
            {showPricing && <PricingModal isOpen={showPricing} onClose={() => setShowPricing(false)} onCheckout={() => {}} />}
        </div>
    );
}

// ============================================================================
// INLINE SUB-COMPONENTS (Kept these two inline to avoid creating too many files)
// ============================================================================

const SidebarRailItem = ({ icon, label, active, onClick }: any) => (
    <button onClick={onClick} className={`flex flex-col items-center justify-center w-12 h-12 mx-auto gap-1 rounded-xl transition-all group ${active ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`}>
        <div className={`transition-transform ${active ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-300'}`}>{icon}</div>
        <span className={`text-[9px] font-semibold tracking-wide ${active ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-400'}`}>{label}</span>
    </button>
);

const TypingIndicator = () => (
    <div className="flex justify-start animate-in fade-in">
        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mr-4 mt-1"><span className="text-white text-xs font-bold">R</span></div>
        <div className="bg-white border border-slate-200 p-4 rounded-2xl rounded-tl-sm flex items-center gap-3 shadow-sm">
            <Loader2 className="animate-spin text-indigo-600" size={18}/>
            <span className="text-sm text-slate-500 font-medium">Rukmer is thinking...</span>
        </div>
    </div>
);