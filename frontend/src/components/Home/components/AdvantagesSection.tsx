import React from 'react';
import { ShieldCheck, Zap, Cloud, Smartphone, Activity, Check, Server, Lock } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nProvider'

export const AdvantagesSection: React.FC = () => {
  const { t } = useI18n();

  return (
    <section className="py-16 bg-[#080C14] border-b border-[#3A3D40]/60 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        
        {/* Section Header */}
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[#F05A28]/15 border border-[#F05A28]/40 text-[#FCD3B0] text-xs font-bold uppercase tracking-widest">
            <Zap className="w-3.5 h-3.5 text-[#F05A28]" />
            {t('advantages.badge')}
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight font-sans">
            {t('advantages.title')}
          </h2>
          <p className="text-[#E1E4E8]/80 text-sm sm:text-base font-normal">
            {t('advantages.subtitle')}
          </p>
        </div>

        {/* 3 Pillars Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Card 1: Reducción de Caídas & Máxima Velocidad */}
          <div className="bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 space-y-4 hover:border-[#F05A28]/50 transition-all shadow-xl">
            <div className="w-12 h-12 rounded-xl bg-[#F05A28]/15 border border-[#F05A28]/40 flex items-center justify-center text-[#F05A28]">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white font-sans">
              {t('advantages.a1.title')}
            </h3>
            <p className="text-xs text-[#E1E4E8]/80 leading-relaxed font-sans">
              {t('advantages.a1.desc')}
            </p>
            <ul className="space-y-2 text-xs text-slate-300 pt-3 border-t border-[#3A3D40]">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#F05A28]" />
                <span>{t('advantages.a1.point1')}</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#F05A28]" />
                <span>{t('advantages.a1.point2')}</span>
              </li>
            </ul>
          </div>

          {/* Card 2: Ciberseguridad & Protección */}
          <div className="bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 space-y-4 hover:border-[#FCD3B0]/50 transition-all shadow-xl">
            <div className="w-12 h-12 rounded-xl bg-[#FCD3B0]/15 border border-[#FCD3B0]/40 flex items-center justify-center text-[#FCD3B0]">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white font-sans">
              {t('advantages.a2.title')}
            </h3>
            <p className="text-xs text-[#E1E4E8]/80 leading-relaxed font-sans">
              {t('advantages.a2.desc')}
            </p>
            <ul className="space-y-2 text-xs text-slate-300 pt-3 border-t border-[#3A3D40]">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#FCD3B0]" />
                <span>{t('advantages.a2.point1')}</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#FCD3B0]" />
                <span>{t('advantages.a2.point2')}</span>
              </li>
            </ul>
          </div>

          {/* Card 3: Soporte Especializado 24/7 */}
          <div className="bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 space-y-4 hover:border-[#9B3E1B]/70 transition-all shadow-xl">
            <div className="w-12 h-12 rounded-xl bg-[#9B3E1B]/25 border border-[#F05A28]/50 flex items-center justify-center text-[#F05A28]">
              <Server className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white font-sans">
              {t('advantages.a3.title')}
            </h3>
            <p className="text-xs text-[#E1E4E8]/80 leading-relaxed font-sans">
              {t('advantages.a3.desc')}
            </p>
            <ul className="space-y-2 text-xs text-slate-300 pt-3 border-t border-[#3A3D40]">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#F05A28]" />
                <span>{t('advantages.a3.point1')}</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#F05A28]" />
                <span>{t('advantages.a3.point2')}</span>
              </li>
            </ul>
          </div>

        </div>

        {/* Cloud & Mobile Integration Bar */}
        <div className="grid grid-cols-1 gap-6 pt-2">
          
          {/* Cloud Amazon ISO 27001 */}
          <div className="bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#F05A28]/15 border border-[#F05A28]/40 flex items-center justify-center text-[#F05A28] shrink-0">
              <Cloud className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-white">{t('advantages.cloud.title')}</h4>
                <span className="text-[10px] bg-[#F05A28]/20 text-[#FCD3B0] border border-[#F05A28]/50 px-2 py-0.5 rounded font-mono font-bold">
                  ISO 27001
                </span>
              </div>
              <p className="text-xs text-[#E1E4E8]/70 leading-relaxed">
                {t('advantages.cloud.description')}
              </p>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
