import React, { useState } from 'react';
import { Header } from './Header';
import { ControlCenterShowcase } from './ControlCenterShowcase';
import { FlowchartsShowcase } from './FlowchartsShowcase';
import { WordEditorShowcase } from './WordEditorShowcase';
import { VoiceDictationShowcase } from './VoiceDictationShowcase';
import { Activity, Database, FileText, Mic, LogOut, ShieldCheck, Building2, User } from 'lucide-react';
import { UserState } from '../types';

interface LiveSystemDashboardProps {
  userState: UserState;
  onLogout: () => void;
}

export const LiveSystemDashboard: React.FC<LiveSystemDashboardProps> = ({
  userState,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<'kpis' | 'flowcharts' | 'word' | 'voice'>('kpis');

  return (
    <div className="min-h-screen bg-[#060a14] text-slate-100 flex flex-col font-sans">

      {/* Aviso permanente (ADR-171): este panel es una demostración pública
          sin autenticación real -- ver HomePage.tsx (userState ficticio) y
          FacialScanModal.tsx (biometría simulada). Ningún dato mostrado
          aquí proviene de un cliente ni de un sensor real. */}
      <div className="bg-amber-950/60 border-b border-amber-700/60 text-amber-300 text-[11px] font-bold text-center py-1.5 uppercase tracking-widest">
        Panel de demostración — plataforma en desarrollo, datos ilustrativos
      </div>

      {/* Top Application Header */}
      <header className="bg-[#0a1120] border-b border-slate-800 px-4 py-3 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-amber-600/20 border border-amber-500/50 flex items-center justify-center font-bold text-amber-400 font-mono text-base">
              B
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-wider text-slate-100 font-mono">
                  BEEMETRY CENTRO MINERO
                </span>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded">
                  EN LÍNEA
                </span>
              </div>
              <p className="text-[10px] text-amber-400 uppercase tracking-widest font-semibold">
                {userState.company} · UNIDAD PRINCIPAL
              </p>
            </div>
          </div>

          {/* Module Navigation Buttons */}
          <nav className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-lg border border-slate-800 text-xs font-bold">
            <button
              onClick={() => setActiveTab('kpis')}
              className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors ${
                activeTab === 'kpis' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>KPIs Live</span>
            </button>

            <button
              onClick={() => setActiveTab('flowcharts')}
              className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors ${
                activeTab === 'flowcharts' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Diagramas Flujo</span>
            </button>

            <button
              onClick={() => setActiveTab('word')}
              className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors ${
                activeTab === 'word' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Word con IA</span>
            </button>

            <button
              onClick={() => setActiveTab('voice')}
              className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors ${
                activeTab === 'voice' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Mic className="w-3.5 h-3.5 text-purple-400" />
              <span>Dictado por Voz</span>
            </button>
          </nav>

          {/* User Profile Info & Logout */}
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-bold text-slate-200">{userState.name}</p>
              <p className="text-[10px] text-slate-400">{userState.role}</p>
            </div>

            <button
              onClick={onLogout}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5 text-amber-400" />
              <span>Salir</span>
            </button>
          </div>

        </div>
      </header>

      {/* Main Tab Workspace */}
      <main className="flex-1">
        {activeTab === 'kpis' && <ControlCenterShowcase onOpenLogin={() => {}} />}
        {activeTab === 'flowcharts' && <FlowchartsShowcase />}
        {activeTab === 'word' && <WordEditorShowcase />}
        {activeTab === 'voice' && <VoiceDictationShowcase />}
      </main>

    </div>
  );
};
