import React, { useState } from 'react';
import { Glasses, Mic, FileText, ShieldCheck, Cpu, CheckCircle, Sparkles, Layers, ArrowRight, Zap } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nProvider'

export const SoftwareModulesSection: React.FC = () => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'all' | 'helmet' | 'voice' | 'reports' | 'cloud'>('all');

  return (
    <section id="software-modules" className="py-16 bg-[#060a14] border-b border-[#3A3D40]/50 text-[#F5F6F8]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        
        {/* Header */}
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[#F05A28]/15 border border-[#F05A28]/40 text-[#FCD3B0] text-xs font-bold uppercase tracking-widest">
            <Cpu className="w-3.5 h-3.5 text-[#F05A28]" />
            {t('swModules.badge')}
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight font-sans">
            {t('swModules.title')}
          </h2>
          <p className="text-[#E1E4E8]/80 text-sm sm:text-base">
            {t('swModules.subtitle')}
          </p>
        </div>

        {/* Tab Buttons Navigation */}
        <div className="flex flex-wrap items-center justify-center gap-2.5 border-b border-[#3A3D40]/60 pb-5">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'all'
                ? 'bg-[#F05A28] text-slate-950 font-extrabold shadow-lg shadow-[#F05A28]/25 scale-105'
                : 'bg-[#0D121F] text-[#E1E4E8]/80 hover:text-white border border-[#3A3D40]'
            }`}
          >
            {t('swModules.tab.all')}
          </button>
          <button
            onClick={() => setActiveTab('voice')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'voice'
                ? 'bg-[#F05A28] text-slate-950 font-extrabold shadow-lg shadow-[#F05A28]/25 scale-105'
                : 'bg-[#0D121F] text-[#E1E4E8]/80 hover:text-white border border-[#3A3D40]'
            }`}
          >
            <Mic className="w-4 h-4 text-[#FCD3B0]" />
            <span>{t('swModules.tab.voice')}</span>
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'reports'
                ? 'bg-[#F05A28] text-slate-950 font-extrabold shadow-lg shadow-[#F05A28]/25 scale-105'
                : 'bg-[#0D121F] text-[#E1E4E8]/80 hover:text-white border border-[#3A3D40]'
            }`}
          >
            <FileText className="w-4 h-4 text-[#FCD3B0]" />
            <span>{t('swModules.tab.reports')}</span>
          </button>
          <button
            onClick={() => setActiveTab('cloud')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'cloud'
                ? 'bg-[#F05A28] text-slate-950 font-extrabold shadow-lg shadow-[#F05A28]/25 scale-105'
                : 'bg-[#0D121F] text-[#E1E4E8]/80 hover:text-white border border-[#3A3D40]'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-[#FCD3B0]" />
            <span>{t('swModules.tab.cloud')}</span>
          </button>
        </div>

        {/* Modules Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fadeIn">

          {/* Card 1: Dictado por Voz IA */}
          {(activeTab === 'all' || activeTab === 'voice') && (
            <div className="bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 space-y-4 hover:border-[#FCD3B0]/60 transition-all shadow-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#FCD3B0]/10 rounded-bl-full pointer-events-none group-hover:bg-[#FCD3B0]/20 transition-all" />
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold text-[#FCD3B0] uppercase tracking-widest px-2.5 py-1 rounded bg-[#FCD3B0]/15 border border-[#FCD3B0]/30">
                  {t('swModules.voice.category')}
                </span>
                <Mic className="w-6 h-6 text-[#F05A28]" />
              </div>
              <h3 className="text-xl font-extrabold text-white">
                {t('swModules.voice.title')}
              </h3>
              <p className="text-xs text-[#E1E4E8]/80 leading-relaxed font-sans">
                {t('swModules.voice.desc')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 text-xs font-medium">
                <div className="flex items-center gap-2 text-slate-200">
                  <CheckCircle className="w-4 h-4 text-[#FCD3B0] shrink-0" />
                  <span>{t('swModules.voice.f1')}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-200">
                  <CheckCircle className="w-4 h-4 text-[#FCD3B0] shrink-0" />
                  <span>{t('swModules.voice.f2')}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-200">
                  <CheckCircle className="w-4 h-4 text-[#FCD3B0] shrink-0" />
                  <span>{t('swModules.voice.f3')}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-200">
                  <CheckCircle className="w-4 h-4 text-[#FCD3B0] shrink-0" />
                  <span>{t('swModules.voice.f4')}</span>
                </div>
              </div>
            </div>
          )}

          {/* Card 2: Informes Word IA */}
          {(activeTab === 'all' || activeTab === 'reports') && (
            <div className="bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 space-y-4 hover:border-[#F05A28]/60 transition-all shadow-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#F05A28]/10 rounded-bl-full pointer-events-none group-hover:bg-[#F05A28]/20 transition-all" />
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold text-[#F05A28] uppercase tracking-widest px-2.5 py-1 rounded bg-[#F05A28]/15 border border-[#F05A28]/30">
                  {t('swModules.reports.category')}
                </span>
                <FileText className="w-6 h-6 text-[#FCD3B0]" />
              </div>
              <h3 className="text-xl font-extrabold text-white">
                {t('swModules.reports.title')}
              </h3>
              <p className="text-xs text-[#E1E4E8]/80 leading-relaxed font-sans">
                {t('swModules.reports.desc')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 text-xs font-medium">
                <div className="flex items-center gap-2 text-slate-200">
                  <CheckCircle className="w-4 h-4 text-[#F05A28] shrink-0" />
                  <span>{t('swModules.reports.f2')}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-200">
                  <CheckCircle className="w-4 h-4 text-[#F05A28] shrink-0" />
                  <span>{t('swModules.reports.f3')}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-200">
                  <CheckCircle className="w-4 h-4 text-[#F05A28] shrink-0" />
                  <span>{t('swModules.reports.f4')}</span>
                </div>
              </div>
            </div>
          )}

          {/* Card 3: Seguridad & High Availability Cloud */}
          {(activeTab === 'all' || activeTab === 'cloud') && (
            <div className="bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 space-y-4 hover:border-[#FCD3B0]/60 transition-all shadow-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#9B3E1B]/20 rounded-bl-full pointer-events-none group-hover:bg-[#9B3E1B]/30 transition-all" />
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold text-[#FCD3B0] uppercase tracking-widest px-2.5 py-1 rounded bg-[#FCD3B0]/15 border border-[#FCD3B0]/30">
                  {t('swModules.cloud.category')}
                </span>
                <ShieldCheck className="w-6 h-6 text-[#F05A28]" />
              </div>
              <h3 className="text-xl font-extrabold text-white">
                {t('swModules.cloud.title')}
              </h3>
              <p className="text-xs text-[#E1E4E8]/80 leading-relaxed font-sans">
                {t('swModules.cloud.desc')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 text-xs font-medium">
                <div className="flex items-center gap-2 text-slate-200">
                  <CheckCircle className="w-4 h-4 text-[#FCD3B0] shrink-0" />
                  <span>{t('swModules.cloud.f1')}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-200">
                  <CheckCircle className="w-4 h-4 text-[#FCD3B0] shrink-0" />
                  <span>{t('swModules.cloud.f2')}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-200">
                  <CheckCircle className="w-4 h-4 text-[#FCD3B0] shrink-0" />
                  <span>{t('swModules.cloud.f3')}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-200">
                  <CheckCircle className="w-4 h-4 text-[#FCD3B0] shrink-0" />
                  <span>{t('swModules.cloud.f4')}</span>
                </div>
              </div>
            </div>
          )}

        </div>

      </div>
    </section>
  );
};
