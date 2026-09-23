import React from 'react';
import { ShieldCheck, Activity, Cpu, Sparkles, FileText, ArrowRight, CheckCircle2, Radio, Database, Mic, Glasses } from 'lucide-react';
import heroMiningImage from '../assets/images/hero_mining_site_1786400844500.jpg';
import { useI18n } from '../../../i18n/I18nProvider'

interface HeroSectionProps {
  onOpenLogin: () => void;
  onNavigateSection: (section: string) => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onOpenLogin,
  onNavigateSection,
}) => {
  const { t } = useI18n();

  return (
    <section className="relative overflow-hidden bg-[#080C14] text-slate-100 py-12 lg:py-20 border-b border-[#3A3D40]/60">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[350px] bg-[#F05A28]/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-10 right-10 w-[400px] h-[300px] bg-[#FCD3B0]/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Hero Text Column */}
          <div className="lg:col-span-7 space-y-6 text-left">
            {/* Top Mining Industry Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#F05A28]/15 border border-[#F05A28]/40 rounded-lg text-[#FCD3B0] text-xs font-bold uppercase tracking-widest">
              <span className="w-2 h-2 rounded-full bg-[#F05A28] animate-ping"></span>
              <Cpu className="w-3.5 h-3.5 text-[#F05A28]" />
              <span>{t('hero.badge')}</span>
            </div>

            {/* Main Title */}
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight text-white font-sans">
              {t('hero.title')}<span className="bg-gradient-to-r from-[#F05A28] via-[#FCD3B0] to-white bg-clip-text text-transparent">{t('hero.titleGradient')}</span>
            </h1>

            {/* Description */}
            <p className="text-[#E1E4E8]/80 text-base sm:text-lg leading-relaxed max-w-2xl font-normal font-sans">
              {t('hero.description')}
              <strong className="text-[#FCD3B0] font-semibold">{t('hero.descFlowcharts')}</strong>, {t('hero.descWord') ? '' : ''}
              <strong className="text-[#F05A28] font-semibold">{t('hero.descWord')}</strong>, {t('hero.descVoice') ? '' : ''}
              <strong className="text-[#FCD3B0] font-semibold">{t('hero.descVoice')}</strong>.
            </p>

            {/* Core Capability Pillars */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs font-medium text-slate-300">
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#0D121F] border border-[#3A3D40]">
                <Activity className="w-4 h-4 text-[#F05A28] shrink-0" />
                <span>{t('hero.pillar1')}</span>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#0D121F] border border-[#3A3D40]">
                <Database className="w-4 h-4 text-[#FCD3B0] shrink-0" />
                <span>{t('hero.pillar2')}</span>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#0D121F] border border-[#3A3D40]">
                <FileText className="w-4 h-4 text-[#F05A28] shrink-0" />
                <span>{t('hero.pillar3')}</span>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-wrap items-center gap-4 pt-4">
              <button
                onClick={onOpenLogin}
                className="bg-[#F05A28] hover:bg-[#d94d1f] text-slate-950 px-8 py-3.5 rounded-xl text-sm font-bold tracking-wider uppercase transition-all shadow-lg shadow-[#F05A28]/25 flex items-center gap-2 active:scale-[0.98]"
              >
                <span>{t('hero.ctaAccess')}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Security Compliance badges */}
            <div className="flex flex-wrap items-center gap-6 pt-2 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ISO 27001 & SOC 2 Type II
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Uptime Garantizado 99.99%
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Autenticación Facial Biométrica
              </span>
            </div>
          </div>

          {/* Right Mining Visual Container */}
          <div className="lg:col-span-5 relative">
            <div className="relative rounded-2xl overflow-hidden border border-[#3A3D40] bg-[#0D121F] shadow-2xl shadow-[#F05A28]/10 group">
              <img
                src={heroMiningImage}
                alt="Unidad Minera BEEMETRY"
                referrerPolicy="no-referrer"
                className="w-full h-[420px] object-cover group-hover:scale-105 transition-transform duration-700 brightness-90"
              />

              {/* HUD Telemetry Badges Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#080C14] via-transparent to-[#080C14]/40 p-6 flex flex-col justify-between pointer-events-none">
                {/* Top Badge */}
                <div className="flex items-center justify-between">
                  <div className="bg-[#080C14]/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-[#3A3D40] text-xs font-mono flex items-center gap-2 text-slate-200">
                    <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                    <span>UNIDAD ALPAYANA · SOFTWARE BEEMETRY</span>
                  </div>
                  <div className="bg-emerald-950/90 backdrop-blur-md px-2.5 py-1 rounded text-[11px] font-bold text-emerald-400 border border-emerald-800">
                    ONLINE 99.99%
                  </div>
                </div>

                {/* Floating Telemetry Metric Cards */}
                <div className="space-y-2 pointer-events-auto">
                  <div className="bg-[#080C14]/95 backdrop-blur-md p-3 rounded-xl border border-[#3A3D40] shadow-lg flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                        Dictado por Voz IA
                      </p>
                      <p className="text-lg font-black text-[#FCD3B0] font-mono">
                        99.4% <span className="text-xs font-normal text-slate-300">Precisión Tecnológica</span>
                      </p>
                    </div>
                    <div className="px-2 py-1 bg-emerald-950/80 border border-emerald-800 text-[10px] font-bold text-emerald-300 rounded">
                      OFFLINE EDGE
                    </div>
                  </div>

                  <div className="bg-[#080C14]/95 backdrop-blur-md p-3 rounded-xl border border-[#3A3D40] shadow-lg flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                        Respuesta Servidor Web
                      </p>
                      <p className="text-lg font-black text-emerald-400 font-mono">
                        20ms <span className="text-xs font-normal text-slate-300">Sin Latencia</span>
                      </p>
                    </div>
                    <button
                      onClick={() => onNavigateSection('kpis')}
                      className="px-2.5 py-1 bg-[#F05A28] hover:bg-[#d94d1f] text-[10px] font-bold text-slate-950 rounded shadow transition-colors"
                    >
                      VER DETALLE
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Real-time Mining Stats Strip */}
        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 p-2">
          <div className="p-4 border-l-2 border-[#F05A28] bg-[#0D121F] rounded-r-xl border-t border-b border-r border-[#3A3D40]">
            <p className="text-2xl sm:text-3xl font-black text-white font-mono">+45</p>
            <p className="text-xs text-[#E1E4E8]/70 uppercase tracking-wider font-bold mt-1">{t('hero.statMining')}</p>
          </div>
          <div className="p-4 border-l-2 border-[#FCD3B0] bg-[#0D121F] rounded-r-xl border-t border-b border-r border-[#3A3D40]">
            <p className="text-2xl sm:text-3xl font-black text-white font-mono">99.99%</p>
            <p className="text-xs text-[#E1E4E8]/70 uppercase tracking-wider font-bold mt-1">{t('hero.statPlatform')}</p>
          </div>
          <div className="p-4 border-l-2 border-emerald-500 bg-[#0D121F] rounded-r-xl border-t border-b border-r border-[#3A3D40]">
            <p className="text-2xl sm:text-3xl font-black text-white font-mono">100%</p>
            <p className="text-xs text-[#E1E4E8]/70 uppercase tracking-wider font-bold mt-1">{t('hero.voiceOfline')}</p>
          </div>
          <div className="p-4 border-l-2 border-[#F05A28] bg-[#0D121F] rounded-r-xl border-t border-b border-r border-[#3A3D40]">
            <p className="text-2xl sm:text-3xl font-black text-white font-mono">20ms</p>
            <p className="text-xs text-[#E1E4E8]/70 uppercase tracking-wider font-bold mt-1">{t('hero.lattency')}</p>
          </div>
        </div>

      </div>
    </section>
  );
};
