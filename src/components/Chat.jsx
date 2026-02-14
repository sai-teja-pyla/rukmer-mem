import { useState } from 'react';
import { sendChatMessage } from '../services/api';

export default function Chat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Add user message to UI immediately
    const userMsg = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const data = await sendChatMessage(input);
      
      // Add AI reply from backend to UI
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      setInput('');
    } catch (error) {
      console.error("Chat Error:", error);
      alert("Failed to reach Rukmer Backend");
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