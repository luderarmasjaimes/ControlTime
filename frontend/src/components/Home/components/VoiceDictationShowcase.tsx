import React from 'react';
import { Mic, Image as ImageIcon, Sparkles, Cpu } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nProvider'

export const VoiceDictationShowcase: React.FC = () => {
  const { t } = useI18n();
  return (
    <section className="py-16 bg-[#070c18] border-b border-slate-800 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-purple-950/80 border border-purple-700/60 text-purple-400 text-xs font-bold uppercase tracking-widest mb-2">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              {t('voice.brand')}
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white font-sans tracking-tight">
              {t('voice.title')}
            </h2>
            <p className="text-slate-400 text-sm max-w-2xl mt-1">
              {t('voice.desc')}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-purple-300 bg-purple-950/60 px-3 py-1.5 rounded-lg border border-purple-800">
            <Cpu className="w-4 h-4 text-purple-400" />
            <span>{t('voice.box.title')} &lt; 50MS</span>
          </div>
        </div>

        {/* Referential Screenshot Frame Container */}
        <div className="rounded-2xl border border-slate-800 bg-[#0b1322] overflow-hidden shadow-2xl relative group">
          
          {/* Top Window Bar */}
          <div className="bg-[#080d19] px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-slate-700 inline-block"></span>
              <span className="w-3 h-3 rounded-full bg-slate-700 inline-block"></span>
              <span className="w-3 h-3 rounded-full bg-slate-700 inline-block"></span>
              <span className="ml-2 text-xs font-mono text-slate-400">beemetry.os // dictado-voz-ia.png</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-orange-400 font-mono font-bold">
              <Mic className="w-3.5 h-3.5" />
              <span>{t('voice.img.subtitle')}</span>
            </div>
          </div>

          {/* Screenshot Image Display Container */}
          <div className="relative min-h-[420px] lg:min-h-[500px] w-full bg-slate-950 flex items-center justify-center overflow-hidden">
            <img
              src="https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&w=1600&q=80"
              alt="Módulo de Dictado de Voz Inteligente para Mina"
              referrerPolicy="no-referrer"
              className="w-full h-full max-h-[520px] object-cover group-hover:scale-[1.01] transition-transform duration-500 brightness-90"
            />

            {/* HUD Badge Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent p-6 flex flex-col justify-between pointer-events-none">
              <div className="self-end">
                <span className="bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-mono text-purple-400 font-bold">
                  {t('voice.img.brand')}
                </span>
              </div>

              <div className="bg-slate-950/80 backdrop-blur-md p-4 rounded-xl border border-slate-800 max-w-md space-y-1 pointer-events-auto">
                <div className="flex items-center gap-2 text-xs font-bold text-orange-400 uppercase tracking-wider">
                  <ImageIcon className="w-4 h-4" />
                  <span>Espacio Reservado para Captura de Pantalla</span>
                </div>
                <p className="text-xs text-slate-300">
                  Muestra el centro de captura por voz con procesamiento offline y transcripción inmediata para operadores en mina y socavón.
                </p>
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
