import React, { useRef, useEffect } from 'react';
import { Send, Loader2, PlusCircle } from 'lucide-react';

interface ChatInputProps {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    loading?: boolean;
    onAttach?: () => void;
    placeholder?: string;
    showDisclaimer?: boolean;
}

export function ChatInput({
    value,
    onChange,
    onSend,
    loading = false,
    onAttach,
    placeholder = "Message Rukmer AI...",
    showDisclaimer = false
}: ChatInputProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea as content grows (max ~5 lines)
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }, [value]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Enter sends; Shift+Enter falls through to insert newline
            if (!loading && value.trim()) {
                onSend();
            }
        }
    };

    return (
        <div className="w-full">
            <div className="relative flex items-end gap-2 bg-white border border-slate-200 rounded-2xl shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-50 transition-all p-2">
                
                {/* Optional Attachment Button */}
                {onAttach && (
                    <button 
                        onClick={onAttach} 
                        className="p-2 text-slate-400 hover:text-indigo-600 transition-colors self-end mb-0.5 shrink-0"
                        title="Upload file"
                    >
                        <PlusCircle size={22} />
                    </button>
                )}

                {/* Multiline Textarea — Shift+Enter = new line, Enter = send */}
                <textarea
                    ref={textareaRef}
                    rows={1}
                    className="w-full py-2.5 pl-3 pr-1 outline-none text-slate-700 bg-transparent font-medium resize-none leading-relaxed"
                    style={{ maxHeight: '160px', overflowY: 'auto' }}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                />

                {/* Send Button — solid indigo */}
                <button 
                    disabled={loading || !value.trim()} 
                    onClick={onSend} 
                    className="self-end mb-0.5 p-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shrink-0"
                >
                    {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
            </div>

            {/* AI Disclaimer */}
            {showDisclaimer && (
                <p className="text-center text-xs text-slate-400 mt-4 font-medium">
                    Rukmer AI can make mistakes. Consider verifying important information.
                </p>
            )}
        </div>
    );
}