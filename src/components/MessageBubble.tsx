import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Paperclip } from 'lucide-react';
import { AnimatedLogo, AIState } from './AnimatedLogo';

// Define the shape of our message data
export interface ChatMessage {
    role: 'user' | 'assistant' | 'model';
    content: string;
    image?: string;
    gallery?: any[];
    attachments?: Array<{ name: string; type: string }>;
}

interface MessageBubbleProps {
    message: ChatMessage;
    aiState?: AIState;
    isLastAssistant?: boolean;
    isStreaming?: boolean;
}

export const MessageBubble = React.memo(function MessageBubble({ message, aiState = 'idle', isLastAssistant = false, isStreaming = false }: MessageBubbleProps) {
    const isUser = message.role === 'user';
    // Only animate the last assistant message; others stay idle
    const logoState = (!isUser && isLastAssistant) ? aiState : 'idle';

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 mb-4`}>
            
            {/* Assistant Avatar — Animated Logo */}
            {!isUser && (
                <div className="mr-3 mt-1">
                    <AnimatedLogo state={logoState} className="w-8 h-8" />
                </div>
            )}
            
            {/* The Message Bubble */}
            <div className={`max-w-[75%] p-4 rounded-2xl text-[15px] leading-relaxed shadow-sm ${
                isUser 
                    ? 'bg-slate-100 text-slate-800 rounded-tr-sm' 
                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
            }`}>
                
                {/* Gallery & Image Rendering remains the same... */}
                {message.gallery && message.gallery.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                        {message.gallery.map((asset: any, idx: number) => (
                            <img 
                                key={idx} 
                                src={asset.url} 
                                alt="asset" 
                                className="w-full aspect-square object-cover rounded-xl border border-slate-200 cursor-pointer" 
                                onClick={() => window.open(asset.url, '_blank')} 
                            />
                        ))}
                    </div>
                )}

                {message.image && !message.gallery && (
                    <img 
                        src={message.image} 
                        alt="Content" 
                        className="w-full max-w-sm rounded-xl mb-4 border border-slate-200 cursor-pointer" 
                        onClick={() => window.open(message.image, '_blank')} 
                    />
                )}

                {/* Attachments badge */}
                {message.attachments && message.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                        {message.attachments.map((att, i) => (
                            <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                                <Paperclip size={10} />{att.name}
                            </span>
                        ))}
                    </div>
                )}
                <div className="prose prose-sm max-w-none prose-slate">
                    {/* During streaming, render plain text to avoid ReactMarkdown re-parsing ~5x/sec */}
                    {isStreaming ? (
                        <p style={{ whiteSpace: 'pre-wrap' }}>{message.content}</p>
                    ) : (
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                    )}
                </div>
            </div>
        </div>
    );
});