import { useState, useEffect, useRef } from 'react';
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

  const handleSendMessage = async () => {
    if (!input.trim()) return;
    if (!user) {
      alert("Please log in first");
      return;
    }

    // Add user message to UI immediately with ID
    const userMsg = { id: Math.random().toString(36).substr(2, 9), text: input, sender: 'user' as const, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    setMessages((prev: any[]) => [...prev, userMsg]);
    setIsLoading(true);
    setInput(''); // Clear input after sending

    try {
      const data = await sendChatMessage({
        userId: user.uid,
        reportId: 'default-report',
        message: input,
        aiResponse: '',
        imageUrl: null
      });
      
      // Add AI reply from backend to UI with ID
      const aiMsg = { id: Math.random().toString(36).substr(2, 9), text: data.aiResponse || data.reply, sender: 'bot' as const, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
      setMessages((prev: any[]) => [...prev, aiMsg]);
    } catch (error: any) {
      console.error("Chat Error:", error);
      alert("Failed to reach Rukmer Backend: " + (error?.message || 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

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
          />
        </div>
      </div>
    </div>
  );
}