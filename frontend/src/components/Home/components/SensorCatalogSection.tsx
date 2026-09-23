import React, { useState } from 'react';
import { Cpu, Wind, Droplets, MapPin, Activity, Radio, Sun, ShieldCheck } from 'lucide-react';

export const SensorCatalogSection: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'ambiental' | 'hidrico' | 'geoespacial' | 'geotecnico' | 'telemetria'>('geotecnico');

  const categories = [
    { id: 'geotecnico', label: 'Geotécnico & Estructural', icon: Activity },
    { id: 'hidrico', label: 'Recursos Hídricos', icon: Droplets },
    { id: 'ambiental', label: 'Monitoreo Ambiental', icon: Wind },
    { id: 'geoespacial', label: 'Geoespacial & Radares', icon: MapPin },
    { id: 'telemetria', label: 'Dataloggers & Módulos Solares', icon: Radio },
  ];

  return (
    <section className="py-16 bg-[#060a14] border-b border-slate-800 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        
        {/* Header */}
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-orange-500/10 border border-orange-500/30 text-orange-500 text-xs font-bold uppercase tracking-widest">
            <Cpu className="w-3.5 h-3.5" />
            Catálogo e Instrumentación
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight">
            Sensores y Equipos Soportados en Tiempo Real
          </h2>
          <p className="text-slate-400 text-sm">
            Soportamos la integración automatizada de sensores de alta precisión para todas las disciplinas de monitoreo en minería subterránea y tajo abierto.
          </p>
        </div>

        {/* Tab Buttons Navigation */}
        <div className="flex flex-wrap items-center justify-center gap-2 border-b border-slate-800 pb-4">
          {categories.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-orange-500 text-slate-950 shadow-md shadow-orange-500/20'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Contents */}
        {/* TAB 1: GEOTÉCNICO */}
        {activeTab === 'geotecnico' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fadeIn">
            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-orange-400 uppercase font-bold">PRESIÓN DE POROS</span>
              <h4 className="text-sm font-bold text-white">Piezómetros de Cuerda Vibrante (VW) & 4-20mA</h4>
              <p className="text-xs text-slate-400">Medición continua de presión freática en presas de relaves, depósitos de desmonte y tajos.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-orange-400 uppercase font-bold">DEFORMACIÓN SUBSUPERFICIAL</span>
              <h4 className="text-sm font-bold text-white">Inclinómetros Fijos y Portables & ShapeArray</h4>
              <p className="text-xs text-slate-400">Detección temprana de planos de falla, desplazamientos horizontales y deformación lateral.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-orange-400 uppercase font-bold">ASENTAMIENTO</span>
              <h4 className="text-sm font-bold text-white">Celdas de Asentamiento & Extensómetros</h4>
              <p className="text-xs text-slate-400">Monitoreo de deformación vertical en fundaciones, presas de relaves y rellenos masivos.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-orange-400 uppercase font-bold">SÍSMICA & VIBRACIONES</span>
              <h4 className="text-sm font-bold text-white">Acelerógrafos Triaxiales & Sismógrafos</h4>
              <p className="text-xs text-slate-400">Registro de aceleración del suelo por tronaduras y eventos telúricos con integración IGP.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-orange-400 uppercase font-bold">INCLINACIÓN & ESTRUCTURAS</span>
              <h4 className="text-sm font-bold text-white">Tiltmeter Triaxial & Sensores de Grietas</h4>
              <p className="text-xs text-slate-400">Monitoreo de apertura de grietas y rotaciones angulares en infraestructura crítica.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-orange-400 uppercase font-bold">CALIBRACIÓN</span>
              <h4 className="text-sm font-bold text-white">Purgador de Celdas & Analizadores VW</h4>
              <p className="text-xs text-slate-400">Equipos de mantenimiento y verificación de la integridad de sensores en campo.</p>
            </div>
          </div>
        )}

        {/* TAB 2: HÍDRICO */}
        {activeTab === 'hidrico' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fadeIn">
            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-cyan-400 uppercase font-bold">NIVEL Y VELOCIDAD</span>
              <h4 className="text-sm font-bold text-white">Sensores de Nivel, Velocidad y Flujo de H₂O</h4>
              <p className="text-xs text-slate-400">Medición de caudal en canales abiertos, vertimientos y cuerpos de agua.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-cyan-400 uppercase font-bold">CALIDAD DE AGUA</span>
              <h4 className="text-sm font-bold text-white">Sondas Multiparámetro & Sensores TSS</h4>
              <p className="text-xs text-slate-400">Control de sólidos suspendidos totales (TSS), turbidez y temperatura en efluentes.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-cyan-400 uppercase font-bold">FISICOQUÍMICO</span>
              <h4 className="text-sm font-bold text-white">Conductividad Electromagnética & pH</h4>
              <p className="text-xs text-slate-400">Supervisión continua de calidad de agua subterránea y drenaje ácido de roca.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-cyan-400 uppercase font-bold">FLUTO Y CAUDAL</span>
              <h4 className="text-sm font-bold text-white">Caudalímetros Magnéticos & Ultrasónicos</h4>
              <p className="text-xs text-slate-400">Medición de flujo en tuberías de transporte de agua, relaves y reactivos.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-cyan-400 uppercase font-bold">BOMBEO & POZOS</span>
              <h4 className="text-sm font-bold text-white">Automatización de Pozos & Bombas Sumergibles</h4>
              <p className="text-xs text-slate-400">Control automático de arranque y parada de bombas según niveles freáticos.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-cyan-400 uppercase font-bold">HIDROMETRÍA</span>
              <h4 className="text-sm font-bold text-white">Estaciones Hidrométricas Autónomas</h4>
              <p className="text-xs text-slate-400">Estaciones completas con medición de nivel de pozo, regletas y telemetría.</p>
            </div>
          </div>
        )}

        {/* TAB 3: AMBIENTAL */}
        {activeTab === 'ambiental' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fadeIn">
            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold">METEOROLOGÍA COMPLETA</span>
              <h4 className="text-sm font-bold text-white">Estaciones Meteorológicas Automatizadas</h4>
              <p className="text-xs text-slate-400">Viento (velocidad/dirección), pluviometría, temperatura, humedad y radiación neta.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold">MONITOREO DE METALES</span>
              <h4 className="text-sm font-bold text-white">Analizador de Metales en Línea (Cu, Pb, Zn)</h4>
              <p className="text-xs text-slate-400">Análisis espectrométrico continuo de concentración de metales pesados en agua.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold">ALERTA TORMENTAS</span>
              <h4 className="text-sm font-bold text-white">Campo Eléctrico Atmosférico</h4>
              <p className="text-xs text-slate-400">Detección temprana de riesgo de descargas eléctricas y rayos para la seguridad del personal.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold">EVAPORACIÓN & BALANACE</span>
              <h4 className="text-sm font-bold text-white">Tanques de Evaporación & Presión Barométrica</h4>
              <p className="text-xs text-slate-400">Datos fundamentales para el balance hídrico de la cuenca minera.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold">PARTÍCULAS & POLVO</span>
              <h4 className="text-sm font-bold text-white">Monitoreo de Calidad de Aire (PM10 / PM2.5)</h4>
              <p className="text-xs text-slate-400">Sensores de polvo en suspensión en caminos de acarreo y chancado.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold">CALIDAD DE AGUA</span>
              <h4 className="text-sm font-bold text-white">Turbidímetros & Sondas de Radiación Neta</h4>
              <p className="text-xs text-slate-400">Verificación de cumplimiento de Estándares de Calidad Ambiental (ECA).</p>
            </div>
          </div>
        )}

        {/* TAB 4: GEOESPACIAL */}
        {activeTab === 'geoespacial' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fadeIn">
            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-purple-400 uppercase font-bold">TOPOGRAFÍA AUTOMÁTICA</span>
              <h4 className="text-sm font-bold text-white">Estaciones Robóticas & Prismas</h4>
              <p className="text-xs text-slate-400">Monitoreo continuo automatizado de prismas en taludes de tajo abierto.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-purple-400 uppercase font-bold">RADARES DE TALUD</span>
              <h4 className="text-sm font-bold text-white">Estaciones Radáricas GB-SAR & Radar de Tráfico</h4>
              <p className="text-xs text-slate-400">Supervisión interferométrica sub-milimétrica de estabilidad de paredes en tajo.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-purple-400 uppercase font-bold">ESCÁNERES 3D</span>
              <h4 className="text-sm font-bold text-white">Scanner 3D para Túneles & Superficie</h4>
              <p className="text-xs text-slate-400">Levantamientos tridimensionales de avances en socavón y cavidades subterráneas.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-purple-400 uppercase font-bold">CÁMARAS MESH</span>
              <h4 className="text-sm font-bold text-white">FlatMesh Cámara & Mapeo Geológico</h4>
              <p className="text-xs text-slate-400">Captura visual inteligente con transmisión inalámbrica de baja potencia.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-purple-400 uppercase font-bold">LEVANTAMIENTO CON DRON</span>
              <h4 className="text-sm font-bold text-white">Topografía Espacial con Dron / UAV</h4>
              <p className="text-xs text-slate-400">Generación de fotogrametría y modelos ortofoto de alta resolución para minería.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-purple-400 uppercase font-bold">BATIMETRÍA</span>
              <h4 className="text-sm font-bold text-white">Bote Batimétrico No Tripulado</h4>
              <p className="text-xs text-slate-400">Mapeo del fondo y volumen útil en lagunas de relave y depósitos hídricos.</p>
            </div>
          </div>
        )}

        {/* TAB 5: TELEMETRÍA & FOTOVOLTAICO */}
        {activeTab === 'telemetria' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fadeIn">
            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">DATALOGGER BEEMETRY</span>
              <h4 className="text-sm font-bold text-white">Nodos Dataloggers Industriales BEEMETRY</h4>
              <p className="text-xs text-slate-400">Soporte multicanal (RS485, Modbus, SDI-12, VW, 4-20mA) con gabinete hermético IP67.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">REDES MESH INDUSTRIAL</span>
              <h4 className="text-sm font-bold text-white">Tecnología Mesh Rajant & Freewave</h4>
              <p className="text-xs text-slate-400">Comunicaciones inalámbricas auto-sanables para terrenos accidentados sin línea de vista.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">AUTONOMÍA SOLAR</span>
              <h4 className="text-sm font-bold text-white">Módulos de Adquisición Autónoma Fotovoltaica</h4>
              <p className="text-xs text-slate-400">Estaciones equipadas con panel solar, baterías de ciclo profundo, vigilancia y pararrayos.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">DATALOGGERS GLOBALES</span>
              <h4 className="text-sm font-bold text-white">Campbell Scientific & Ackcio / Senceive</h4>
              <p className="text-xs text-slate-400">Integración nativa con registradores CR6, CR1000X y gateways Ackcio/Senceive.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">REDES LORA / IOT</span>
              <h4 className="text-sm font-bold text-white">WorldSensing / LoadSensing & Sensemetrics</h4>
              <p className="text-xs text-slate-400">Nodos de ultra bajo consumo con transmisión inalámbrica de hasta 10 km.</p>
            </div>

            <div className="bg-[#0b1322] border border-slate-800 p-4 rounded-xl space-y-2">
              <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">PROTECCIÓN AMBIENTAL</span>
              <h4 className="text-sm font-bold text-white">Casetas de Instrumentación & Pararrayos</h4>
              <p className="text-xs text-slate-400">Diseño reforzado para altitudes superiores a 4,500 msnm con calefacción interna.</p>
            </div>
          </div>
        )}

      </div>
    </section>
  );
};
