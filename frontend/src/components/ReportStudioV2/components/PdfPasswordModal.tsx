import React, { useState } from 'react';
import { KeyRound, Copy, Check, X } from 'lucide-react';

interface PdfPasswordModalProps {
  password: string;
  onClose: () => void;
}

/**
 * ADR-080: muestra UNA sola vez la contraseña con la que quedó cifrado el
 * PDF recién descargado (el servidor no la persiste — si se cierra este
 * modal sin copiarla, hay que volver a exportar para obtener una nueva).
 */
function PdfPasswordModal({ password, onClose }: PdfPasswordModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Portapapeles no disponible (permiso denegado, contexto no seguro):
      // la contraseña sigue visible en pantalla para copiarla a mano.
    }
  };

  return (
    <div className="pdf-pw-overlay" role="dialog" aria-modal="true">
      <div className="pdf-pw-modal">
        <div className="pdf-pw-header">
          <KeyRound size={18} style={{ color: '#6366f1' }} />
          <h3>PDF protegido generado</h3>
          <button className="pdf-pw-close" onClick={onClose} title="Cerrar">
            <X size={16} />
          </button>
        </div>
        <p className="pdf-pw-desc">
          El PDF descargado lleva marca de agua y quedó cifrado con esta contraseña.
          Se necesita para abrirlo — <strong>no se volverá a mostrar</strong>, guárdala en un
          lugar seguro.
        </p>
        <div className="pdf-pw-value-row">
          <code className="pdf-pw-value">{password}</code>
          <button className="pdf-pw-copy-btn" onClick={handleCopy} title="Copiar contraseña">
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copiada' : 'Copiar'}
          </button>
        </div>
        <button className="pdf-pw-done-btn" onClick={onClose}>Entendido</button>
      </div>
    </div>
  );
}

export default PdfPasswordModal;
