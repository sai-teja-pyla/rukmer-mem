import React from 'react'
import { AppConnection } from '../types'
import { Plug } from 'lucide-react'

interface AppConnectionsProps {
  connections: AppConnection[]
}

export function AppConnections({ connections }: AppConnectionsProps) {
  return (
    <div>
      <h3 className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
        Connected Apps
      </h3>
      <ul className="space-y-0.5 px-2">
        {connections.map((app) => (
          <li
            key={app.id}
            className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-slate-900 transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center text-slate-400 group-hover:text-indigo-400 transition-colors">
                <Plug className="w-3.5 h-3.5" />
              </div>
              <span className="text-sm text-slate-300 group-hover:text-slate-100 transition-colors">
                {app.name}
              </span>
            </div>
            <div className={`w-2 h-2 rounded-full ${app.status === 'connected' ? 'bg-emerald-500' : 'bg-slate-700'}`} />
          </li>
        ))}
      </ul>
    </div>
  )
}