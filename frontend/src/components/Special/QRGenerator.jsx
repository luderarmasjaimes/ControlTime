import React from 'react'
import { QrCode, X, Download, Share2 } from 'lucide-react'
import { motion } from 'framer-motion'

const QRGenerator = ({ reportId, onClose }) => {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        >
            <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="glass max-w-sm w-full p-8 flex flex-col items-center bg-slate-900 border-white/10"
            >
                <div className="w-full flex justify-end mb-2">
                    <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                <div className="w-12 h-12 rounded-2xl bg-sky-500/20 flex items-center justify-center mb-6">
                    <QrCode className="text-sky-400" size={28} />
                </div>

                <h3 className="text-xl font-bold text-white mb-2 font-display">Acceso Rápido</h3>
                <p className="text-xs text-slate-500 text-center mb-8">Escanee para ver este informe técnico 3D en dispositivos móviles vinculados.</p>

                <div className="bg-white p-4 rounded-3xl mb-8 shadow-[0_0_40px_rgba(255,255,255,0.1)]">
                    {/* Mock QR implementation - in real life use 'qrcode.react' */}
                    <div className="w-48 h-48 bg-slate-100 flex items-center justify-center border-4 border-slate-50 overflow-hidden rounded-xl">
                        <div className="grid grid-cols-4 gap-1 p-2">
                            {[...Array(16)].map((_, i) => (
                                <div key={i} className={`w-8 h-8 ${Math.random() > 0.4 ? 'bg-slate-900' : 'bg-transparent'} rounded-sm`} />
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex gap-3 w-full">
                    <button className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2">
                        <Download size={14} /> PNG
                    </button>
                    <button className="flex-1 py-3 bg-sky-600 hover:bg-sky-500 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2">
                        <Share2 size={14} /> Enlace
                    </button>
                </div>

                <p className="mt-6 text-[10px] text-slate-600 font-mono">ID: {reportId || 'RAURA-2026-452'}</p>
            </motion.div>
        </motion.div>
    )
}

export default QRGenerator
