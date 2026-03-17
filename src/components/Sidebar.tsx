import React from 'react'
import { Chat } from '../types'
import { MessageSquare } from 'lucide-react'

interface ChatHistoryProps {
  chats: Chat[]
  activeChatId: string | null
  onSelectChat: (id: string) => void
}

export function ChatHistory({ chats, activeChatId, onSelectChat }: ChatHistoryProps) {
  // Groups chats by their dateGroup property (Today, Yesterday, etc.)
  const groupedChats = chats.reduce((acc, chat) => {
    const group = chat.dateGroup || 'Previous 7 Days'
    if (!acc[group]) acc[group] = []
    acc[group].push(chat)
    return acc
  }, {} as Record<string, Chat[]>)

  const groups = ['Today', 'Yesterday', 'Previous 7 Days']

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const groupChats = groupedChats[group]
        if (!groupChats || groupChats.length === 0) return null

        return (
          <div key={group}>
            <h3 className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {group}
            </h3>
            <ul className="space-y-0.5 px-2">
              {groupChats.map((chat) => {
                const isActive = activeChatId === chat.id
                return (
                  <li key={chat.id}>
                    <button
                      onClick={() => onSelectChat(chat.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                        isActive 
                          ? 'bg-indigo-500/10 text-indigo-400' 
                          : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                      }`}
                    >
                      <MessageSquare
                        className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-500'}`}
                      />
                      <span className="text-sm truncate">{chat.projectName || chat.title}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}