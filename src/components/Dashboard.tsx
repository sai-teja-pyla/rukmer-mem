import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, X, Plus, Home, Settings, MessageSquare, Plug, Clock,
  Sparkles, Command, Search, Send, Paperclip, ArrowRight
} from 'lucide-react';

import { collection, addDoc, getDocs, getDoc, query, where, orderBy, serverTimestamp, doc, updateDoc, deleteDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { getAuth } from "firebase/auth";

import { sendChatMessage as saveToDB } from '../services/api';
import PricingModal from './PricingModal';
import type { UserProfile } from '../types';

import { ChatHistory } from './ChatHistory';
import { WelcomeState } from './WelcomeState';
import { MessageBubble } from './MessageBubble.tsx';
import { AnimatedLogo } from './AnimatedLogo';
import { useUserSettings } from '../hooks/useUserSettings';
import UserDropdown from './UserDropdown';

interface DashboardProps {
  user: UserProfile;
  isPro: boolean;
}

async function callGemini(prompt: string): Promise<string> {
  try {
    const apiKey = ((import.meta as any).env as any).VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Missing VITE_GEMINI_API_KEY');
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      systemInstruction: "You are Rukmer, a friendly workplace companion. Be helpful, conversational, and use a touch of wit."
    });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 }
    });
    return (await result.response).text();
  } catch {
    return "Ouch, my brain stalled for a second! Try asking me that again?";
  }
}

type ViewState = 'home' | 'chat';
type SidebarState = 'none' | 'history' | 'apps';

const spring = { type: "spring" as const, stiffness: 320, damping: 30 };
const springStiff = { type: "spring" as const, stiffness: 400, damping: 32 };

const AVAILABLE_APPS = [
  { id: 'slack', name: 'Slack', icon: 'https://cdn.worldvectorlogo.com/logos/slack-new-logo.svg', color: 'from-purple-500/20 to-pink-500/20' },
  { id: 'gmail', name: 'Gmail', icon: 'https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png', color: 'from-red-500/20 to-orange-500/20' },
  { id: 'gdrive', name: 'Google Drive', icon: 'https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png', color: 'from-yellow-500/20 to-green-500/20' },
  { id: 'outlook', name: 'Outlook', icon: 'https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/svg/outlook_48x1.svg', color: 'from-blue-500/20 to-cyan-500/20' },
  { id: 'teams', name: 'Teams', icon: 'https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/svg/teams_48x1.svg', color: 'from-violet-500/20 to-indigo-500/20' },
  { id: 'onedrive', name: 'OneDrive', icon: 'https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/svg/onedrive_48x1.svg', color: 'from-blue-500/20 to-sky-500/20' },
];

