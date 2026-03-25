import { useState, useEffect, useRef, useCallback } from 'react';
import { auth } from '../firebase';
import { sendChatMessage } from '../services/api';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { TypingIndicator } from './TypingIndicator';


export default function Chat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingRequestRef = useRef<boolean>(false); // ⚡ Debounce requests
  const messageQueueRef = useRef<string>(''); // ⚡ Temp storage for streaming

  // Get the current user from Firebase
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser: any) => {
      setUser(currentUser);
      if (!currentUser) {
        console.warn("User is not authenticated");
      }
    });
    return unsubscribe;
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const handleSendMessage = useCallback(async () => {
    if (!input.trim()) return;
    if (!user) {
      alert("Please log in first");
      return;
    }

    // ⚡ Debounce: Prevent duplicate requests
    if (pendingRequestRef.current) {
      console.warn("⏳ Request already in flight, ignoring duplicate");
      return;
    }

    // Add user message to UI immediately
    const userMsg = { 
      id: Math.random().toString(36).substr(2, 9), 
      text: input, 
      sender: 'user' as const, 
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    };
    setMessages((prev: any[]) => [...prev, userMsg]);
    const currentInput = input;
    setInput('');
    setIsLoading(true);
    pendingRequestRef.current = true;
    messageQueueRef.current = '';

    try {
      const data = await sendChatMessage({
        userId: user.uid,
        reportId: 'default-report',
        message: currentInput,
        aiResponse: '',
        imageUrl: null
      });
      
      // ✅ Add AI reply from backend to UI
      const aiMsg = { 
        id: Math.random().toString(36).substr(2, 9), 
        text: data.aiResponse || data.reply || messageQueueRef.current, 
        sender: 'bot' as const, 
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      };
      setMessages((prev: any[]) => [...prev, aiMsg]);
    } catch (error: any) {
      console.error("Chat Error:", error);
      const errorMsg = error?.message || 'Unknown error';
      alert("Failed to reach Rukmer Backend: " + errorMsg);
      
      // Remove the user message if the request failed
      setMessages((prev: any[]) => prev.filter(m => m.id !== userMsg.id));
    } finally {
      setIsLoading(false);
      pendingRequestRef.current = false;
    }
  }, [input, user]);

  // Handle Enter key in chat input
  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage, isLoading]);

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Messages Header */}
      <div className="p-4 border-b border-slate-100 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          Rukmer Intelligence Agent
        </h2>
      </div>

      {/* Messages Window */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 custom-scrollbar">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && !isLoading && (
            <div className="text-center text-slate-400 py-12">
              <p className="text-lg">Start a conversation with Rukmer</p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble 
              key={m.id} 
              message={m}
            />
          ))}
          {isLoading && <TypingIndicator />}
          <div ref={scrollRef} className="h-0" />
        </div>
      </div>
      
      {/* Input Area */}
      <div className="p-4 bg-white border-t border-slate-100">
        <div className="max-w-3xl mx-auto">
          <ChatInput 
            value={input}
            onChange={setInput}
            onSend={handleSendMessage}
            loading={isLoading}
            onKeyPress={handleKeyPress}
          />
        </div>
      </div>
    </div>
  );
}