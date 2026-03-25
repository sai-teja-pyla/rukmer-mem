import React, { useState } from 'react';
import { MessageSquare, X, MoreVertical, Trash2, Edit2 } from 'lucide-react';

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
  onRenameChat?: (id: string, newTitle: string) => void;
  onDeleteChat?: (id: string) => void;
}

export function ChatHistory({
  groupedHistory,
  activeChatId,
  onSelectChat,
  onClose,
  onRenameChat,
  onDeleteChat
}: ChatHistoryProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  
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
                          const isRenaming = renamingId === item.id;
                          
                          return (
                              <div key={item.id} className="relative group">
                                {isRenaming ? (
                                  // Rename Input Field
                                  <div className="flex gap-2 p-2 bg-slate-700/50 rounded-xl">
                                    <input
                                      autoFocus
                                      type="text"
                                      value={renameText}
                                      onChange={(e) => setRenameText(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          if (onRenameChat && renameText.trim()) {
                                            onRenameChat(item.id, renameText);
                                          }
                                          setRenamingId(null);
                                        } else if (e.key === 'Escape') {
                                          setRenamingId(null);
                                        }
                                      }}
                                      onBlur={() => {
                                        if (onRenameChat && renameText.trim()) {
                                          onRenameChat(item.id, renameText);
                                        }
                                        setRenamingId(null);
                                      }}
                                      className="flex-1 bg-slate-600 text-white text-xs px-2 py-1 rounded border border-slate-500 focus:outline-none focus:border-indigo-400"
                                      placeholder="Enter new name..."
                                    />
                                  </div>
                                ) : (
                                  <button 
                                      onClick={() => onSelectChat(item.id)} 
                                      className={`w-full flex items-center gap-3 py-2 px-3 rounded-xl text-sm transition-all text-left group ${
                                          isActive 
                                              ? 'text-indigo-400 bg-indigo-500/10' 
                                              : 'text-slate-300 hover:text-white hover:bg-slate-700/30'
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
                                      <div className="flex-1 min-w-0">
                                        <span className="truncate font-medium block">{item.title}</span>
                                        {item.messageCount && item.messageCount > 1 && (
                                          <span className="text-[10px] text-slate-500">{item.messageCount} messages</span>
                                        )}
                                      </div>
                                      
                                      {/* Three-dot Menu Button */}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenMenuId(openMenuId === item.id ? null : item.id);
                                        }}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-slate-600/50 rounded"
                                      >
                                        <MoreVertical size={14} className="text-slate-400" />
                                      </button>
                                  </button>
                                )}
                                
                                {/* Context Menu */}
                                {openMenuId === item.id && !isRenaming && (
                                  <div className="absolute right-0 top-full mt-1 w-max bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-50">
                                    <button
                                      onClick={() => {
                                        setRenamingId(item.id);
                                        setRenameText(item.title);
                                        setOpenMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:text-white hover:bg-slate-700 transition-colors first:rounded-t-lg"
                                    >
                                      <Edit2 size={12} />
                                      Rename
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (onDeleteChat) {
                                          onDeleteChat(item.id);
                                        }
                                        setOpenMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors last:rounded-b-lg border-t border-slate-700"
                                    >
                                      <Trash2 size={12} />
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                          );
                      })}
                  </div>
              );
          })}
      </div>
    </div>
  );
}