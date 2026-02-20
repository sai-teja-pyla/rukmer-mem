import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { sendChatMessage } from '../services/api';

export default function Chat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState(null);

  // Get the current user from Firebase
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        console.warn("User is not authenticated");
      }
    });
    return unsubscribe;
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    if (!user) {
      alert("Please log in first");
      return;
    }

    // Add user message to UI immediately
    const userMsg = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const data = await sendChatMessage({
        userId: user.uid,
        reportId: 'default-report',
        message: input,
        aiResponse: '',
        imageUrl: null
      });
      
      // Add AI reply from backend to UI
      setMessages((prev) => [...prev, { role: 'assistant', content: data.aiResponse || data.reply }]);
      setInput('');
    } catch (error) {
      console.error("Chat Error:", error);
      alert("Failed to reach Rukmer Backend: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="messages-window">
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            {m.content}
          </div>
        ))}
        {isLoading && <p>Rukmer AI is thinking...</p>}
      </div>
      
      <form onSubmit={handleSubmit}>
        <input 
          value={input} 
          onChange={(e) => setInput(e.target.value)} 
          placeholder="Ask Rukmer AI something..."
        />
        <button type="submit" disabled={isLoading}>Send</button>
      </form>
    </div>
  );
}