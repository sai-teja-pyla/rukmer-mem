import React from 'react';
import { MessageSquare, X } from 'lucide-react';

interface HistoryItem {
  id: string;
  title: string;
  [key: string]: any; // Allows for additional Firebase fields
}

interface ChatHistoryProps {
  groupedHistory: Record<string, HistoryItem[]>;
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onClose: () => void;
}

export function ChatHistory({
  groupedHistory,
  activeChatId,
  onSelectChat,
  onClose
}: ChatHistoryProps) {
  
  return (
    <div className="w-[280px] bg-[#0B1120] border-r border-slate-800/80 flex flex-col z-40 animate-in slide-in-from-left duration-200 shadow-2xl h-full">
      {/* Header */}
      <div className="p-5 flex justify-between items-center shrink-0">
          <h2 className="text-white font-bold text-base">Chat History</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
              <X size={18} />
          </button>
      </div>

      {/* Scrollable List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 mt-2 pb-6">
          {Object.entries(groupedHistory).map(([group, items]) => {
              // Hide the group entirely if it has no history items
              if (!items || items.length === 0) return null;

              return (
                  <div key={group} className="space-y-2 mb-6">
                      {/* Date Group Header (e.g., "TODAY") */}
                      <h3 className="text-[11px] font-bold text-slate-500 tracking-wider mb-2">
                          {group}
                      </h3>
                      
                      {/* History Items */}
                      {items.map((item) => {
                          const isActive = activeChatId === item.id;
                          
                          return (
                              <button 
                                  key={item.id} 
                                  onClick={() => onSelectChat(item.id)} 
                                  className={`w-full flex items-center gap-3 py-2 rounded-xl text-sm transition-all text-left group ${
                                      isActive 
                                          ? 'text-indigo-400 bg-indigo-500/10 px-3 -mx-3' // Highlight active chat
                                          : 'text-slate-300 hover:text-white'
                                  }`}
                              >
                                  <MessageSquare 
                                      size={16} 
                                      className={`shrink-0 ${
                                          isActive 
                                              ? 'text-indigo-400' 
                                              : 'text-slate-500 group-hover:text-slate-400'
                                      }`} 
                                  />
                                  <span className="truncate pr-2 font-medium">{item.title}</span>
                              </button>
                          );
                      })}
                  </div>
              );
          })}
      </div>
    </div>
  );
}