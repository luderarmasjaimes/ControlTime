import React from 'react';
import { Building2, ShieldCheck, MapPin, CheckCircle2, Award, Users } from 'lucide-react';
import controlRoomImg from '../assets/images/control_room_mining_1786400856701.jpg';
import undergroundMineImg from '../assets/images/underground_mine_sensors_1786400868581.jpg';
import { useI18n } from '../../../i18n/I18nProvider'

export const MiningUnitsSection: React.FC = () => {
  const { t } = useI18n();
  return (
    <section className="py-16 bg-[#060a14] border-b border-slate-800 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        
        {/* Section Header */}
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-amber-400 text-xs font-bold uppercase tracking-widest">
            <Building2 className="w-3.5 h-3.5" />
            {t('mining.brand')}
          </div>
          <h2 className="text-3xl font-black text-white font-sans tracking-tight">
            {t('mining.title')}
          </h2>
          <p className="text-slate-400 text-sm">
            {t('mining.desc')}
          </p>
        </div>

        {/* Feature Visual Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-[#0b1322] shadow-xl group">
            <img
              src={controlRoomImg}
              alt="Centro de Control BEEMETRY"
              referrerPolicy="no-referrer"
              className="w-full h-64 object-cover group-hover:scale-105 transition-transform duration-500 brightness-90"
            />
            <div className="p-6 space-y-2">
              <h3 className="text-lg font-black text-white font-sans">
                {t('mining.case1-title')}
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {t('mining.case1-desc')}
              </p>
            </div>
          </div>

          <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-[#0b1322] shadow-xl group">
            <img
              src={undergroundMineImg}
              alt="Telemetría en Socavón"
              referrerPolicy="no-referrer"
              className="w-full h-64 object-cover group-hover:scale-105 transition-transform duration-500 brightness-90"
            />
            <div className="p-6 space-y-2">
              <h3 className="text-lg font-black text-white font-sans">
                {t('mining.case2-title')}
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {t('mining.case2-desc')}
              </p>
            </div>
          </div>

        </div>

        {/* Testimonials -- 100% ilustrativos (ADR-171): BEEMETRY está en
            desarrollo y ningún cliente la tiene en uso todavía (ver
            ADR-134). Nombres, cargos y unidades mineras son ficticios a
            propósito -- no deben coincidir con una empresa real, para no
            insinuar una relación comercial que no existe. */}
        <div className="space-y-3 pt-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-950/40 border border-amber-700/50 text-amber-300 text-[11px] font-bold uppercase tracking-widest">
            {t('mining.testimonialsDisclaimer')}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#0b1322] border border-slate-800 p-5 rounded-xl space-y-3">
              <p className="text-xs text-slate-300 italic">
                "BEEMETRY redujo en un 40% el tiempo dedicado a la redacción de informes geotécnicos diarios gracias al Word potenciado con IA y la captura directa de piezómetros."
              </p>
              <div className="border-t border-slate-800 pt-3">
                <p className="text-xs font-bold text-slate-100">Ing. Carlos Mendoza <span className="text-slate-500 font-normal">(perfil ilustrativo)</span></p>
                <p className="text-[11px] text-amber-400">Jefe de Geotecnia · Unidad Minera Demostración</p>
              </div>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-5 rounded-xl space-y-3">
              <p className="text-xs text-slate-300 italic">
                "El dictado de voz local en socavón permite a los ingenieros de guardia registrar novedades sin quitarse el equipo de protección personal."
              </p>
              <div className="border-t border-slate-800 pt-3">
                <p className="text-xs font-bold text-slate-100">Ing. Mariela Paredes <span className="text-slate-500 font-normal">(perfil ilustrativo)</span></p>
                <p className="text-[11px] text-cyan-400">Superintendente de Seguridad · Complejo Minero Los Andes</p>
              </div>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-5 rounded-xl space-y-3">
              <p className="text-xs text-slate-300 italic">
                "Los diagramas de flujo de transformación de datos nos permitieron crear reglas automáticas de corte cuando los valores de PM10 rozan el límite ECA."
              </p>
              <div className="border-t border-slate-800 pt-3">
                <p className="text-xs font-bold text-slate-100">Ing. Roberto Quispe <span className="text-slate-500 font-normal">(perfil ilustrativo)</span></p>
                <p className="text-[11px] text-emerald-400">Gerente de Operaciones · Minera del Sur</p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
};
