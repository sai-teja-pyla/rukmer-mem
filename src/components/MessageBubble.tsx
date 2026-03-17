import React from 'react';
import ReactMarkdown from 'react-markdown';

// Define the shape of our message data
export interface ChatMessage {
    role: 'user' | 'assistant' | 'model';
    content: string;
    image?: string;
    gallery?: any[];
}

interface MessageBubbleProps {
    message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === 'user';

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 mb-4`}>
            
            {/* Assistant Avatar */}
            {!isUser && (
                <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mr-4 mt-1 shadow-sm">
                    <span className="text-white text-xs font-bold font-mono">R</span>
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

                {/*Use ReactMarkdown here instead of a plain div */}
                <div className="prose prose-sm max-w-none prose-slate">
                    <ReactMarkdown>
                        {message.content}
                    </ReactMarkdown>
                </div>
            </div>
        </div>
    );
}