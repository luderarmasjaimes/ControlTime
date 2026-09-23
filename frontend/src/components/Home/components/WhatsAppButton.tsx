import React, { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';

export const WhatsAppButton: React.FC = () => {
  const [showTooltip, setShowTooltip] = useState(true);

  const phoneNumber = '51970045000'; // Official support phone
  const message = encodeURIComponent('Hola BEEMETRY OS, deseo recibir información y cotización sobre la plataforma de monitoreo minero.');
  const whatsappUrl = `https://wa.me/${phoneNumber}?text=${message}`;

  return (
    <div className="fixed bottom-6 left-6 z-50 flex items-end gap-3 pointer-events-none">
      
      {/* Tooltip / Popover Badge */}
      {showTooltip && (
        <div className="pointer-events-auto bg-[#0b1322] border border-emerald-500/40 text-slate-100 p-3 rounded-xl shadow-2xl max-w-xs space-y-1 relative animate-fadeIn hidden sm:block">
          <button
            onClick={() => setShowTooltip(false)}
            className="absolute top-1.5 right-1.5 text-slate-400 hover:text-white p-0.5 rounded-full"
            title="Cerrar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            <span>Atención Especializada Minera</span>
          </div>
          <p className="text-[11px] text-slate-300">
            ¿Desea cotizar o solicitar asesoría técnica para su unidad minera? Chatee con un ingeniero.
          </p>
        </div>
      )}

      {/* WhatsApp Action Button */}
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="pointer-events-auto w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 flex items-center justify-center shadow-lg shadow-emerald-500/30 transition-all hover:scale-110 active:scale-95 group relative"
        title="Contactar por WhatsApp"
      >
        {/* Pulse ring animation */}
        <span className="absolute inset-0 rounded-full bg-emerald-500/40 animate-ping pointer-events-none"></span>

        <MessageCircle className="w-7 h-7 text-slate-950 fill-slate-950 stroke-[1.5]" />
      </a>

    </div>
  );
};
