import React from 'react';
import { Cpu, ShieldCheck, Zap, Glasses, Mic, FileText, CheckCircle2, ArrowRight, Layers, Sparkles, Server } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nProvider'

export const CompanyOverviewSection: React.FC = () => {
  const { t } = useI18n();

  return (
    <section className="py-16 bg-[#060a14] border-b border-[#3A3D40]/50 text-[#F5F6F8] relative overflow-hidden">
      {/* Background accents */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-[#F05A28]/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-[#FCD3B0]/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16 relative z-10">
        
        {/* Header Block */}
        <div className="text-center space-y-4 max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[#F05A28]/15 border border-[#F05A28]/40 text-[#FCD3B0] text-xs font-bold uppercase tracking-widest">
            <Cpu className="w-3.5 h-3.5 text-[#F05A28]" />
              {t('company.badge')}
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white font-sans tracking-tight">
            {t('company.title')}
          </h2>
          <p className="text-[#E1E4E8]/80 text-base sm:text-lg leading-relaxed font-normal">
            {t('company.subtitle')}
          </p>
        </div>

        {/* 3 Software Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Pillar 1: Web Systems & High Availability */}
          <div className="bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 text-center space-y-4 relative group hover:border-[#F05A28]/60 transition-all shadow-lg">
            <div className="w-14 h-14 mx-auto rounded-xl bg-[#F05A28]/15 border border-[#F05A28]/40 flex items-center justify-center text-[#F05A28] font-bold font-mono text-xl group-hover:scale-110 transition-transform">
              <Zap className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <span className="text-[10px] font-mono font-bold text-[#FCD3B0] uppercase tracking-widest">
                {t('company.pillar1.num')} ·  {t('company.pillar1.numDesc')}
              </span>
              <h3 className="text-lg font-bold text-white uppercase tracking-wider font-sans">
                {t('company.pillar1.title')}
              </h3>
            </div>
            <p className="text-xs text-[#E1E4E8]/70 leading-relaxed font-sans">
              {t('company.pillar1.desc')}
            </p>
            <div className="pt-3 border-t border-[#3A3D40]/60 flex items-center justify-center gap-1.5 text-[11px] text-[#F05A28] font-mono font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{t('company.pillar1.foot')} &lt;100ms</span>
            </div>
          </div>

          {/* Pillar 2: AI Voice Dictation & Word Reports */}
          <div className="bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 text-center space-y-4 relative group hover:border-[#FCD3B0]/60 transition-all shadow-lg">
            <div className="w-14 h-14 mx-auto rounded-xl bg-[#FCD3B0]/15 border border-[#FCD3B0]/40 flex items-center justify-center text-[#FCD3B0] font-bold font-mono text-xl group-hover:scale-110 transition-transform">
              <Sparkles className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <span className="text-[10px] font-mono font-bold text-[#FCD3B0] uppercase tracking-widest">
                {t('company.pillar2.num')} · {t('company.pillar2.numDesc')}
              </span>
              <h3 className="text-lg font-bold text-white uppercase tracking-wider font-sans">
                {t('company.pillar2.title')}
              </h3>
            </div>
            <p className="text-xs text-[#E1E4E8]/70 leading-relaxed font-sans">
              {t('company.pillar2.desc')}
            </p>
            <div className="pt-3 border-t border-[#3A3D40]/60 flex items-center justify-center gap-1.5 text-[11px] text-[#FCD3B0] font-mono font-semibold">
              <Mic className="w-3.5 h-3.5" />
              <span>{t('company.pillar2.foot')}</span>
            </div>
          </div>

        </div>

        {/* Software Architecture Stack & Lifecycle */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center pt-6">
          
          {/* Left: Software Stack Pyramid */}
          <div className="lg:col-span-6 bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 sm:p-8 space-y-5 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#3A3D40]">
              <span className="text-xs font-bold text-[#F05A28] uppercase tracking-widest font-mono">
                {t('company.arch.title')}
              </span>
              <span className="text-[10px] text-[#FCD3B0] font-mono font-semibold">{t('company.arch.subtitle')}</span>
            </div>

            <div className="space-y-2.5 font-sans">
              {/* Level 1: AI & Mixed Reality */}
              <div className="p-3 bg-gradient-to-r from-[#F05A28] to-[#C85A2B] rounded-xl text-slate-950 shadow-md">
                <p className="text-xs font-extrabold uppercase tracking-wider">{t('company.arch.l1.title')}</p>
                <p className="text-[10px] font-medium opacity-95">{t('company.arch.l1.desc')}</p>
              </div>

              {/* Level 2: Web OS Platform */}
              <div className="p-3 bg-[#141A2A] border border-[#F05A28]/50 rounded-xl">
                <p className="text-xs font-bold text-white uppercase tracking-wider">{t('company.arch.l2.title')}</p>
                <p className="text-[10px] text-[#E1E4E8]/70">{t('company.arch.l2.desc')}</p>
              </div>

              {/* Level 3: API REST & WebSockets */}
              <div className="p-3 bg-[#141A2A]/80 border border-[#3A3D40] rounded-xl">
                <p className="text-xs font-bold text-[#FCD3B0] uppercase tracking-wider">{t('company.arch.l3.title')}</p>
                <p className="text-[10px] text-[#E1E4E8]/60">{t('company.arch.l3.desc')}</p>
              </div>

              {/* Level 4: Cybersecurity ISO 27001 */}
              <div className="p-3 bg-[#141A2A]/60 border border-[#3A3D40]/80 rounded-xl">
                <p className="text-xs font-bold text-[#E1E4E8] uppercase tracking-wider">{t('company.arch.l4.title')}</p>
                <p className="text-[10px] text-[#E1E4E8]/60">{t('company.arch.l4.desc')}</p>
              </div>

              {/* Level 5: High Availability Cloud & Edge */}
              <div className="p-3 bg-[#080C14] border border-[#3A3D40] rounded-xl">
                <p className="text-xs font-bold text-[#B8BCB2] uppercase tracking-wider">{t('company.arch.l5.title')}</p>
                <p className="text-[10px] text-[#E1E4E8]/50">{t('company.arch.l5.desc')}</p>
              </div>
            </div>
          </div>

          {/* Right: Software Development Methodology */}
          <div className="lg:col-span-6 space-y-4">
            <div className="space-y-1">
              <span className="text-xs font-bold text-[#FCD3B0] uppercase tracking-widest font-mono">
                {t('company.method.badge')}
              </span>
              <h3 className="text-2xl font-extrabold text-white">
                {t('company.method.title')}
              </h3>
            </div>

            <div className="space-y-3 text-xs">

              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[#0D121F] border border-[#3A3D40] hover:border-[#F05A28]/50 transition-colors">
                <div className="w-7 h-7 rounded-lg bg-[#F05A28]/20 text-[#F05A28] font-bold font-mono flex items-center justify-center shrink-0 text-sm">
                  1
                </div>
                <div>
                  <p className="font-bold text-white text-sm">{t('company.method.step4.title')}</p>
                  <p className="text-[#E1E4E8]/70 text-[11px] mt-0.5">{t('company.method.step4.desc')}</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[#0D121F] border border-[#3A3D40] hover:border-[#F05A28]/50 transition-colors">
                <div className="w-7 h-7 rounded-lg bg-[#F05A28]/20 text-[#F05A28] font-bold font-mono flex items-center justify-center shrink-0 text-sm">
                  2
                </div>
                <div>
                  <p className="font-bold text-white text-sm">{t('company.method.step5.title')}</p>
                  <p className="text-[#E1E4E8]/70 text-[11px] mt-0.5">{t('company.method.step5.desc')}</p>
                </div>
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
