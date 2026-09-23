import React, { useState } from 'react';
import { ArrowRight, Calendar, Sparkles, ChevronLeft, ChevronRight, Layers, Cpu, CheckCircle2, ShieldCheck, Zap } from 'lucide-react';
import { ImplementationItem } from '../../data/roadmapData';
import { useI18n } from '../../../../i18n/I18nProvider'

interface ImplementationCardProps {
  item: ImplementationItem;
  onSelect: (item: ImplementationItem) => void;
}

export const ImplementationCard: React.FC<ImplementationCardProps> = ({ item, onSelect }) => {
  const { t } = useI18n();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'testing':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
      case 'in_development':
        return 'bg-[#F05A28]/20 text-[#FCD3B0] border-[#F05A28]/50';
      case 'upcoming':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
      case 'planned':
      default:
        return 'bg-blue-500/15 text-blue-300 border-blue-500/40';
    }
  };

  const handleNextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImageIndex((prev) => (prev + 1) % item.images.length);
  };

  const handlePrevImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImageIndex((prev) => (prev - 1 + item.images.length) % item.images.length);
  };

  return (
    <div
      onClick={() => onSelect(item)}
      className="group bg-[#0D121F] border border-[#3A3D40] hover:border-[#F05A28]/70 rounded-2xl overflow-hidden transition-all duration-300 shadow-xl hover:shadow-[#F05A28]/10 flex flex-col justify-between cursor-pointer"
    >
      {/* Top Media / Visual Container */}
      <div className="relative h-48 sm:h-56 bg-slate-950 overflow-hidden">
        <img
          src={item.images[currentImageIndex]}
          alt={t(item.titleKey)}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 brightness-90"
        />

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0D121F] via-transparent to-black/60 pointer-events-none" />

        {/* Top Badges */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
          <span className="px-2.5 py-1 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider bg-[#080C14]/90 border border-[#3A3D40] text-slate-200 backdrop-blur-md">
            {item.badge}
          </span>
          <span className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider border backdrop-blur-md ${getStatusColor(item.status)}`}>
            {t(item.statusLabelKey)}
          </span>
        </div>

        {/* Multi-image carousel controls if > 1 image */}
        {item.images.length > 1 && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5 z-10">
            <button
              onClick={handlePrevImage}
              className="p-1 rounded-full bg-[#080C14]/80 hover:bg-[#F05A28] text-white hover:text-slate-950 transition-colors"
              title="Anterior"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/70 text-slate-200">
              {currentImageIndex + 1}/{item.images.length}
            </span>
            <button
              onClick={handleNextImage}
              className="p-1 rounded-full bg-[#080C14]/80 hover:bg-[#F05A28] text-white hover:text-slate-950 transition-colors"
              title="Siguiente"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Target Quarter badge */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-[11px] font-mono text-[#FCD3B0] bg-[#080C14]/85 px-2 py-0.5 rounded border border-[#3A3D40] backdrop-blur-md">
          <Calendar className="w-3 h-3 text-[#F05A28]" />
          <span>{item.releaseDateKey}</span>
        </div>
      </div>

      {/* Body Content */}
      <div className="p-5 sm:p-6 space-y-4 flex-1 flex flex-col justify-between">
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-mono text-[#F05A28] font-semibold">
            <Layers className="w-3.5 h-3.5" />
            <span>{t(item.categoryLabelKey)}</span>
          </div>

          <h3 className="text-lg sm:text-xl font-bold text-white group-hover:text-[#FCD3B0] transition-colors leading-snug">
            {t(item.titleKey)}
          </h3>

          <p className="text-xs text-[#E1E4E8]/80 line-clamp-3 leading-relaxed font-sans">
            {t(item.summaryKey)}
          </p>
        </div>

        {/* Tags */}
        <div className="pt-3 border-t border-[#3A3D40]/60">
          <div className="flex flex-wrap gap-1.5">
            {item.tags.slice(0, 3).map((tag, idx) => (
              <span
                key={idx}
                className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#141A2A] text-slate-300 border border-[#3A3D40]"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        {/* Footer Link */}
        <div className="pt-3 flex items-center justify-between text-xs font-bold text-[#F05A28] group-hover:text-white transition-colors">
          <span>{t('roadmap.viewDetails')}</span>
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </div>
  );
};
