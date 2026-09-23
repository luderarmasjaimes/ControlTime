import React, { useState, useEffect } from 'react';
import { Activity, Radio, AlertTriangle, Gauge, Sliders, RefreshCw, BarChart2, ShieldCheck, Database, Layers, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { INITIAL_GEOTECHNICAL_METRICS, MINING_UNITS } from '../data/mockMiningData';
import { useI18n } from '../../../i18n/I18nProvider'
import ImageCentercase from '../assets/images/dashboard.png'

interface ControlCenterShowcaseProps {
  onOpenLogin: () => void;
}

export const ControlCenterShowcase: React.FC<ControlCenterShowcaseProps> = ({ onOpenLogin }) => {
  const [metrics, setMetrics] = useState(INITIAL_GEOTECHNICAL_METRICS);
  const [isLiveSimulating, setIsLiveSimulating] = useState(true);
  const { t } = useI18n();

  // Live telemetry pulse simulation
  useEffect(() => {
    if (!isLiveSimulating) return;

    const interval = setInterval(() => {
      setMetrics((prev) => ({
        ...prev,
        inclinometerAngle: Number((0.30 + Math.random() * 0.08).toFixed(2)),
        airQualityPM10: Math.floor(38 + Math.random() * 8),
        plantOEE: Number((81.5 + Math.random() * 2.0).toFixed(1)),
        piezometers: {
          p1: Math.floor(108 + Math.random() * 8),
          p2: Math.floor(90 + Math.random() * 10),
          p3: Math.floor(132 + Math.random() * 12),
        },
      }));
    }, 3000);

    return () => clearInterval(interval);
  }, [isLiveSimulating]);

  return (
    <section className="py-16 bg-[#060a14] border-b border-slate-800 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-orange-950/80 border border-orange-700/60 text-orange-400 text-xs font-bold uppercase tracking-widest mb-2">
              <Activity className="w-3.5 h-3.5 text-orange-400" />
              {t('center.index')}
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white font-sans tracking-tight">
              {t('center.title')}
            </h2>
            <p className="text-slate-400 text-sm max-w-2xl mt-1">
              {t('center.description')}
            </p>
          </div>
        </div>
        <img src={ImageCentercase} alt="Control Center Showcase" className="w-full h-auto rounded-lg shadow-lg" />
      </div>
    </section>
  );
};