export default function Dashboard({ user, isPro }: DashboardProps) {
  const navigate = useNavigate();
  const { chatId: urlChatId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings } = useUserSettings();
  const displayName = settings?.displayName || user?.name || 'Guest';
  const [currentView, setCurrentView] = useState<ViewState>('home');
  const [activeSidebar, setActiveSidebar] = useState<SidebarState>('none');
  const [showPricing, setShowPricing] = useState(false);

  const [chatMessages, setChatMessages] = useState<any[]>(() => {
    try {
      const saved = sessionStorage.getItem('rukmer_chat_messages');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  const [mediaItems, setMediaItems] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    // ⚡ Restore session ID from storage to keep same session across refreshes
    const saved = sessionStorage.getItem('rukmer_session_id');
    return saved || null;
  });
  const [pastReports, setPastReports] = useState<any[]>([]);
  // In-memory cache: sessionId → messages[]  (survives re-renders, cleared on logout)
  const sessionMessagesCache = useRef<Map<string, any[]>>(new Map());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [appConnections, setAppConnections] = useState<Record<string, boolean>>({});

  // --- EFFECTS ---
  useEffect(() => {
    if (!user?.uid) return;
    const connRef = doc(db, "userConnections", user.uid);
    const unsubscribe = onSnapshot(connRef, (docSnap) => {
      if (docSnap.exists()) setAppConnections(docSnap.data());
    });
    return () => unsubscribe();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    const fetchChatHistory = async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const response = await fetch(`/api/history`, {
          headers: { 'Authorization': `Bearer ${idToken}` }
        });
        
        if (!response.ok) throw new Error(`Failed: ${response.status}`);
        
        const chats = await response.json();

        if (!chats || chats.length === 0) {
          setPastReports([]);
          return;
        }

        // Backend now returns one lean row per session (no ai_reply body)
        const formatted = chats.map((chat: any) => ({
          id: String(chat.id),
          sessionId: chat.session_id || `legacy_${chat.id}`,
          title: chat.title || 'Chat',
          date: new Date(chat.created_at),
          messageCount: Number(chat.message_count) || 1,
          messages: [], // loaded on demand
        }));
        setPastReports(formatted);
      } catch (error) {
        console.error('❌ Error fetching chat history:', error);
        setPastReports([]);
      }
    };
    fetchChatHistory();
  }, [user?.uid]);

  // Write to sessionStorage only when the stream finishes (not on every chunk)
  useEffect(() => {
    if (isStreaming) return; // skip mid-stream writes
    const id = setTimeout(() => {
      if (chatMessages.length > 0) sessionStorage.setItem('rukmer_chat_messages', JSON.stringify(chatMessages));
      else sessionStorage.removeItem('rukmer_chat_messages');
    }, 300); // debounce 300ms
    return () => clearTimeout(id);
  }, [chatMessages, isStreaming]);

  useEffect(() => {
    const saved = sessionStorage.getItem('rukmer_chat_messages');
    if (saved) {
      try { if (JSON.parse(saved).length > 0) setCurrentView('chat'); } catch {}
    }
  }, []);

  // Scroll to bottom: instant during streaming, smooth only when a new complete message arrives
  useEffect(() => {
    if (!chatEndRef.current) return;
    chatEndRef.current.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
  }, [chatMessages.length, isStreaming]); // length change = new message; isStreaming flip = stream done

  // If a chatId is in the URL and history is loaded, open that chat automatically
  useEffect(() => {
    if (urlChatId && pastReports.length > 0 && reportId !== urlChatId) {
      loadReportById(urlChatId);
    }
  }, [urlChatId, pastReports]);

  // --- DATA ---
  const groupedHistory = useMemo(() => {
    const groups: Record<string, any[]> = { 'TODAY': [], 'YESTERDAY': [], 'PREVIOUS 7 DAYS': [], 'OLDER': [] };
    const now = new Date();
    const yesterday = new Date(); yesterday.setDate(now.getDate() - 1);
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(now.getDate() - 7);
    pastReports.forEach(r => {
      const d = r.date instanceof Date ? r.date : new Date(r.date);
      if (isNaN(d.getTime())) {
        // Invalid date — put in TODAY as fallback
        groups['TODAY'].push(r);
      } else if (d.toDateString() === now.toDateString()) groups['TODAY'].push(r);
      else if (d.toDateString() === yesterday.toDateString()) groups['YESTERDAY'].push(r);
      else if (d >= sevenDaysAgo) groups['PREVIOUS 7 DAYS'].push(r);
      else groups['OLDER'].push(r);
    });
    return groups;
  }, [pastReports]);

  const toggleConnection = async (appId: string) => {
    if (!user?.uid) return;
    const isConnected = appConnections[appId] || false;
    if (isConnected) {
      if (window.confirm(`Disconnect ${appId}?`)) {
        const connRef = doc(db, "userConnections", user.uid);
        await setDoc(connRef, { [appId]: false }, { merge: true });
      }
    } else {
      const backendUrl = window.location.origin;
      if (['outlook', 'onedrive', 'teams'].includes(appId)) {
        window.location.href = `${backendUrl}/api/auth/microsoft?userId=${user.uid}&type=${appId}`;
      } else {
        window.location.href = `${backendUrl}/api/auth/${appId}?userId=${user.uid}`;
      }
    }
  };

  const connectedCount = Object.values(appConnections).filter(Boolean).length;

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const resetSession = () => {
    // ⚡ Generate a new session ID for the next conversation
    const newSessionId = Math.random().toString(36).substring(2, 11);
    setMediaItems([]);
    setReport(null);
    setReportId(null);
    setSessionId(newSessionId);
    setChatMessages([]);
    setActiveSidebar('none');
    setCurrentView('home');
    sessionStorage.removeItem('rukmer_chat_messages');
    sessionStorage.setItem('rukmer_session_id', newSessionId);
    navigate('/dashboard');
  };

  // ⚡ Handle renaming a chat (persists to DB)
  const handleRenameChat = async (chatId: string, newTitle: string) => {
    setPastReports(prev =>
      prev.map(r =>
        r.id === chatId ? { ...r, title: newTitle } : r
      )
    );
    if (reportId === chatId) {
      setReport((prev: any) => (prev ? { ...prev, title: newTitle } : null));
    }
    try {
      const idToken = await auth.currentUser?.getIdToken();
      await fetch('/api/chat/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ chatId, title: newTitle })
      });
    } catch (err) {
      console.error('Failed to persist rename:', err);
    }
  };

  // ⚡ Handle deleting a chat
  const handleDeleteChat = (chatId: string) => {
    // Remove from history
    setPastReports(prev => prev.filter(r => r.id !== chatId));
    
    // If the deleted chat is currently open, go back to home
    if (reportId === chatId) {
      resetSession();
    }
  };

  const loadReportById = async (id: string | number) => {
    try {
      const idStr = String(id);
      const chatRecord = pastReports.find(r => String(r.id) === idStr);
      if (chatRecord) {
        // Restore session context and switch to chat view immediately
        setSessionId(chatRecord.sessionId);
        sessionStorage.setItem('rukmer_session_id', chatRecord.sessionId);
        setReportId(idStr);
        setReport(chatRecord);
        setActiveSidebar('none');
        navigate(`/dashboard/${idStr}`, { replace: true });
        setCurrentView('chat');

        // 1. Show from in-memory cache instantly if already fetched
        const cached = sessionMessagesCache.current.get(chatRecord.sessionId);
        if (cached && cached.length > 0) {
          setChatMessages(cached);
          return;
        }

        // 2. Show a placeholder immediately so the UI feels responsive
        setChatMessages([{ role: 'assistant', content: '…' }]);

        // 3. Fetch full session messages from the backend
        const idToken = await auth.currentUser?.getIdToken();
        const sessionRes = await fetch(
          `/api/history/session/${encodeURIComponent(chatRecord.sessionId)}`,
          { headers: { 'Authorization': `Bearer ${idToken}` } }
        );
        if (sessionRes.ok) {
          const rows = await sessionRes.json();
          if (rows.length > 0) {
            const allMessages = rows.flatMap((r: any) => [
              { role: 'user', content: r.user_message },
              { role: 'assistant', content: r.ai_reply }
            ]);
            sessionMessagesCache.current.set(chatRecord.sessionId, allMessages);
            setChatMessages(allMessages);
          } else {
            setChatMessages([]);
          }
        } else {
          setChatMessages([]);
        }
      } else {
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
      }
    } catch (error) {
      console.error("Error loading report:", error);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    // Reset input so same file can be re-selected
    e.target.value = '';
    if (mediaItems.length + files.length > 10) return alert('Max 10 files allowed.');

    const readFile = (file: File): Promise<{ id: string; name: string; mimeType: string; type: string; data: string; preview: string }> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // result is "data:<mimeType>;base64,<data>" for readAsDataURL
          const base64 = result.split(',')[1];
          const isImage = file.type.startsWith('image/');
          resolve({
            id: Math.random().toString(36).substr(2, 9),
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            type: isImage ? 'image' : 'document',
            data: base64,
            preview: isImage ? result : '', // only images get a preview URL
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

    const newItems = await Promise.all(files.map(readFile));
    setMediaItems(prev => [...prev, ...newItems]);
    setCurrentView('chat');
  };

  const sendChatMessage = async (overrideMessage: string | null = null) => {
  const msg = overrideMessage || chatInput;
  if (!msg.trim() || chatLoading) return;
  
  // ⚡ Generate a session ID if we don't have one (first message in conversation)
  let currentSessionId = sessionId;
  if (!currentSessionId) {
    currentSessionId = Math.random().toString(36).substring(2, 11);
    setSessionId(currentSessionId);
    sessionStorage.setItem('rukmer_session_id', currentSessionId);
  }
  
  setChatInput('');
  setChatLoading(true);
  setCurrentView('chat');
  
  // Snapshot files to send, then clear the attachment tray
  const attachedFiles = mediaItems.map(item => ({ name: item.name, mimeType: item.mimeType, type: item.type, data: item.data }));
  setMediaItems([]);

  // ⚡ Add ONLY the user message. Assistant message will be added on first chunk.
  setChatMessages(prev => [
    ...prev,
    { role: 'user', content: msg, attachments: attachedFiles.map(f => ({ name: f.name, type: f.type })) }
  ]);

  try {
    const idToken = await auth.currentUser?.getIdToken();
    const response = await fetch(`/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({ userId: user.uid, prompt: msg, sessionId: currentSessionId, files: attachedFiles })
    });

    if (!response.ok || !response.body) {
      throw new Error('Backend failed');
    }

    // Read the streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let aiReply = '';
    let buffer = '';
    let finalChatId = '';
    let finalDate = new Date();
    let hasReceivedFirstChunk = false; // ⚡ Track when AI response starts
    let streamThrottleTimer: ReturnType<typeof setTimeout> | null = null; // throttle to ~5fps

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode the stream chunk and handle potential fragmentation
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || ''; // Keep incomplete chunks in the buffer

      for (const part of parts) {
        if (part.startsWith('data: ')) {
          try {
            const dataStr = part.replace('data: ', '');
            const data = JSON.parse(dataStr);

            if (data.error) {
               aiReply = data.error;
               if (!hasReceivedFirstChunk) {
                 setChatMessages(prev => [...prev, { role: 'assistant', content: aiReply }]);
                 hasReceivedFirstChunk = true;
               }
            } else if (data.text) {
              aiReply += data.text;
              
              // ⚡ First chunk: add message and turn off TypingIndicator
              if (!hasReceivedFirstChunk) {
                setChatMessages(prev => [...prev, { role: 'assistant', content: aiReply }]);
                setChatLoading(false);
                setIsStreaming(true);
                hasReceivedFirstChunk = true;
              } else {
                // ⚡ Throttle UI updates to ~5 fps (every 200ms) to cut CPU dramatically
                if (!streamThrottleTimer) {
                  streamThrottleTimer = setTimeout(() => {
                    const snapshot = aiReply; // capture current value
                    setChatMessages(prev => {
                      const newMsgs = [...prev];
                      newMsgs[newMsgs.length - 1] = { role: 'assistant', content: snapshot };
                      return newMsgs;
                    });
                    streamThrottleTimer = null;
                  }, 200);
                }
              }
            } else if (data.done) {
              // Capture the DB details sent at the very end
              finalChatId = data.chatId;
              if (data.createdAt) finalDate = new Date(data.createdAt);
            }
          } catch (e) {
            console.error("Error parsing stream chunk", e);
          }
        }
      }
    }

    // Cancel any pending throttle timer before final flush
    if (streamThrottleTimer) { clearTimeout(streamThrottleTimer); streamThrottleTimer = null; }

    // Final flush: ensure last streamed content is rendered
    setChatMessages(prev => {
      const newMsgs = [...prev];
      if (newMsgs.length > 0 && newMsgs[newMsgs.length - 1].role === 'assistant') {
        newMsgs[newMsgs.length - 1] = { role: 'assistant', content: aiReply };
      }
      return newMsgs;
    });

    // Flush any remaining data in the buffer after the stream ends
    if (buffer.trim()) {
      const remaining = buffer.trim();
      if (remaining.startsWith('data: ')) {
        try {
          const data = JSON.parse(remaining.replace('data: ', ''));
          if (data.done) {
            finalChatId = data.chatId;
            if (data.createdAt) finalDate = new Date(data.createdAt);
          }
        } catch (e) { /* ignore */ }
      }
    }

    // ⚡ Update history sidebar + keep session messages cache in sync
    setPastReports(prev => {
      const existingIdx = prev.findIndex(r => r.sessionId === currentSessionId);
      if (existingIdx !== -1) {
        // Session exists: update sidebar entry
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          messageCount: (updated[existingIdx].messageCount || 1) + 1,
          date: finalDate
        };
        // Update the in-memory message cache for this session
        const existingCached = sessionMessagesCache.current.get(currentSessionId) || [];
        sessionMessagesCache.current.set(currentSessionId, [
          ...existingCached,
          { role: 'user', content: msg },
          { role: 'assistant', content: aiReply }
        ]);
        return updated;
      } else {
        // New session: add to front of history
        const newId = String(finalChatId || crypto.randomUUID());
        if (!reportId) {
          setReportId(newId);
          navigate(`/dashboard/${newId}`, { replace: true });
        }
        // Prime the cache for this brand-new session
        sessionMessagesCache.current.set(currentSessionId, [
          { role: 'user', content: msg },
          { role: 'assistant', content: aiReply }
        ]);
        return [{
          id: newId,
          sessionId: currentSessionId,
          title: msg.substring(0, 50),
          messageCount: 1,
          date: finalDate
        }, ...prev];
      }
    });

  } catch (err) {
    // ⚡ Only add error message if AI response hasn't started
    if (chatMessages[chatMessages.length - 1]?.role !== 'assistant') {
      setChatMessages(prev => [...prev, { role: 'assistant', content: "Rukmer encountered an issue connecting." }]);
    }
  } finally {
    setChatLoading(false);
    setIsStreaming(false);
  }
};

  // ===================== RENDER =====================
  return (
    <div className="flex overflow-hidden font-[Inter]" style={{ height: '100dvh' }}>

      {/* ──────── NAV RAIL ──────── */}
      <aside
        className="w-[76px] flex flex-col items-center py-5 z-50 shrink-0 m-2 mr-0 rounded-[1.75rem]"
        style={{
          background: 'linear-gradient(180deg, #0f1729 0%, #162042 40%, #1a2654 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center mb-7 border border-white/10 shadow-lg">
          <img src="/hexagon.png" alt="Rukmer" className="w-7 h-7 object-contain" />
        </div>
        <h5 className="text-white font-bold text-sm tracking-tight">Beta</h5>

        <nav className="flex flex-col gap-2.5 w-full px-2.5">
          <GlassRailItem icon={<Home size={20} />} label="Home"
            active={currentView === 'home' && activeSidebar === 'none'}
            onClick={() => { setCurrentView('home'); setActiveSidebar('none'); }} />
          <GlassRailItem icon={<MessageSquare size={20} />} label="Chat"
            active={currentView === 'chat' && activeSidebar === 'none'}
            onClick={() => { setCurrentView('chat'); setActiveSidebar('none'); }} />
          <GlassRailItem icon={<Clock size={20} />} label="History"
            active={activeSidebar === 'history'}
            onClick={() => setActiveSidebar(p => p === 'history' ? 'none' : 'history')} />
          <GlassRailItem icon={<Plug size={20} />} label="Apps"
            active={activeSidebar === 'apps'}
            badge={connectedCount > 0 ? connectedCount : undefined}
            onClick={() => setActiveSidebar(p => p === 'apps' ? 'none' : 'apps')} />
        </nav>

        <div className="mt-auto pb-1 flex flex-col gap-2.5 items-center w-full px-2.5">
          <GlassRailItem icon={<Settings size={20} />} label="Settings"
            onClick={() => navigate('/settings')} />
          <UserDropdown user={user} isPro={isPro} onUpgradeClick={() => setShowPricing(true)} />
        </div>
      </aside>

      {/* ──────── HISTORY DRAWER ──────── */}
      <AnimatePresence>
        {activeSidebar === 'history' && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={spring}
            className="rounded-[1.75rem] m-2 ml-1.5 mr-0 z-40 overflow-hidden flex flex-col"
            style={{
              background: 'linear-gradient(180deg, #0f1729 0%, #162042 40%, #1a2654 100%)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 12px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <ChatHistory
              groupedHistory={groupedHistory}
              activeChatId={reportId}
              onSelectChat={loadReportById}
              onRenameChat={handleRenameChat}
              onDeleteChat={handleDeleteChat}
              onClose={() => setActiveSidebar('none')}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ──────── APPS DRAWER ──────── */}
      <AnimatePresence>
        {activeSidebar === 'apps' && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={spring}
            className="rounded-[1.75rem] m-2 ml-1.5 mr-0 z-40 overflow-hidden flex flex-col"
            style={{
              background: 'linear-gradient(180deg, #0f1729 0%, #162042 40%, #1a2654 100%)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 12px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <div className="p-5 flex justify-between items-center">
              <h2 className="text-white font-bold text-sm tracking-tight">Connections</h2>
              <button onClick={() => setActiveSidebar('none')} className="text-white/40 hover:text-white/80 transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4">
              <div className="space-y-1.5">
                {AVAILABLE_APPS.map((app, i) => {
                  const isConnected = !!appConnections[app.id];
                  return (
                    <motion.button
                      key={app.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ ...springStiff, delay: i * 0.05 }}
                      onClick={() => toggleConnection(app.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-all group ${
                        isConnected
                          ? 'bg-white/10 border border-white/15'
                          : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center overflow-hidden transition-all ${
                        isConnected ? 'bg-white shadow-md' : 'bg-white/10 group-hover:bg-white/15'
                      }`}>
                        <img src={app.icon} alt={app.name} className="w-5 h-5 object-contain" />
                      </div>
                      <span className="text-sm font-semibold text-white/80 group-hover:text-white flex-1 text-left">
                        {app.name}
                      </span>
                      <div className={`w-2.5 h-2.5 rounded-full transition-all ${
                        isConnected
                          ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                          : 'bg-white/15'
                      }`} />
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ──────── MAIN CONTENT ──────── */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden m-2 ml-1.5 rounded-[1.75rem] liquid-glass shadow-inner-glow">

          {/* ======== HOME VIEW ======== */}
          {currentView === 'home' && (
            <div
              key="home"
              className="flex-1 flex flex-col min-h-0"
            >
              <div className="flex-1 overflow-y-auto flex flex-col items-center px-6 pt-10 pb-16">
                <div className="my-auto" />
                <div className="w-full max-w-3xl flex flex-col items-center">
                  {/* Greeting Logo */}
                  <div className="relative flex items-center justify-center mb-6">
                    <div className="absolute w-16 h-16 rounded-3xl bg-gradient-to-br from-violet-500/30 to-cyan-500/20 blur-xl" />
                    <div
                      className="relative w-14 h-14 rounded-3xl flex items-center justify-center border border-violet-400/20"
                      style={{
                        background: 'linear-gradient(135deg, rgba(109,40,217,0.3) 0%, rgba(15,23,41,0.85) 60%, rgba(6,182,212,0.1) 100%)',
                        boxShadow: '0 0 28px rgba(139,92,246,0.3), inset 0 1px 0 rgba(255,255,255,0.07)',
                      }}
                    >
                      <AnimatedLogo state="idle" className="w-9 h-9" />
                    </div>
                  </div>

                  <h1 className="text-3xl md:text-4xl font-extrabold text-gray-800 mb-2 tracking-tight text-center">
                    {getGreeting()}, {displayName.split(' ')[0]}
                  </h1>

                  <p className="text-gray-500 text-base md:text-lg mb-10 font-medium text-center">
                    Your agentic workspace - search across Teams, Outlook & more.
                  </p>

                  {/* Quick-Action Bento Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full mb-8">
                    <QuickActionCard
                      title="Teams Search"
                      description="Find conversations & threads"
                      gradient="from-violet-500/10 to-purple-500/10"
                      borderColor="border-violet-200/50"
                      iconColor="text-violet-500"
                      icon={<MessageSquare size={20} />}
                      onClick={() => sendChatMessage("Search my Teams messages for recent project updates")}
                      delay={0}
                    />
                    <QuickActionCard
                      title="Email Digest"
                      description="Summarize unread emails"
                      gradient="from-blue-500/10 to-cyan-500/10"
                      borderColor="border-blue-200/50"
                      iconColor="text-blue-500"
                      icon={<Search size={20} />}
                      onClick={() => sendChatMessage("Summarize my unread emails from today")}
                      delay={0}
                    />
                    <QuickActionCard
                      title="Web Research"
                      description="Search & synthesize results"
                      gradient="from-gray-500/10 to-slate-500/10"
                      borderColor="border-gray-200/50"
                      iconColor="text-gray-500"
                      icon={<ArrowRight size={20} />}
                      onClick={() => sendChatMessage("Research the latest trends in AI agents for 2026")}
                      delay={0}
                    />
                  </div>

                  <WelcomeState onAction={(prompt) => {
                    setChatInput(prompt);
                  }} />
                </div>
                <div className="my-auto" />
              </div>

              {/* Bottom Input — Home View */}
              <div className="w-full pb-8 pt-4 px-6 md:px-12 shrink-0">
                <div className="max-w-3xl mx-auto">
                  <GlassInput
                    value={chatInput}
                    onChange={setChatInput}
                    onSend={() => sendChatMessage()}
                    loading={chatLoading}
                    placeholder="Ask Rukmer anything…"
                  />
                  <p className="text-[11px] text-gray-400 text-center mt-3">
                    Rukmer can search your connected apps and the web. Responses are AI-generated.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ======== CHAT VIEW ======== */}
          {currentView === 'chat' && (
            <div
              key="chat"
              className="flex-1 flex flex-col h-full"
            >
              {/* Chat Header */}
              <header className="h-14 border-b border-white/20 flex items-center justify-between px-6 shrink-0">
                <div className="flex items-center gap-3">
                  <h3 className="font-bold text-gray-700 text-sm">{report?.projectName || "New Session"}</h3>
                </div>
                <button
                  onClick={resetSession}
                  className="text-gray-400 hover:text-blue-600 px-3 py-1.5 text-sm font-semibold flex items-center gap-2 transition-colors rounded-xl hover:bg-blue-50/50"
                >
                  <Plus size={15} /> New Chat
                </button>
              </header>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                  {(() => {
                    // Pre-compute last assistant index once — O(n) instead of O(n²)
                    let lastAssistantIdx = -1;
                    for (let j = chatMessages.length - 1; j >= 0; j--) {
                      if (chatMessages[j].role === 'assistant') { lastAssistantIdx = j; break; }
                    }
                    const aiState = chatLoading ? 'thinking' : (isStreaming ? 'typing' : 'idle');
                    return chatMessages.map((m, i) => (
                      <div key={i}>
                        <MessageBubble
                          message={m}
                          aiState={aiState}
                          isLastAssistant={i === lastAssistantIdx}
                          isStreaming={isStreaming && i === lastAssistantIdx}
                        />
                      </div>
                    ));
                  })()}
                {chatLoading && <GlassTypingIndicator />}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input Footer */}
              <div className="p-4 border-t border-white/20">
                <div className="max-w-4xl mx-auto flex flex-col gap-2">
                  {mediaItems.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto p-2 rounded-2xl bg-white/30 border border-white/20">
                      {mediaItems.map((item) => (
                        <div key={item.id} className="relative w-14 h-14 rounded-xl overflow-hidden border border-white/30 shrink-0 shadow-sm bg-slate-100 flex items-center justify-center">
                          {item.type === 'image' ? (
                            <img src={item.preview} className="w-full h-full object-cover" alt={item.name} />
                          ) : (
                            <div className="flex flex-col items-center justify-center w-full h-full p-1">
                              <Paperclip size={16} className="text-slate-500" />
                              <span className="text-[8px] text-slate-500 truncate w-full text-center mt-0.5 px-0.5">{item.name.split('.').pop()?.toUpperCase()}</span>
                            </div>
                          )}
                          <button
                            onClick={() => setMediaItems(prev => prev.filter(i => i.id !== item.id))}
                            className="absolute top-0.5 right-0.5 bg-black/40 text-white rounded-full p-0.5 hover:bg-red-500 transition-colors"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <GlassInput
                    value={chatInput}
                    onChange={setChatInput}
                    onSend={() => sendChatMessage()}
                    loading={chatLoading}
                    onAttach={() => fileInputRef.current?.click()}
                    placeholder="Message Rukmer…"
                  />
                </div>
              </div>
            </div>
          )}

        </main>

      <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx" className="hidden" onChange={handleFileUpload} />
      {showPricing && <PricingModal isOpen={showPricing} onClose={() => setShowPricing(false)} onCheckout={() => {}} />}
    </div>
  );
}


// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const GlassRailItem = ({ icon, label, active, badge, onClick }: any) => (
  <button
    onClick={onClick}
    className={`relative flex flex-col items-center justify-center w-[52px] h-[52px] mx-auto gap-1 rounded-2xl transition-all ${
      active
        ? 'bg-white/15 text-white shadow-lg shadow-blue-500/10'
        : 'text-white/50 hover:text-white/90 hover:bg-white/8'
    }`}
  >
    <div className={active ? 'text-white' : 'text-white/60'}>{icon}</div>
    <span className={`text-[9px] font-semibold tracking-wide ${active ? 'text-white' : 'text-white/50'}`}>
      {label}
    </span>
    {badge !== undefined && (
      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-400 text-[8px] font-bold text-white flex items-center justify-center shadow-sm shadow-emerald-400/50">
        {badge}
      </span>
    )}
  </button>
);

const GlassInput = ({ value, onChange, onSend, loading, onAttach, placeholder }: any) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasContent = value.trim().length > 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [value]);

  return (
    <div className="relative flex items-end gap-2 rounded-2xl bg-white/50 backdrop-blur-md border border-white/40 shadow-glass px-3 py-1.5 focus-within:border-violet-300/60 focus-within:shadow-glass-hover transition-all">
      {onAttach && (
        <button onClick={onAttach} className="p-2 mb-0.5 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-white/40 transition-all">
          <Paperclip size={18} />
        </button>
      )}
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none py-2.5 resize-none max-h-[200px] overflow-y-auto custom-scrollbar"
      />
      <button
        onClick={onSend}
        disabled={loading || !hasContent}
        style={{
          background: hasContent
            ? 'linear-gradient(to bottom right, #8b5cf6, #3b82f6)'
            : 'rgba(229, 231, 235, 0.6)',
          color: hasContent ? '#fff' : '#9ca3af',
          boxShadow: hasContent ? '0 4px 6px rgba(139, 92, 246, 0.3)' : 'none',
        }}
        className="p-2.5 mb-0.5 rounded-xl flex items-center justify-center transition-all shrink-0"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
      </button>
    </div>
  );
};

const GlassTypingIndicator = () => (
  <div className="flex justify-start">
    <div className="mr-3 mt-1">
      <AnimatedLogo state="thinking" className="w-8 h-8" />
    </div>
    <div className="bg-white/50 border border-white/30 p-4 rounded-2xl rounded-tl-lg flex items-center gap-3 shadow-glass">
      <Loader2 className="animate-spin text-blue-600" size={16} />
      <span className="text-sm text-gray-500 font-medium">Rukmer is thinking…</span>
    </div>
  </div>
);

const QuickActionCard = ({ title, description, gradient, borderColor, iconColor, icon, onClick }: any) => (
  <button
    onClick={onClick}
    className={`text-left p-5 rounded-[1.75rem] bg-gradient-to-br ${gradient} border ${borderColor} shadow-glass hover:shadow-glass-hover transition-shadow hover:-translate-y-0.5`}
  >
    <div className={`w-10 h-10 rounded-2xl bg-white/60 flex items-center justify-center mb-3 ${iconColor}`}>
      {icon}
    </div>
    <h3 className="font-bold text-gray-800 text-sm mb-1">{title}</h3>
    <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
  </button>
);