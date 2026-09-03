import React, { useEffect, useState } from 'react';
import { Link2, Copy, Check, X, Download } from 'lucide-react';
import QRCode from 'qrcode';

interface ShareLinkModalProps {
  url: string;
  expiresInHours: number;
  onClose: () => void;
}

/**
 * ADR-138: muestra el enlace de acceso directo (sin contraseña) recién
 * generado y su QR. A diferencia de PdfPasswordModal (ADR-080), acá el QR
 * apunta a una URL propia que sirve el PDF ya sin cifrar — escanearlo con la
 * cámara del celular abre el informe directo, sin pegar nada. La
 * contrapartida es que cualquiera con el link (o el QR) entra sin loguearse
 * mientras no venza: mostrarlo claro para que el usuario decida con quién lo
 * comparte.
 */
function ShareLinkModal({ url, expiresInHours, onClose }: ShareLinkModalProps) {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: 208, margin: 1 })
      .then((dataUrl) => { if (!cancelled) setQrDataUrl(dataUrl); })
      .catch(() => { /* si falla la generación, el link en texto sigue disponible */ });
    return () => { cancelled = true; };
  }, [url]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Portapapeles no disponible: el link sigue visible para copiarlo a mano.
    }
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = 'enlace-informe-qr.png';
    a.click();
  };

  return (
    <div className="pdf-pw-overlay" role="dialog" aria-modal="true">
      <div className="pdf-pw-modal">
        <div className="pdf-pw-header">
          <Link2 size={18} style={{ color: '#6366f1' }} />
          <h3>Enlace de acceso directo</h3>
          <button className="pdf-pw-close" onClick={onClose} title="Cerrar">
            <X size={16} />
          </button>
        </div>
        <p className="pdf-pw-desc">
          Quien escanee este QR o abra el link ve el PDF <strong>directo, sin pedir
          contraseña</strong> — a diferencia del PDF protegido, este no está cifrado:
          la protección es el link en sí. Vence en {expiresInHours} horas y{' '}
          <strong>cualquiera que lo tenga puede abrirlo sin loguearse</strong> —
          compartilo solo con quien corresponda.
        </p>
        <div className="pdf-pw-value-row">
          <code className="pdf-pw-value" style={{ fontSize: '0.72rem' }}>{url}</code>
          <button className="pdf-pw-copy-btn" onClick={handleCopy} title="Copiar enlace">
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        {qrDataUrl && (
          <div className="pdf-pw-qr-block">
            <img src={qrDataUrl} alt="QR del enlace de acceso directo" className="pdf-pw-qr-img" width={104} height={104} />
            <div className="pdf-pw-qr-text">
              <p>
                Escaneá este QR con la cámara o cualquier app de scanner del celular
                — el PDF se abre solo, sin pasos adicionales.
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

export default ShareLinkModal;
