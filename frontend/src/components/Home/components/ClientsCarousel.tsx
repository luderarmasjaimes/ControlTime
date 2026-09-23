import React from 'react';
import { Building2 } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nProvider'

export const ClientsCarousel: React.FC = () => {
  const clients = [
    { name: 'SOUTHERN COPPER', project: 'Tajo Toquepala' },
    { name: 'ANTAMINA', project: 'Presa de Relaves & Túneles' },
    { name: 'MINSUR', project: 'Unidad San Rafael' },
    { name: 'BUENAVENTURA', project: 'Colquijirca, Uchucchacua' },
    { name: 'GOLD FIELDS', project: 'Cerro Corona' },
    { name: 'VOLCAN MINERA', project: 'Yauli & Chungar' },
    { name: 'EL BROCAL', project: 'Colquijirca' },
    { name: 'MINERA RAURA', project: 'Presa & Piezometría' },
    { name: 'YANACOCHA', project: 'Padrón de Lixiviación' },
    { name: 'ALS GLOBAL', project: 'Monitoreo Ambiental' },
    { name: 'KNIGHT PIÉSOLD', project: 'Supervisión Geotécnica' },
    { name: 'ANDDES', project: 'Ingeniería Geotécnica' },
    { name: 'IGP PERÚ', project: 'Red Sísmica Nacional' },
    { name: 'CERPER PERÚ', project: 'Certificaciones' },
    { name: 'SEDAPAL', project: 'Monitoreo Hídrico' },
    { name: 'ACEROS AREQUIPA', project: 'Planta Industrial' },
  ];

  const { t } = useI18n();

  // Tripled array for seamless infinite rightwards loop
  const seamlessClients = [...clients, ...clients, ...clients];

  return (
    <section className="py-16 bg-[#080c14] border-b border-[#3A3D40]/50 text-[#F5F6F8] overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        
        {/* Section Header */}
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[#F05A28]/10 border border-[#F05A28]/30 text-[#FCD3B0] text-xs font-bold uppercase tracking-widest">
            <Building2 className="w-3.5 h-3.5 text-[#F05A28]" />
            {t('clients.badge')}
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight">
            {t('clients.title')}
          </h2>
          <p className="text-[#E1E4E8]/80 text-sm font-sans">
            {t('clientsCar.desc')}
          </p>
        </div>

        {/* Endless Moving Marquee Loop - Shifting Right */}
        <div className="relative w-full overflow-hidden py-4 bg-[#0D121F] rounded-2xl border border-[#3A3D40]">
          
          {/* Edge Gradients */}
          <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-[#0D121F] to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#0D121F] to-transparent z-10 pointer-events-none" />

          {/* Marquee Content moving right */}
          <div className="animate-marquee-right gap-5 whitespace-nowrap">
            {seamlessClients.map((client, idx) => (
              <div 
                key={idx}
                className="bg-[#141A2A] border border-[#3A3D40] hover:border-[#F05A28] hover:bg-[#1C253B] p-4 rounded-xl text-center space-y-1.5 group transition-all shrink-0 min-w-[210px] cursor-pointer shadow-md"
              >
                <div className="w-9 h-9 mx-auto rounded-full bg-[#3D170A]/80 border border-[#9B3E1B] flex items-center justify-center text-[#FCD3B0] font-bold font-mono text-sm group-hover:bg-[#F05A28] group-hover:text-slate-950 transition-colors">
                  {client.name.charAt(0)}
                </div>
                <h4 className="font-extrabold text-xs text-white uppercase tracking-wider font-sans group-hover:text-[#FCD3B0] transition-colors">
                  {client.name}
                </h4>
                <p className="text-[10px] text-[#E1E4E8]/70 font-mono">
                  {client.project}
                </p>
              </div>
            ))}
          </div>

        </div>

      </div>
    </section>
  );
};

