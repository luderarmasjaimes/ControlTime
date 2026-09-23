import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, Cpu, Sparkles, Layers, ThumbsUp, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react';
import { ImplementationItem } from '../../data/roadmapData';
import { useI18n } from '../../../../i18n/I18nProvider'

interface ImplementationDetailModalProps {
  item: ImplementationItem | null;
  onClose: () => void;
}

export const ImplementationDetailModal: React.FC<ImplementationDetailModalProps> = ({ item, onClose }) => {
  const { t } = useI18n();
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [upvotes, setUpvotes] = useState(128);
  const [hasUpvoted, setHasUpvoted] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [commentText, setCommentText] = useState('');

  // Lock body scrolling when modal is active
  useEffect(() => {
    if (item) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [item]);

  // Reset active image on item change
  useEffect(() => {
    setActiveImageIndex(0);
  }, [item]);

  if (!item) return null;

  const handleToggleUpvote = () => {
    if (!hasUpvoted) {
      setUpvotes((prev) => prev + 1);
      setHasUpvoted(true);
    } else {
      setUpvotes((prev) => prev - 1);
      setHasUpvoted(false);
    }
  };

  const handleSendFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    if (commentText.trim()) {
      setFeedbackSent(true);
      setCommentText('');
      setTimeout(() => setFeedbackSent(false), 4000);
    }
  };

  return createPortal(
    <div
      onClick={onClose}
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
        className="relative w-full max-w-3xl max-h-[85vh] bg-[#0D121F] border border-[#3A3D40] rounded-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col my-auto"
      >
        {/* Fixed Header with Close Button */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-[#080C14] border-b border-[#3A3D40]">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-[#F05A28]/20 text-[#FCD3B0] border border-[#F05A28]/40">
              {item.badge}
            </span>
            <span className="text-xs font-mono text-slate-400">
              • {item.releaseDateKey}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full bg-[#1A2338] hover:bg-[#253250] text-slate-300 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 sm:p-8 space-y-6 overflow-y-auto flex-1">
          {/* Title & Category */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-mono text-[#F05A28] font-bold">
              <Layers className="w-4 h-4" />
              <span>{t(item.categoryLabelKey)}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white font-sans leading-tight">
              {t(item.titleKey)}
            </h2>
          </div>

          {/* Image Gallery Showcase */}
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden h-64 sm:h-80 border border-[#3A3D40] bg-black">
              <img
                src={item.images[activeImageIndex]}
                alt={t(item.titleKey)}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />

              {item.images.length > 1 && (
                <div className="absolute bottom-3 right-3 flex items-center gap-2 bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-[#3A3D40]">
                  <button
                    onClick={() => setActiveImageIndex((prev) => (prev - 1 + item.images.length) % item.images.length)}
                    className="text-slate-300 hover:text-white"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-mono text-slate-200">
                    {activeImageIndex + 1} / {item.images.length}
                  </span>
                  <button
                    onClick={() => setActiveImageIndex((prev) => (prev + 1) % item.images.length)}
                    className="text-slate-300 hover:text-white"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Thumbnail selector */}
            {item.images.length > 1 && (
              <div className="flex gap-2">
                {item.images.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImageIndex(idx)}
                    className={`relative w-20 h-14 rounded-lg overflow-hidden border transition-all ${
                      activeImageIndex === idx ? 'border-[#F05A28] scale-105 shadow-md shadow-[#F05A28]/20' : 'border-[#3A3D40] opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img src={img} alt="thumb" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Status & Target Quarter Box without progress bar */}
          <div className="p-4 rounded-xl bg-[#080C14] border border-[#3A3D40] grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-mono text-slate-400 uppercase font-semibold">{t('roadmap.statusLabel')}</p>
              <p className="text-sm font-bold text-[#FCD3B0] mt-0.5">{t(item.statusLabelKey)}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-slate-400 uppercase font-semibold">{t('roadmap.targetRelease')}</p>
              <p className="text-sm font-bold text-white mt-0.5">{item.releaseDateKey}</p>
            </div>
          </div>

          {/* Full Description */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-white uppercase font-mono tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#F05A28]" />
              {t('roadmap.sectionDescription')}
            </h4>
            <p className="text-xs sm:text-sm text-[#E1E4E8]/90 leading-relaxed font-sans">
              {t(item.fullDescriptionKey)}
            </p>
          </div>

          {/* Key Benefits */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-white uppercase font-mono tracking-wider flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              {t('roadmap.keyBenefitsTitle')}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-200">
              {item.keyBenefitsKeys.map((bKey, idx) => (
                <div key={idx} className="flex items-start gap-2 p-3 rounded-lg bg-[#080C14] border border-[#3A3D40]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#F05A28] shrink-0 mt-0.5" />
                  <span>{t(bKey)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tech Stack */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase font-mono tracking-wider">
              {t('roadmap.techStackTitle')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {item.techStack.map((tech, idx) => (
                <span
                  key={idx}
                  className="px-2.5 py-1 rounded bg-[#141A2A] border border-[#3A3D40] text-xs font-mono text-[#FCD3B0]"
                >
                  ⚡ {tech}
                </span>
              ))}
            </div>
          </div>

          {/* Priority Voting & Client Request Box */}
          <div className="p-5 rounded-2xl bg-[#080C14] border border-[#F05A28]/40 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-white font-sans">
                  {t('roadmap.votePriorityTitle')}
                </h4>
                <p className="text-xs text-[#E1E4E8]/70">
                  {t('roadmap.votePrioritySubtitle')}
                </p>
              </div>

              <button
                onClick={handleToggleUpvote}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold font-mono transition-all ${
                  hasUpvoted
                    ? 'bg-[#F05A28] text-slate-950 shadow-lg shadow-[#F05A28]/30 scale-105'
                    : 'bg-[#0D121F] border border-[#3A3D40] text-slate-300 hover:border-[#F05A28]'
                }`}
              >
                <ThumbsUp className="w-4 h-4" />
                <span>{upvotes} {t('roadmap.votesLabel')}</span>
              </button>
            </div>

            {/* Quick Comment / Custom Request */}
            <form onSubmit={handleSendFeedback} className="space-y-2 pt-2 border-t border-[#3A3D40]">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-[#F05A28]" />
                {t('roadmap.feedbackPlaceholder')}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={t('roadmap.feedbackInput')}
                  className="flex-1 bg-[#0D121F] border border-[#3A3D40] text-slate-100 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-[#F05A28]"
                />
                <button
                  type="submit"
                  className="bg-[#F05A28] hover:bg-[#d94d1f] text-slate-950 font-bold text-xs px-4 py-2 rounded-xl uppercase transition-colors"
                >
                  {t('roadmap.sendFeedbackBtn')}
                </button>
              </div>

              {feedbackSent && (
                <p className="text-xs font-bold text-emerald-400 flex items-center gap-1 mt-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t('roadmap.feedbackSuccess')}
                </p>
              )}
            </form>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-[#080C14] border-t border-[#3A3D40]">
          <span className="text-[11px] text-slate-400 font-mono">
            BEEMETRY R&D Mining Lab
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#1A2338] hover:bg-[#253250] text-slate-200 hover:text-white text-xs font-bold transition-colors"
          >
            {t('roadmap.closeModal')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
