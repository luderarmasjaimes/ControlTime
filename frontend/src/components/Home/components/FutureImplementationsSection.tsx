import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Rocket, Lightbulb, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { FUTURE_IMPLEMENTATIONS, ImplementationItem } from '../data/roadmapData';
import { ImplementationCard } from './roadmap/ImplementationCard';
import { ImplementationDetailModal } from './roadmap/ImplementationDetailModal';
import { useI18n } from '../../../i18n/I18nProvider'

export const FutureImplementationsSection: React.FC = () => {
  const { t } = useI18n();
  const [activeModalItem, setActiveModalItem] = useState<ImplementationItem | null>(null);

  // Proposal form state
  const [isProposing, setIsProposing] = useState(false);
  const [proposalTitle, setProposalTitle] = useState('');
  const [proposalCategory, setProposalCategory] = useState('ia_ml');
  const [proposalDesc, setProposalDesc] = useState('');
  const [proposalSubmitted, setProposalSubmitted] = useState(false);

  // Lock body scroll when proposal modal is open
  useEffect(() => {
    if (isProposing) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isProposing]);

  const handleSubmitProposal = (e: React.FormEvent) => {
    e.preventDefault();
    if (proposalTitle.trim() && proposalDesc.trim()) {
      setProposalSubmitted(true);
      setTimeout(() => {
        setIsProposing(false);
        setProposalSubmitted(false);
        setProposalTitle('');
        setProposalDesc('');
      }, 2500);
    }
  };

  return (
    <div id="futuras-implementaciones" className="py-12 lg:py-16 bg-[#080C14] text-slate-100 min-h-[80vh]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[#F05A28]/15 border border-[#F05A28]/40 text-[#FCD3B0] text-xs font-bold uppercase tracking-widest">
              <Rocket className="w-3.5 h-3.5 text-[#F05A28]" />
              {t('roadmap.badge')}
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-sans">
              {t('roadmap.title')}
            </h2>
            <p className="text-[#E1E4E8]/80 text-sm sm:text-base leading-relaxed">
              {t('roadmap.subtitle')}
            </p>
          </div>

          {/* Action button */}
          <div className="shrink-0">
            <button
              onClick={() => setIsProposing(true)}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#141A2A] hover:bg-[#1A2338] border border-[#F05A28]/50 text-slate-100 hover:text-white text-xs font-bold font-mono transition-all shadow-md active:scale-95"
            >
              <Lightbulb className="w-4 h-4 text-[#F05A28]" />
              <span>{t('roadmap.proposeBtn')}</span>
            </button>
          </div>
        </div>

        {/* Roadmap Cards Grid (Clean layout, all implementations directly accessible) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FUTURE_IMPLEMENTATIONS.map((item) => (
            <ImplementationCard
              key={item.id}
              item={item}
              onSelect={(selected) => setActiveModalItem(selected)}
            />
          ))}
        </div>

        {/* Bottom Banner: Custom Mining Software Development */}
        <div className="bg-gradient-to-r from-[#0D121F] via-[#141A2A] to-[#0D121F] border border-[#F05A28]/40 rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
          <div className="space-y-2 text-left">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs font-mono font-bold text-[#FCD3B0] uppercase">
                {t('roadmap.customBannerBadge')}
              </span>
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-white">
              {t('roadmap.customBannerTitle')}
            </h3>
            <p className="text-xs sm:text-sm text-[#E1E4E8]/80 max-w-2xl">
              {t('roadmap.customBannerSubtitle')}
            </p>
          </div>

          <button
            onClick={() => setIsProposing(true)}
            className="shrink-0 bg-[#F05A28] hover:bg-[#d94d1f] text-slate-950 font-bold text-xs uppercase px-6 py-3.5 rounded-xl shadow-lg shadow-[#F05A28]/25 transition-all active:scale-95 flex items-center gap-2"
          >
            <span>{t('roadmap.customBannerCta')}</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>

      </div>

      {/* Reusable Detail Modal with Portal & Scroll Lock */}
      <ImplementationDetailModal
        item={activeModalItem}
        onClose={() => setActiveModalItem(null)}
      />

      {/* Propose Implementation Modal with Portal & Scroll Lock */}
      {isProposing && createPortal(
        <div 
          onClick={() => setIsProposing(false)}
          className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[#0D121F] border border-[#3A3D40] rounded-2xl p-6 sm:p-8 shadow-2xl space-y-4 text-slate-100 my-auto"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#3A3D40]">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-[#F05A28]" />
                <h3 className="text-lg font-bold text-white">
                  {t('roadmap.proposeModalTitle')}
                </h3>
              </div>
              <button
                onClick={() => setIsProposing(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-[#E1E4E8]/80 leading-relaxed">
              {t('roadmap.proposeModalSubtitle')}
            </p>

            <form onSubmit={handleSubmitProposal} className="space-y-3">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-300 block mb-1">
                  {t('roadmap.formTitleLabel')}
                </label>
                <input
                  type="text"
                  required
                  value={proposalTitle}
                  onChange={(e) => setProposalTitle(e.target.value)}
                  placeholder="Ej. Algoritmo de Predicción de Caída de Rocas en Galería 4"
                  className="w-full bg-[#080C14] border border-[#3A3D40] text-slate-100 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#F05A28]"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-300 block mb-1">
                  {t('roadmap.formCategoryLabel')}
                </label>
                <select
                  value={proposalCategory}
                  onChange={(e) => setProposalCategory(e.target.value)}
                  className="w-full bg-[#080C14] border border-[#3A3D40] text-slate-100 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#F05A28]"
                >
                  <option value="vr_ar">Realidad Mixta 3D / Cascos Inteligentes</option>
                  <option value="automation_iot">Drones / Robótica & Sensores</option>
                  <option value="ia_ml">Inteligencia Artificial & Redes Neuronales</option>
                  <option value="cloud_security">Integración ERP / Nube & Seguridad</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-300 block mb-1">
                  {t('roadmap.formDescLabel')}
                </label>
                <textarea
                  required
                  rows={4}
                  value={proposalDesc}
                  onChange={(e) => setProposalDesc(e.target.value)}
                  placeholder="Describa el objetivo operativo, variables involucradas y valor para la operación minera..."
                  className="w-full bg-[#080C14] border border-[#3A3D40] text-slate-100 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#F05A28]"
                />
              </div>

              {proposalSubmitted && (
                <div className="p-3 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>{t('roadmap.formSuccessMsg')}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsProposing(false)}
                  className="px-4 py-2 rounded-xl bg-[#141A2A] text-slate-300 hover:text-white text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#F05A28] hover:bg-[#d94d1f] text-slate-950 text-xs font-bold uppercase transition-colors"
                >
                  {t('roadmap.submitProposalBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};
