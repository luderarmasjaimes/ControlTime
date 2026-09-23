import React from 'react';
import { Layers } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nProvider'

export const BrandSupportCarousel: React.FC = () => {
  const brands = [
    'GEOKON', 'RST INSTRUMENTS', 'ROCTEST', 'MEASURAND', 'DGSI', 
    'INSTANTEL', 'CAMPBELL SCIENTIFIC', 'VAISALA', 'WEATHERHAWK', 'SENSEMETRICS', 
    'JEWELL', 'TURNER DESIGNS', 'SOLINST', 'KINEMETRICS', 'PETROSENSE', 
    'FESTO', 'ROSEMOUNT', 'LEICA GEOSYSTEMS', 'SMARTEC', 'IN-SITU', 
    'MODERN WATER', 'GÜRALP', 'REUTECH', 'NANOMETRICS', 'TRE ALTAMIRA', 
    'BADGER METER', 'KROHNE', 'ENDRESS+HAUSER', 'FLEXIM', 'SOIL INSTRUMENTS'
  ];

  // Tripled array to ensure seamless infinite rightwards loop
  const seamlessBrands = [...brands, ...brands, ...brands];
  const { t } = useI18n();

  return (
    <section className="py-12 bg-[#080c14] border-b border-[#3A3D40]/50 text-[#F5F6F8] overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[#F05A28]/10 border border-[#F05A28]/30 text-[#FCD3B0] text-xs font-mono font-bold uppercase tracking-widest">
            <Layers className="w-3.5 h-3.5 text-[#F05A28]" />
            {t('brands.badge')}
          </div>
          <h3 className="text-2xl font-extrabold text-white tracking-tight">
            {t('brands.title')}
          </h3>
          <p className="text-xs text-[#E1E4E8]/80 max-w-2xl mx-auto font-sans">
            {t('brands.description')}
          </p>
        </div>

        {/* Endless Moving Marquee Loop - Shifting Right */}
        <div className="relative w-full overflow-hidden py-4 bg-[#0D121F] rounded-xl border border-[#3A3D40]">
          
          {/* Gradient Fades on Edges */}
          <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-[#0D121F] to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-[#0D121F] to-transparent z-10 pointer-events-none" />

          {/* Scrolling Container moving to the Right */}
          <div className="animate-marquee-right gap-4 whitespace-nowrap">
            {seamlessBrands.map((brand, index) => (
              <div 
                key={index}
                className="px-4 py-2.5 bg-[#141A2A] border border-[#3A3D40] rounded-lg text-xs font-mono font-bold text-[#E1E4E8] hover:text-[#F05A28] hover:border-[#F05A28]/60 hover:bg-[#1C253B] transition-all shrink-0 shadow-sm flex items-center gap-2 cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#F05A28]"></span>
                <span>{brand}</span>
              </div>
            ))}
          </div>

        </div>

      </div>
    </section>
  );
};

