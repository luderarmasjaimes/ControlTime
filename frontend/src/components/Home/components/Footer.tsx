import React from 'react';
import { Cpu, ShieldCheck, CheckCircle2, Phone, Mail, MapPin } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-slate-950 border-t border-slate-800 text-slate-400 text-xs py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          
          {/* Brand Info */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-orange-500 rounded-sm flex items-center justify-center font-bold text-slate-950 font-mono text-base">
                Ω
              </div>
              <span className="font-bold text-slate-100 font-mono text-base tracking-wider uppercase">
                BEEMETRY OS
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Plataforma empresarial de inteligencia geotécnica, telemetría de sensores en tiempo real y generación de informes asistida por IA para unidades mineras en Perú y Latinoamérica.
            </p>
          </div>

          {/* Módulos del Sistema */}
          <div className="space-y-2">
            <p className="font-bold text-orange-500 uppercase tracking-wider text-xs">
              MÓDULOS DE LA PLATAFORMA
            </p>
            <ul className="space-y-1 text-[11px] text-slate-400">
              <li className="hover:text-orange-500 transition-colors cursor-pointer">● Centro de Control & KPIs Live</li>
              <li className="hover:text-orange-500 transition-colors cursor-pointer">● Monitoreo de Radares GB-SAR</li>
              <li className="hover:text-orange-500 transition-colors cursor-pointer">● Piezómetros & Presión de Poros</li>
              <li className="hover:text-orange-500 transition-colors cursor-pointer">● Diagramas de Flujo de Sensores</li>
              <li className="hover:text-orange-500 transition-colors cursor-pointer">● Word Potenciado por IA Generativa</li>
              <li className="hover:text-orange-500 transition-colors cursor-pointer">● Dictado por Voz Local en Socavón</li>
            </ul>
          </div>

          {/* Normativas y Seguridad */}
          <div className="space-y-2">
            <p className="font-bold text-orange-500 uppercase tracking-wider text-xs">
              NORMATIVA & CUMPLIMIENTO
            </p>
            <ul className="space-y-1 text-[11px] text-slate-400">
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Estándar Global de Depósitos de Relaves (GISTM)
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Gestión de Riesgos ISO 31000
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Estándares Ambientales ECA Perú
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Encriptación TLS 1.3 & Off-grid Mesh
              </li>
            </ul>
          </div>

          {/* Soporte Mina */}
          <div className="space-y-2">
            <p className="font-bold text-orange-500 uppercase tracking-wider text-xs">
              SOPORTE TÉCNICO MINERO
            </p>
            <p className="text-[11px] flex items-center gap-2 text-slate-300">
              <Phone className="w-3.5 h-3.5 text-orange-500" />
              Oficina Lima: +51 1 700-4500
            </p>
            <p className="text-[11px] flex items-center gap-2 text-slate-300">
              <Mail className="w-3.5 h-3.5 text-orange-500" />
              soporte@beemetry.com
            </p>
            <p className="text-[11px] flex items-center gap-2 text-slate-300">
              <MapPin className="w-3.5 h-3.5 text-orange-500" />
              Av. Javier Prado Este 4200, Surco - Lima, Perú
            </p>
          </div>

        </div>

        {/* Bottom Bar */}
        <div className="pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500">
          <p>© {new Date().getFullYear()} BEEMETRY. Todos los derechos reservados. Software Minero Empresarial.</p>

          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 text-emerald-400 px-3 py-1 rounded font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            <span>SERVIDORES EN PLANTA OPERATIVOS 100%</span>
          </div>
        </div>

      </div>
    </footer>
  );
};
