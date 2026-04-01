import React, { useEffect, useRef, useState } from 'react'
import {
    Activity,
    Compass,
    Download,
    Share2,
    Clock,
    Settings,
    Layers,
    FileText,
    Map as MapIcon,
    LogOut,
    BarChart2,
    Layout,
    ShieldCheck,
    Sparkles,
    Users,
} from 'lucide-react'
    // Hubspot is removed as it is not available in lucide-react
import { motion, AnimatePresence } from 'framer-motion'
import AnimatedButton from './components/UI/AnimatedButton'
import InclinometerCharts from './components/Special/InclinometerCharts'
import Viewer3D from './components/Viewer/Viewer3D'
import MapViewer from './components/Special/MapViewer'
import DetailedMap from './components/Special/DetailedMap'
import AzimuthCompass from './components/Special/AzimuthCompass'
import DisplacementCharts from './components/Special/DisplacementCharts'
import MiningDashboard from './components/Dashboard/MiningDashboard'
import VideoDiagram from './components/Special/VideoDiagram'
import QRGenerator from './components/Special/QRGenerator'
import RichTextEditor from './components/Editor/RichTextEditor'
import AuthGateway from './components/Auth/AuthGateway'
import AuditCenter from './components/Auth/AuditCenter'
import AdvancedSensors from './components/Dashboard/AdvancedSensors'
import ReportStudioV2 from './components/ReportStudioV2/App'
import UserMaintenanceModal from './components/ReportStudioV2/components/modals/UserMaintenanceModal'
import { ensureCompanyUsers } from './components/ReportStudioV2/lib/userBootstrap'
import { clearSession, getSession, createSession } from './auth/authStorage'

