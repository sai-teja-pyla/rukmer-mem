import React from 'react';
import { Send, Loader2, PlusCircle } from 'lucide-react';

interface ChatInputProps {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    loading?: boolean;
    onAttach?: () => void; // If provided, the Plus icon will show
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
    
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Prevents a new line if you ever switch to a textarea
            if (!loading && value.trim()) {
                onSend();
            }
        }
    };

    return (
        <div className="w-full">
            <div className="relative flex items-center bg-white border border-slate-200 rounded-full shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-50 transition-all p-1.5">
                
                {/* Optional Attachment Button */}
                {onAttach && (
                    <button 
                        onClick={onAttach} 
                        className="p-3 text-slate-400 hover:text-indigo-600 transition-colors ml-1"
                        title="Upload file"
                    >
                        <PlusCircle size={22} />
                    </button>
                )}

                {/* Main Input Field */}
                <input 
                    className={`w-full py-3.5 outline-none text-slate-700 bg-transparent font-medium ${onAttach ? 'px-2' : 'pl-5 pr-14'}`} 
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                />

                {/* Send Button */}
                <button 
                    disabled={loading || !value.trim()} 
                    onClick={onSend} 
                    className={`p-2.5 bg-slate-50 text-slate-400 rounded-full hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50 transition-all ${!onAttach ? 'absolute right-2' : 'mr-1'}`}
                >
                    {loading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
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