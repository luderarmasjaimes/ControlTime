import React from 'react';
import { Cpu, Glasses, Server, ArrowUpRight, Code, ShieldCheck, Sparkles } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nProvider'

export const ServicesSection: React.FC = () => {
  const { t } = useI18n();

  return (
    <section className="py-16 bg-[#060a14] border-b border-[#3A3D40]/60 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        
        {/* Header */}
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[#F05A28]/15 border border-[#F05A28]/40 text-[#FCD3B0] text-xs font-bold uppercase tracking-widest">
            <Cpu className="w-3.5 h-3.5 text-[#F05A28]" />
            {t('services.badge')}
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight font-sans">
            {t('services.title')}
          </h2>
          <p className="text-[#E1E4E8]/80 text-sm sm:text-base">
            {t('services.subtitle')}
          </p>
        </div>

        {/* 3 Categories Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Service Category 1: Desarrollo & Optimización Web */}
          <div className="bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 space-y-4 hover:border-[#F05A28]/60 transition-all flex flex-col justify-between shadow-xl">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-xl bg-[#F05A28]/15 border border-[#F05A28]/40 flex items-center justify-center text-[#F05A28]">
                <Code className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[10px] font-mono text-[#F05A28] uppercase font-bold tracking-widest">
                  {t('services.c1.cat')}
                </span>
                <h3 className="text-lg font-bold text-white font-sans mt-0.5">
                  {t('services.c1.title')}
                </h3>
              </div>
              <ul className="space-y-2.5 text-xs text-[#E1E4E8]/80">
                <li className="flex items-start gap-2">
                  <span className="text-[#F05A28] font-bold">•</span>
                  <span>{t('services.c1.s1')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#F05A28] font-bold">•</span>
                  <span>{t('services.c1.s2')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#F05A28] font-bold">•</span>
                  <span>{t('services.c1.s3')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#F05A28] font-bold">•</span>
                  <span>{t('services.c1.s4')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#F05A28] font-bold">•</span>
                  <span>{t('services.c1.s6')}</span>
                </li>
              </ul>
            </div>
            
            <div className="pt-4 border-t border-[#3A3D40] flex items-center justify-between text-xs font-mono text-[#F05A28]">
              <span>{t('services.c1.s5')}</span>
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>

          {/* Service Category 2: Soporte de IA */}
          <div className="bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 space-y-4 hover:border-[#FCD3B0]/60 transition-all flex flex-col justify-between shadow-xl">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-xl bg-[#FCD3B0]/15 border border-[#FCD3B0]/40 flex items-center justify-center text-[#FCD3B0]">
                <Glasses className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[10px] font-mono text-[#FCD3B0] uppercase font-bold tracking-widest">
                  {t('services.c2.cat')}
                </span>
                <h3 className="text-lg font-bold text-white font-sans mt-0.5">
                  {t('services.c2.title')}
                </h3>
              </div>
              <ul className="space-y-2.5 text-xs text-[#E1E4E8]/80">
                <li className="flex items-start gap-2">
                  <span className="text-[#FCD3B0] font-bold">•</span>
                  <span>{t('services.c2.s2')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#FCD3B0] font-bold">•</span>
                  <span>{t('services.c2.s3')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#FCD3B0] font-bold">•</span>
                  <span>{t('services.c2.s4')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#FCD3B0] font-bold">•</span>
                  <span>{t('services.c2.s5')}</span>
                </li>
              </ul>
            </div>

            <div className="pt-4 border-t border-[#3A3D40] flex items-center justify-between text-xs font-mono text-[#FCD3B0]">
              <span>{t('services.c2.s6')}</span>
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>

          {/* Service Category 3: Mantenimiento & SLAs */}
          <div className="bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 space-y-4 hover:border-[#F05A28]/60 transition-all flex flex-col justify-between shadow-xl">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-xl bg-[#9B3E1B]/30 border border-[#F05A28]/50 flex items-center justify-center text-[#F05A28]">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[10px] font-mono text-[#F05A28] uppercase font-bold tracking-widest">
                  {t('services.c3.cat')}
                </span>
                <h3 className="text-lg font-bold text-white font-sans mt-0.5">
                  {t('services.c3.title')}
                </h3>
              </div>
              <ul className="space-y-2.5 text-xs text-[#E1E4E8]/80">
                <li className="flex items-start gap-2">
                  <span className="text-[#F05A28] font-bold">•</span>
                  <span>{t('services.c3.s1')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#F05A28] font-bold">•</span>
                  <span>{t('services.c3.s2')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#F05A28] font-bold">•</span>
                  <span>{t('services.c3.s3')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#F05A28] font-bold">•</span>
                  <span>{t('services.c3.s4')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#F05A28] font-bold">•</span>
                  <span>{t('services.c3.s5')}</span>
                </li>
              </ul>
            </div>

            <div className="pt-4 border-t border-[#3A3D40] flex items-center justify-between text-xs font-mono text-emerald-400">
              <span>{t('services.c3.s6')}</span>
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
