import React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
    Bold, Italic, List, ListOrdered, Quote, Heading1, Heading2,
    Table as TableIcon, Image as ImageIcon, Video as VideoIcon,
    QrCode, MessageSquare, Save, FileText, ChevronDown
} from 'lucide-react'
import VideoDiagram from '../Special/VideoDiagram'

const MenuBar = ({ editor }) => {
    if (!editor) return null

    const btnClass = "p-2.5 hover:bg-slate-700/50 rounded-xl transition-all text-slate-400 hover:text-white group relative"
    const activeClass = "bg-sky-500/10 text-sky-400 border border-sky-500/20 shadow-[0_0_15px_rgba(14,165,233,0.1)]"

    return (
        <div className="flex flex-wrap items-center gap-1.5 p-3 border-b border-white/5 bg-slate-900/60 backdrop-blur-xl sticky top-0 z-10">
            <div className="flex items-center gap-1 bg-slate-950/40 p-1 rounded-xl border border-white/5 mr-2">
                <button onClick={() => editor.chain().focus().toggleBold().run()} className={`${btnClass} ${editor.isActive('bold') ? activeClass : ''}`} title="Negrita"><Bold size={18} /></button>
                <button onClick={() => editor.chain().focus().toggleItalic().run()} className={`${btnClass} ${editor.isActive('italic') ? activeClass : ''}`} title="Cursiva"><Italic size={18} /></button>
            </div>

            <div className="flex items-center gap-1 bg-slate-950/40 p-1 rounded-xl border border-white/5 mr-2">
                <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={`${btnClass} ${editor.isActive('heading', { level: 1 }) ? activeClass : ''}`} title="Título 1"><Heading1 size={18} /></button>
                <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={`${btnClass} ${editor.isActive('heading', { level: 2 }) ? activeClass : ''}`} title="Título 2"><Heading2 size={18} /></button>
            </div>

            <div className="flex items-center gap-1 bg-slate-950/40 p-1 rounded-xl border border-white/5 mr-2">
                <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={`${btnClass} ${editor.isActive('bulletList') ? activeClass : ''}`} title="Lista"><List size={18} /></button>
                <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={`${btnClass} ${editor.isActive('orderedList') ? activeClass : ''}`} title="Lista numerada"><ListOrdered size={18} /></button>
            </div>

            <div className="flex flex-1 items-center gap-3 ml-4 overflow-hidden">
                <div className="h-5 w-px bg-white/10" />
                <button className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-sky-400 transition-colors">
                    <TableIcon size={16} /> Insertar Tabla
                </button>
                <button className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-emerald-400 transition-colors">
                    <VideoIcon size={16} /> Insertar Video 3D
                </button>
            </div>

            <button className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 rounded-xl text-xs font-bold transition-all shadow-lg shadow-sky-600/20 active:scale-95">
                <Save size={16} /> Guardar Cambios
            </button>
        </div>
    )
}

const RichTextEditor = () => {
    const editor = useEditor({
        extensions: [StarterKit],
        content: `
      <div class="report-header">
        <h1>Informe Geomecánico: Crucero 340-N</h1>
        <p class="subtitle text-sky-400 font-bold tracking-[0.2em] uppercase text-[10px]">Unidad Minera Raura | 2026</p>
      </div>
      <hr />
      <h2>1. Resumen Ejecutivo</h2>
      <p>Se ha realizado la evaluación estructural sistemática del frente de avance mediante <strong>fotogrametría computacional</strong> y análisis de <strong>visión artificial</strong>.</p>
      
      <h2>2. Análisis de Discontinuidades</h2>
      <p>A continuación se presenta el stream procesado por el motor de Redes Neuronales (C++ / OpenCV) donde se destacan las fracturas críticas:</p>
      
      <div class="video-placeholder-block"></div>

      <p>El índice RQD calculado automáticamente en base a las 156 fracturas detectadas es de <strong>82.4%</strong>, lo que clasifica la roca como <i>Buena</i>.</p>
      
      <h3>Tabla de Parámetros Técnicos</h3>
      <div class="table-mock p-4 border border-white/5 bg-white/5 rounded-2xl my-6">
        <div class="grid grid-cols-3 gap-8 py-2 border-b border-white/10 text-[10px] uppercase font-black text-slate-500">
           <span>Parámetro</span>
           <span>Valor</span>
           <span>Estado</span>
        </div>
        <div class="grid grid-cols-3 gap-8 py-4 text-sm border-b border-white/5">
           <span class="font-medium">Resistencia Compresión</span>
           <span class="font-mono text-white">125 MPa</span>
           <span class="text-emerald-400 font-bold">Óptimo</span>
        </div>
        <div class="grid grid-cols-3 gap-8 py-4 text-sm">
           <span class="font-medium">Buzamiento Promedio</span>
           <span class="font-mono text-white">45.2°</span>
           <span class="text-amber-400 font-bold">Precaución</span>
        </div>
      </div>

      <p>Se recomienda proceder con el avance según el plan G-4, instalando pernos cada...</p>
    `,
        editorProps: {
            attributes: {
                class: 'prose prose-invert max-w-none focus:outline-none min-h-[600px] p-12 text-slate-300 leading-relaxed font-inter selection:bg-sky-500/20 shadow-inner',
            },
        },
    })

    return (
        <div className="flex flex-col h-full glass overflow-hidden border-white/5 shadow-2xl group/editor">
            <MenuBar editor={editor} />
            <div className="flex-1 overflow-y-auto bg-slate-900/30 custom-editor p-4">
                <div className="max-w-4xl mx-auto py-10">
                    <EditorContent editor={editor} />

                    {/* Custom Interactive Elements inserted into the flow */}
                    <div className="px-12 mb-10">
                        <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl hover:border-sky-500/30 transition-all group/video">
                            <VideoDiagram />
                            <div className="bg-slate-950 p-3 flex justify-between items-center">
                                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Fig 1.2: Análisis de Fracturas Dinámico</span>
                                <button className="text-[9px] text-sky-400 font-bold uppercase hover:underline">Ver pantalla completa</button>
                            </div>
                        </div>
                    </div>

                    <div className="px-12 text-slate-500 text-[10px] border-t border-white/5 pt-8 flex justify-between items-center">
                        <span>Firma Digital: Ing. Geólogo Principal</span>
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span>Verificado por C++ Analytics Module</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default RichTextEditor