const DashboardApp = ({ session, onLogout }) => {
    const mainScrollRef = useRef(null)
    const [activeTab, setActiveTab] = useState('Dashboard')
    const [sidebarTab, setSidebarTab] = useState('Azimuth')
    const [azimuthAngle, setAzimuthAngle] = useState(45)
    const [installationAngle, setInstallationAngle] = useState(55)
    const [azimuthOffset, setAzimuthOffset] = useState(true)
    const [dbStatus, setDbStatus] = useState('Sincronizado')
    const [showMenu, setShowMenu] = useState(false)
    const [showQR, setShowQR] = useState(false)
    const [showAuditCenter, setShowAuditCenter] = useState(false)
    const [showUserMaintenance, setShowUserMaintenance] = useState(false)
    const [showUserMaintenancePrompt, setShowUserMaintenancePrompt] = useState(false)
    const [mainScrollHints, setMainScrollHints] = useState({ right: false, bottom: false })
    const isAdmin = (session?.role || '').toLowerCase() === 'admin'
    const isCompanyLogin = session?.loginType === 'company'
    const canMaintain = isCompanyLogin && (isAdmin || (session?.role || '').toLowerCase() === 'supervisor')

    // Ensure company users are bootstrapped on login
    useEffect(() => {
        if (session?.company) {
            ensureCompanyUsers(session.company)
        }
    }, [session?.company])

    useEffect(() => {
        if (session?.company && canMaintain) {
            setShowUserMaintenancePrompt(true)
        } else {
            setShowUserMaintenancePrompt(false)
        }
    }, [session?.company, canMaintain])

    // Scale states
    const [xMin, setXMin] = useState(-40)
    const [xMax, setXMax] = useState(40)
    const [yMin, setYMin] = useState(0)
    const [yMax, setYMax] = useState(40)
    const [showTitles, setShowTitles] = useState(true)

    const rightSidebarTabs = ['Inclinometer', 'Displacement Cumulative', '3D', 'Surveillance']
    const showRightSidebar = rightSidebarTabs.includes(activeTab)

    useEffect(() => {
        const updateMainScrollHints = () => {
            const el = mainScrollRef.current
            if (!el) return

            const epsilon = 2
            const hasHorizontalOverflow = el.scrollWidth - el.clientWidth > epsilon
            const hasVerticalOverflow = el.scrollHeight - el.clientHeight > epsilon
            const canScrollRight = hasHorizontalOverflow && (el.scrollLeft + el.clientWidth < el.scrollWidth - epsilon)
            const canScrollBottom = hasVerticalOverflow && (el.scrollTop + el.clientHeight < el.scrollHeight - epsilon)

            setMainScrollHints({ right: canScrollRight, bottom: canScrollBottom })
        }

        updateMainScrollHints()

        const onResize = () => updateMainScrollHints()
        window.addEventListener('resize', onResize)

        let observer = null
        if (typeof ResizeObserver !== 'undefined' && mainScrollRef.current) {
            observer = new ResizeObserver(() => updateMainScrollHints())
            observer.observe(mainScrollRef.current)
            if (mainScrollRef.current.firstElementChild) {
                observer.observe(mainScrollRef.current.firstElementChild)
            }
        }

        return () => {
            window.removeEventListener('resize', onResize)
            if (observer) {
                observer.disconnect()
            }
        }
    }, [activeTab, showRightSidebar])

    const tabs = [
        {
            name: 'Dashboard',
            label: 'Overview',
            icon: Activity,
            badge: 'Live',
            tip: 'Resumen ejecutivo de KPIs operativos y tendencia diaria.'
        },
        {
            name: 'Sensores Técnicos',
            label: 'Sensores',
            icon: BarChart2,
            tip: 'Telemetria tecnica por tipo de sensor y estado de calidad.'
        },
        {
            name: 'Inclinometer',
            label: 'Inclinometro',
            icon: Activity,
            tip: 'Monitorea deformacion, azimut y estabilidad en campo.'
        },
        {
            name: 'Displacement Cumulative',
            label: 'Desplazamiento',
            icon: Layers,
            tip: 'Vista acumulada de desplazamientos para analisis estructural.'
        },
        {
            name: '3D',
            label: 'Escena 3D',
            icon: FileText,
            tip: 'Explora la mina en entorno 3D con orientacion instrumental.'
        },
        {
            name: 'Map',
            label: 'Mapa Base',
            icon: MapIcon,
            tip: 'Mapa satelital rapido para navegacion operacional.'
        },
        {
            name: 'Mapa Detallado',
            label: 'Mapa Detallado',
            icon: Layers,
            badge: 'Pro',
            tip: 'Carga capas MBTiles detalladas y revisa zonas criticas.'
        },
        {
            name: 'Surveillance',
            label: 'Vigilancia',
            icon: Compass,
            tip: 'Panel de vigilancia con monitoreo visual de areas activas.'
        },
        {
            name: 'Report',
            label: 'Reporte',
            icon: FileText,
            tip: 'Editor principal para informes operativos de turno.'
        },
        {
            name: 'Report v2',
            label: 'Informe Minero',
            icon: Layout,
            badge: 'Beta',
            tip: 'Estudio avanzado de reportes multipagina y plantillas.'
        }
    ]

    return (
        <div className="dashboard-shell flex h-screen w-full bg-[#f8fafc] dark:bg-[#020617] text-slate-900 dark:text-slate-100 font-sans selection:bg-blue-500/30 overflow-hidden">

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0">

                {/* Top Header / Tab Bar */}
                <header className="relative px-4 lg:px-6 py-3 border-b border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 backdrop-blur-xl overflow-hidden">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_-120%,rgba(14,165,233,0.22),transparent_48%),radial-gradient(circle_at_84%_-130%,rgba(244,114,182,0.16),transparent_45%)]" />

                    <div className="relative z-10 flex items-center gap-3">
                        <div className="hidden xl:flex items-center gap-3 pl-1 pr-2">
                            <div className="top-brand-orb">
                                <Sparkles size={14} />
                            </div>
                            <div className="leading-tight">
                                <div className="top-brand-title">SENSOR3D Command</div>
                                <div className="top-brand-subtitle">UX Navigation Layer</div>
                            </div>
                        </div>

                        <div className="flex-1" />

                        <div className="hidden lg:flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-emerald-200/70 bg-emerald-50/70 text-[10px] text-emerald-700 font-semibold whitespace-nowrap">
                            <ShieldCheck size={12} />
                            <span>Stack online</span>
                        </div>

                        <div className="hidden md:flex items-center gap-3 text-[10px] text-slate-500 font-medium whitespace-nowrap">
                            <Clock size={12} />
                            <span>Jan 27 2018 - Apr 08 2025</span>
                        </div>

                        <div className="flex items-center gap-2 relative">
                        <div className="hidden md:flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-300">
                            <span className="font-bold">{session?.fullName || 'Usuario'}</span>
                            <span className="text-slate-400">{session?.company || 'Empresa'}</span>
                        </div>
                        {canMaintain && (
                            <button
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-indigo-300 bg-indigo-900/30 border border-indigo-700/50 hover:bg-indigo-800/50 hover:text-indigo-100 transition-all duration-200 text-[11px] font-bold whitespace-nowrap"
                                onClick={() => setShowUserMaintenance(true)}
                                title="Mantenimiento de usuarios de la plataforma"
                            >
                                <Users size={13} />
                                <span className="hidden lg:inline">Usuarios</span>
                            </button>
                        )}
                        <button
                            className="p-2.5 rounded-xl text-blue-500 bg-blue-50/90 border border-blue-200/70 hover:bg-blue-100 dark:bg-blue-900/20 dark:border-blue-900/40 dark:hover:bg-blue-900/30 transition-all duration-200"
                            onClick={() => setShowQR(true)}
                            title="Exportar captura para reporte"
                        >
                            <Download size={16} />
                        </button>
                        <button
                            className="p-2.5 rounded-xl text-slate-500 border border-slate-200/80 bg-white/80 hover:bg-slate-100 dark:text-slate-300 dark:border-slate-700 dark:bg-slate-800/70 dark:hover:bg-slate-700 transition-all duration-200"
                            onClick={() => setShowMenu(!showMenu)}
                            title="Opciones rapidas"
                        >
                            <Share2 size={16} />
                        </button>
                        {isAdmin && (
                            <button
                                className="p-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg text-indigo-500"
                                onClick={() => setShowAuditCenter(true)}
                                title="Abrir auditoria"
                            >
                                <FileText size={16} />
                            </button>
                        )}
                        <button
                            className="flex items-center gap-2 px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 bg-red-50/50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg text-red-600 dark:text-red-400 font-bold text-[11px] transition-colors"
                            onClick={onLogout}
                            title="Cerrar sesion"
                        >
                            <LogOut size={14} />
                            <span>Salir</span>
                        </button>

                        {showMenu && (
                            <div className="absolute top-12 right-0 w-36 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden p-1">
                                <button className="w-full flex items-center gap-3 px-3 py-2 text-[11px] font-bold text-slate-600 dark:text-slate-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 rounded-lg transition-colors text-left">
                                    <Settings size={14} /> Edit
                                </button>
                                <div className="h-[1px] bg-slate-100 dark:bg-slate-800 my-1 mx-2" />
                                <button className="w-full flex items-center gap-3 px-3 py-2 text-[11px] font-bold text-slate-600 dark:text-slate-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 rounded-lg transition-colors text-left">
                                    <Download size={14} /> Download
                                </button>
                            </div>
                        )}
                        </div>
                    </div>

                    <div className="relative z-10 mt-3">
                        <div className="top-nav-shell top-nav-shell--wrap">
                            {tabs.map(t => {
                                const Icon = t.icon
                                const isActive = activeTab === t.name
                                return (
                                    <div key={t.name} className="tab-chip-wrap">
                                        <button
                                            onClick={() => setActiveTab(t.name)}
                                            className={`tab-button tab-button--premium ${isActive ? 'tab-button--active' : ''}`}
                                            aria-label={`Abrir ${t.name}`}
                                        >
                                            <span className="tab-icon-ring">
                                                <Icon size={13} />
                                            </span>
                                            <span>{t.label || t.name}</span>
                                            {t.badge && <span className="tab-pill">{t.badge}</span>}
                                        </button>
                                        <div className="tab-tooltip">{t.tip}</div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </header>

                {/* Dynamic Visualization Bench */}
                <main className="flex-1 relative flex bg-white min-h-0 overflow-hidden">
                    <div
                        ref={mainScrollRef}
                        onScroll={() => {
                            const el = mainScrollRef.current
                            if (!el) return

                            const epsilon = 2
                            const hasHorizontalOverflow = el.scrollWidth - el.clientWidth > epsilon
                            const hasVerticalOverflow = el.scrollHeight - el.clientHeight > epsilon
                            const canScrollRight = hasHorizontalOverflow && (el.scrollLeft + el.clientWidth < el.scrollWidth - epsilon)
                            const canScrollBottom = hasVerticalOverflow && (el.scrollTop + el.clientHeight < el.scrollHeight - epsilon)

                            setMainScrollHints({ right: canScrollRight, bottom: canScrollBottom })
                        }}
                        className="flex-1 min-w-0 min-h-0 overflow-auto dashboard-main-scroll relative"
                    >
                        {mainScrollHints.right && (
                            <>
                                <div className="pointer-events-none absolute inset-y-0 right-0 w-8 z-20 bg-gradient-to-l from-slate-900/20 to-transparent" />
                                <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 z-30 rounded-full bg-slate-900/75 text-white text-[10px] px-2 py-1 shadow-lg backdrop-blur-sm">
                                    Desplazar →
                                </div>
                            </>
                        )}

                        {mainScrollHints.bottom && (
                            <>
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 z-20 bg-gradient-to-t from-slate-900/20 to-transparent" />
                                <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 z-30 rounded-full bg-slate-900/75 text-white text-[10px] px-2 py-1 shadow-lg backdrop-blur-sm">
                                    Desplazar ↓
                                </div>
                            </>
                        )}

                        {activeTab === 'Inclinometer' && (
                            <InclinometerCharts
                                xRange={[xMin, xMax]}
                                yRange={[yMin, yMax]}
                                azimuthAngle={azimuthAngle}
                                installationAngle={installationAngle}
                            />
                        )}
                        {activeTab === '3D' && <Viewer3D azimuthAngle={azimuthAngle} installationAngle={installationAngle} />}
                        {activeTab === 'Map' && <MapViewer />}
                        {activeTab === 'Mapa Detallado' && <DetailedMap />}
                        { activeTab === 'Dashboard' && <MiningDashboard />}
                        { activeTab === 'Sensores Técnicos' && <AdvancedSensors />}
                        { activeTab === 'Surveillance' && <VideoDiagram src="" />}
                        {activeTab === 'Displacement Cumulative' && (
                            <DisplacementCharts xRange={[xMin, xMax]} yRange={[yMin, yMax]} />
                        )}
                        {activeTab === 'Report' && <RichTextEditor />}
                        {activeTab === "Report v2" && <ReportStudioV2 />}
                    </div>

                    {/* Temporal Legend Sidebar (Inside Main View) */}
                    {(activeTab === 'Inclinometer' || activeTab === '3D') && (
                        <div className="w-48 border-l border-slate-100 bg-white p-4 flex flex-col gap-2 overflow-y-auto">
                            {[
                                '04/08/2025 06:00 PM', '09/01/2024 06:00 PM', '01/27/2024 12:00 AM',
                                '08/13/2023 12:00 AM', '12/08/2022 09:52 AM', '05/04/2022 10:42 AM',
                                '09/11/2021 03:17 PM', '01/29/2021 10:49 AM', '06/27/2020 04:05 PM',
                                '11/22/2019 11:30 AM', '07/26/2019 10:03 AM', '06/07/2018 03:35 PM',
                                '01/27/2018 12:52 PM'
                            ].map((t, i) => (
                                <div key={t} className="flex items-center gap-2 text-[9px] text-slate-500 hover:text-slate-800 cursor-default transition-colors">
                                    <div
                                        className="w-2 h-0.5 rounded-full"
                                        style={{
                                            backgroundColor: [
                                                '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e',
                                                '#06b6d4', '#84cc16', '#a855f7', '#6366f1', '#14b8a6', '#f97316', '#64748b'
                                            ][i % 13]
                                        }}
                                    />
                                    <span className="truncate">{t}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </main>
            </div>

            {/* Right Sidebar: Edit Profile */}
            <AnimatePresence>
                {showRightSidebar && (
                    <motion.aside
                        initial={{ x: 20, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: 20, opacity: 0 }}
                        transition={{ duration: 0.24 }}
                        className="w-80 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-y-auto sidebar-motion"
                    >
                        <div className="p-6 space-y-6">
                            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Edit profile</h2>

                            <div className="flex border-b border-slate-100 dark:border-slate-800">
                                {['Appearance', 'Layers', 'Azimuth'].map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setSidebarTab(tab)}
                                        className={`flex-1 py-1 text-[11px] font-bold transition-all relative ${sidebarTab === tab ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                    >
                                        {tab}
                                        {sidebarTab === tab && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-600 dark:bg-blue-400 rounded-full" />}
                                    </button>
                                ))}
                            </div>

                            {sidebarTab === 'Appearance' && (
                                <div className="space-y-8">
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[11px] text-slate-600 font-medium">X Plot</span>
                                            <div className="flex items-center gap-1">
                                                <input type="number" value={xMin} onChange={(e) => setXMin(parseInt(e.target.value))} className="w-12 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-1 text-[10px] text-center font-mono" />
                                                <span className="text-[10px] text-slate-400">mm to</span>
                                                <input type="number" value={xMax} onChange={(e) => setXMax(parseInt(e.target.value))} className="w-12 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-1 text-[10px] text-center font-mono" />
                                                <span className="text-[10px] text-slate-400">mm</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {sidebarTab === 'Azimuth' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <Activity size={14} />
                                            <span className="text-[11px]">X° angle</span>
                                        </div>
                                        <input type="number" value={installationAngle} onChange={(e) => setInstallationAngle(parseInt(e.target.value) || 0)} className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-[11px] text-right font-mono focus:ring-1 focus:ring-blue-500 outline-none" />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <Compass size={14} />
                                            <span className="text-[11px]">Azimuth offset</span>
                                        </div>
                                        <button onClick={() => setAzimuthOffset(!azimuthOffset)} className={`w-8 h-4 rounded-full transition-colors relative ${azimuthOffset ? 'bg-blue-600' : 'bg-slate-300'}`}>
                                            <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${azimuthOffset ? 'translate-x-4' : ''}`} />
                                        </button>
                                    </div>
                                    <AzimuthCompass angle={installationAngle + azimuthAngle} offset={installationAngle} showOffset={azimuthOffset} />
                                    <div className="space-y-3">
                                        <div className="text-slate-400 text-[10px] font-semibold uppercase tracking-wider">X° offset angle</div>
                                        <div className="flex items-center gap-4">
                                            <input type="range" min="0" max="360" value={azimuthAngle} onChange={(e) => setAzimuthAngle(parseInt(e.target.value))} className="flex-1 accent-blue-600" />
                                            <span className="text-[11px] font-mono w-8 text-right text-slate-600">{azimuthAngle}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {sidebarTab !== 'Azimuth' && <div className="py-12 text-center text-slate-400 text-[11px] italic">Configuraciones de {sidebarTab}...</div>}
                        </div>

                        <div className="mt-auto p-6 border-t border-slate-100 dark:border-slate-800">
                            <AnimatedButton className="w-full justify-center" onClick={() => {}}>Save</AnimatedButton>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>
            {/* Database Status Indicator (Floating) */}
            <div className="absolute bottom-4 right-84 z-50 flex items-center gap-2 px-3 py-1.5 bg-white/80 dark:bg-slate-900/80 backdrop-blur rounded-full border border-slate-200 dark:border-slate-800 shadow-sm text-[10px]">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="font-bold text-slate-600 dark:text-slate-400">DB: {dbStatus}</span>
            </div>

            {/* QR Modal */}
            {showQR && <QRGenerator reportId="RAURA-2025-001" onClose={() => setShowQR(false)} />}
            {isAdmin && (
                <AuditCenter
                    open={showAuditCenter}
                    onClose={() => setShowAuditCenter(false)}
                    defaultCompany={session?.company}
                />
            )}
            {canMaintain && showUserMaintenance && (
                <UserMaintenanceModal onClose={() => setShowUserMaintenance(false)} />
            )}
            {canMaintain && showUserMaintenancePrompt && (
                <div className="fixed inset-0 z-[1100] bg-slate-950/55 backdrop-blur-[2px] flex items-center justify-center px-4">
                    <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
                        <div className="px-6 py-5 border-b border-slate-200 bg-gradient-to-r from-sky-50 via-white to-indigo-50">
                            <h3 className="text-base font-extrabold text-slate-800">Mantenimiento de Usuarios</h3>
                            <p className="mt-1 text-sm text-slate-600">
                                Se ha iniciado sesion correctamente para <strong>{session?.company || 'la unidad minera'}</strong>.
                            </p>
                        </div>
                        <div className="px-6 py-5 text-sm text-slate-700">
                            Desea realizar el mantenimiento de usuarios asignados a esta unidad minera ahora?
                        </div>
                        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
                            <button
                                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100 transition-colors"
                                onClick={() => setShowUserMaintenancePrompt(false)}
                            >
                                Ahora no
                            </button>
                            <button
                                className="px-4 py-2 rounded-lg border border-indigo-700 bg-indigo-700 text-white font-semibold hover:bg-indigo-800 transition-colors"
                                onClick={() => {
                                    setShowUserMaintenancePrompt(false)
                                    setShowUserMaintenance(true)
                                }}
                            >
                                Si, abrir mantenimiento
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

const App = () => {
    const [session, setSession] = useState(() => {
        return getSession()
    })

    if (!session) {
        return <AuthGateway onAuthenticated={setSession} />
    }

    return (
        <DashboardApp
            session={session}
            onLogout={() => {
                clearSession()
                setSession(null)
            }}
        />
    )
}

export default App
