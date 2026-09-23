import React from 'react';
import { FileText, Image as ImageIcon, Sparkles } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nProvider'
import ImageWordEditor from '../assets/images/informes.png'

export const WordEditorShowcase: React.FC = () => {
  const { t } = useI18n();
  return (
    <section className="py-16 bg-[#060a14] border-b border-slate-800 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-amber-950/80 border border-amber-700/60 text-amber-400 text-xs font-bold uppercase tracking-widest mb-2">
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              {t('editor.brand')}
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white font-sans tracking-tight">
              {t('editor.title')}
            </h2>
            <p className="text-slate-400 text-sm max-w-2xl mt-1">
              {t('editor.desc')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-mono bg-slate-900 px-3 py-1.5 rounded-md border border-slate-800">
              {t('editor.box.title')} <strong className="text-orange-400">{t('editor.box.desc')}</strong>
            </span>
          </div>
        </div>

        {/* Referential Screenshot Frame Container */}
        <div className="rounded-2xl border border-slate-800 bg-[#070c19] overflow-hidden shadow-2xl relative group">
          
          {/* Top Window Bar */}
          <div className="bg-[#0b1322] px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-slate-700 inline-block"></span>
              <span className="w-3 h-3 rounded-full bg-slate-700 inline-block"></span>
              <span className="w-3 h-3 rounded-full bg-slate-700 inline-block"></span>
              <span className="ml-2 text-xs font-mono text-slate-400">beemetry.os // editor-informes-ia.png</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-orange-400 font-mono font-bold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t('editor.img.subtitle')}</span>
            </div>
          </div>

          {/* Screenshot Image Display Container */}
          <div className="relative min-h-[420px] lg:min-h-[500px] w-full bg-slate-950 flex items-center justify-center overflow-hidden">
            <img
              src={ImageWordEditor}
              alt="Módulo de Generación de Informes Mineros con IA"
              referrerPolicy="no-referrer"
              className="w-full h-full max-h-[520px] object-cover group-hover:scale-[1.01] transition-transform duration-500 brightness-90"
            />

            {/* HUD Badge Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent p-6 flex flex-col justify-between pointer-events-none">
              <div className="self-end">
                <span className="bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-mono text-amber-400 font-bold">
                  {t('editor.img.brand')}
                </span>
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
