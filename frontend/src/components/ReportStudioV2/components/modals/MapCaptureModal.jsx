import React, { useRef, useState, useEffect } from 'react';
import { X, MapPin, Check, Loader } from 'lucide-react';
import DetailedMap from '../../../Special/DetailedMap';

const MapCaptureModal = ({ onClose, onCaptureComplete }) => {
  const [capturedImage, setCapturedImage] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isLoadingMap, setIsLoadingMap] = useState(true);
  const mapLoadTimeoutRef = useRef(null);

  useEffect(() => {
    // Optimistic: consider map loaded after 2.5s even if not ready
    mapLoadTimeoutRef.current = setTimeout(() => {
      setIsLoadingMap(false);
    }, 2500);

    return () => {
      if (mapLoadTimeoutRef.current) {
        clearTimeout(mapLoadTimeoutRef.current);
      }
    };
  }, []);

  const handleCaptureMap = (imageDataUrl) => {
    if (!imageDataUrl) return;
    setCapturedImage(imageDataUrl);
    setShowPreview(true);
  };

  // Insertar la foto capturada
  const handleInsertPhoto = () => {
    if (capturedImage) {
      onCaptureComplete(capturedImage);
      onClose();
    }
  };

  // Cancelar foto y seguir en el mapa para tomar otra
  const handleCancelPreview = () => {
    setCapturedImage(null);
    setShowPreview(false);
  };

  // Finalizar sin insertar cambios
  const handleFinalize = () => {
    setCapturedImage(null);
    setShowPreview(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[1200] bg-slate-950/65 backdrop-blur-md flex items-center justify-center px-4 py-4">
      <div className="w-full max-w-6xl max-h-[90vh] rounded-2xl border border-slate-300/40 bg-white shadow-2xl overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-sky-50 to-indigo-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin size={20} className="text-indigo-600" />
            <h3 className="text-lg font-bold text-slate-800">Capturador de Mapa Detallado Pro</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
            title="Cerrar capturador"
          >
            <X size={20} className="text-slate-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 min-h-[400px] bg-slate-100 relative" style={{ height: '700px' }}>
            {isLoadingMap && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-50/80 backdrop-blur-sm">
                <Loader size={32} className="text-indigo-600 animate-spin mb-3" />
                <p className="text-sm font-medium text-slate-700">Cargando mapa...</p>
                <p className="text-xs text-slate-500 mt-1">Esto puede tomar unos segundos</p>
              </div>
            )}
            <DetailedMap onCaptureMap={handleCaptureMap} captureButtonPlacement="top" />
          </div>
        </div>
      </div>

      {showPreview && capturedImage && (
        <div className="fixed inset-0 z-[1210] bg-slate-950/55 backdrop-blur-sm flex items-center justify-center px-4 py-4">
          <div className="w-full max-w-3xl max-h-[86vh] rounded-2xl border border-slate-300 bg-white shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h4 className="font-bold text-slate-800">Vista previa de la captura</h4>
              <button onClick={handleCancelPreview} className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors" title="Cerrar vista previa">
                <X size={18} className="text-slate-600" />
              </button>
            </div>

            <div className="flex-1 flex items-center justify-center px-6 py-6 bg-white overflow-auto">
              <img
                src={capturedImage}
                alt="Captura de mapa"
                className="max-w-full max-h-full rounded-lg shadow-lg border border-slate-300"
              />
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
              <button
                onClick={handleCancelPreview}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100 transition-colors"
              >
                CANCELAR
              </button>
              <button
                onClick={handleInsertPhoto}
                className="px-4 py-2 rounded-lg bg-green-700 text-white font-semibold hover:bg-green-800 transition-colors flex items-center gap-2"
              >
                <Check size={16} />
                INSERTAR
              </button>
              <button
                onClick={handleFinalize}
                className="px-4 py-2 rounded-lg bg-indigo-700 text-white font-semibold hover:bg-indigo-800 transition-colors"
              >
                FINALIZAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapCaptureModal;
