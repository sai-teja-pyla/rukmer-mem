import React from 'react';
import { Plug, BarChart2, FileText, HelpCircle } from 'lucide-react';

interface WelcomeStateProps {
    onAction: (prompt: string) => void;
}

export function WelcomeState({ onAction }: WelcomeStateProps) {
    const cards = [
        { 
            icon: <Plug size={22} className="text-indigo-500" />, 
            title: "Connect a new app", 
            prompt: "Integrate Salesforce, Slack, or Jira", 
            color: "text-indigo-500 bg-indigo-50" 
        },
        { 
            icon: <BarChart2 size={22} className="text-emerald-500" />, 
            title: "Analyze my sales data", 
            prompt: "Get insights on Q3 performance", 
            color: "text-emerald-500 bg-emerald-50" 
        },
        { 
            icon: <FileText size={22} className="text-amber-500" />, 
            title: "Generate a report", 
            prompt: "Create a weekly summary report", 
            color: "text-amber-500 bg-amber-50" 
        },
        { 
            icon: <HelpCircle size={22} className="text-rose-500" />, 
            title: "Help with integrations", 
            prompt: "Troubleshoot sync issues", 
            color: "text-rose-500 bg-rose-50" 
        }
    ];
    
    return (
        <div className="grid grid-cols-2 gap-4 w-full">
            {cards.map((card, i) => (
                <div 
                    key={i} 
                    onClick={() => onAction(card.title)} 
                    className="p-6 bg-white border border-slate-200 rounded-2xl hover:border-indigo-400 hover:shadow-md cursor-pointer transition-all group flex flex-col items-start text-left"
                >
                    <div className={`w-12 h-12 rounded-xl ${card.color} flex items-center justify-center mb-4 transition-colors`}>
                        {card.icon}
                    </div>
                    <h3 className="font-bold text-slate-800 text-lg mb-1">{card.title}</h3>
                    <p className="text-sm text-slate-500">{card.prompt}</p>
                </div>
            ))}
        </div>
    );
}