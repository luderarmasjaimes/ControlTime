import React, { useEffect, useState } from 'react';
import { KeyRound, Copy, Check, X, Download } from 'lucide-react';
import QRCode from 'qrcode';

interface PdfPasswordModalProps {
  password: string;
  onClose: () => void;
}

/**
 * ADR-080: muestra UNA sola vez la contraseña con la que quedó cifrado el
 * PDF recién descargado (el servidor no la persiste — si se cierra este
 * modal sin copiarla, hay que volver a exportar para obtener una nueva).
 *
 * El QR es puramente client-side (codifica el mismo texto que ya viaja en
 * X-Pdf-Password) — ningún lector de PDF estándar soporta "abrir sin pedir
 * contraseña" vía QR/enlace, así que esto no reemplaza el diálogo de
 * contraseña del lector: solo evita transcribir a mano una contraseña
 * aleatoria al escanearla desde otro dispositivo (p.ej. el celular donde
 * llegó el correo o WhatsApp con el PDF adjunto).
 */
function PdfPasswordModal({ password, onClose }: PdfPasswordModalProps) {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(password, { width: 208, margin: 1 })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { /* si falla la generación, la contraseña en texto sigue disponible */ });
    return () => { cancelled = true; };
  }, [password]);

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

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = 'clave-pdf-qr.png';
    a.click();
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
        {qrDataUrl && (
          <div className="pdf-pw-qr-block">
            <img src={qrDataUrl} alt="QR con la contraseña del PDF" className="pdf-pw-qr-img" width={104} height={104} />
            <div className="pdf-pw-qr-text">
              <p>
                Escaneá este QR desde el celular para copiar la contraseña sin transcribirla
                a mano — útil al abrir el PDF adjunto desde el correo o WhatsApp. El lector de
                PDF va a seguir pidiendo la contraseña igual; el QR solo evita tipearla.
              </p>
              <button className="pdf-pw-qr-download-btn" onClick={handleDownloadQr} title="Descargar QR como imagen">
                <Download size={13} /> Descargar QR
              </button>
            </div>
          </div>
        )}
        <button className="pdf-pw-done-btn" onClick={onClose}>Entendido</button>
      </div>
    </div>
  );
}

export default PdfPasswordModal;
