import React, { useEffect, useRef, useState } from 'react'
import {
    Activity,
    ArrowLeft,
    Compass,
    Clock,
    Layers,
    FileText,
    Map as MapIcon,
    Globe2,
    LogOut,
    BarChart2,
    Layout,
    ShieldCheck,
    Users,
    UserRound,
    Sigma,
    BellRing,
    Radio,
} from 'lucide-react'
    // Hubspot is removed as it is not available in lucide-react
import { motion, AnimatePresence } from 'framer-motion'
import AnimatedButton from './components/UI/AnimatedButton'
import InclinometerCharts from './components/Special/InclinometerCharts'
import Viewer3D from './components/Viewer/Viewer3D'
import MapViewer from './components/Special/MapViewer'
import MiningGeoportalView from './components/Special/MiningGeoportalView'
import DetailedMap from './components/Special/DetailedMap'
import AzimuthCompass from './components/Special/AzimuthCompass'
import DisplacementCharts from './components/Special/DisplacementCharts'
import MiningDashboard from './components/Dashboard/MiningDashboard'
import VideoDiagram from './components/Special/VideoDiagram'
import RichTextEditor from './components/Editor/RichTextEditor'
import AuthGateway from './components/Auth/AuthGateway'
import AuditCenter from './components/Auth/AuditCenter'
import AdvancedSensors from './components/Dashboard/AdvancedSensors'
import AlarmCenter from './components/Dashboard/AlarmCenter'
import TelemetryDashboard from './components/Dashboard/TelemetryDashboard'
import GeotechWorkbench from './components/Dashboard/GeotechWorkbench'
import ReportStudioV2 from './components/ReportStudioV2/App'
import FormulaEngineEmbed from './components/Formula/FormulaEngineEmbed'
import UserMaintenanceModal from './components/ReportStudioV2/components/modals/UserMaintenanceModal'
import UserManagementView from './components/ReportStudioV2/components/views/UserManagementView'
import PermissionsManagementView from './components/ReportStudioV2/components/views/PermissionsManagementView'
import { PlatformBrandDashboardBlock } from './brand/PlatformBrandMark'
import { ensureCompanyUsers } from './components/ReportStudioV2/lib/userBootstrap'
import { clearSession, getSession, createSession } from './auth/authStorage'
import { telemetryTenantIdFromSession } from './auth/telemetryTenant'

/** Etiquetas UI + tenant UUID único para APIs de telemetría/CCTV. */
function telemetryScopeFromSession(sess) {
    const demoCompany = 'ACTIVOS MINEROS'
    const demoUnit = 'UNIDAD PRINCIPAL'
    const rawCo = (sess?.company || sess?.miningCompany || '').trim()
    const rawUnit = (sess?.miningUnit || sess?.unitName || sess?.mineUnit || sess?.site || '').trim()
    const company = rawCo || demoCompany
    let unit = rawUnit || demoUnit
    if (/primcipal/i.test(unit) || /^unidad\s*prin?c?ipal$/i.test(unit)) {
        unit = demoUnit
    }
    return {
        miningCompanyName: company,
        siteUnitName: unit,
        telemetryTenantId: telemetryTenantIdFromSession(sess),
    }
}

/** Base64 guardado en BD/sesión: sin espacios ni saltos de línea. */
function normalizeSessionAvatarBase64(sess) {
    const raw = sess?.avatarCartoonBase64
    if (typeof raw !== 'string') return null
    const b64 = raw.replace(/\s/g, '')
    return b64.length > 0 ? b64 : null
}

function sessionAvatarDataUrlFromB64(b64) {
    if (!b64) return null
    if (b64.startsWith('iVBOR')) return `data:image/png;base64,${b64}`
    if (b64.startsWith('/9j')) return `data:image/jpeg;base64,${b64}`
    return `data:image/png;base64,${b64}`
}

const DashboardApp = ({ session, onLogout }) => {
    const telemetryScope = telemetryScopeFromSession(session)
    const mainScrollRef = useRef(null)
    const [activeTab, setActiveTab] = useState('Dashboard')
    const [sidebarTab, setSidebarTab] = useState('Azimuth')
    const [azimuthAngle, setAzimuthAngle] = useState(45)
    const [installationAngle, setInstallationAngle] = useState(55)
    const [azimuthOffset, setAzimuthOffset] = useState(true)
    const [dbStatus, setDbStatus] = useState('Sincronizado')
    const [activeMainMenu, setActiveMainMenu] = useState('monitoreo')
    const [navLevel, setNavLevel] = useState('main')
    const [showAuditCenter, setShowAuditCenter] = useState(false)
    const [showUserMaintenance, setShowUserMaintenance] = useState(false)
    const [showUserMaintenancePrompt, setShowUserMaintenancePrompt] = useState(false)
    const [mainScrollHints, setMainScrollHints] = useState({ right: false, bottom: false })
    const isAdmin = (session?.role || '').toLowerCase() === 'admin'
    const isSupervisor = (session?.role || '').toLowerCase() === 'supervisor'
    const canMaintain = isAdmin || isSupervisor
    const [currentDateLabel] = useState(() =>
        new Intl.DateTimeFormat('es-PE', {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date())
    )
    const [avatarImageFailed, setAvatarImageFailed] = useState(false)
    const avatarB64 = normalizeSessionAvatarBase64(session)
    const headerAvatarDataUrl = sessionAvatarDataUrlFromB64(avatarB64)

    useEffect(() => {
        setAvatarImageFailed(false)
    }, [avatarB64, session?.username])
    const platformCompanyName = session?.platformCompany || session?.ownerCompany || 'AURIXA'
    const miningCompanyName = session?.company || session?.miningCompany || 'Empresa minera'
    const miningUnitName =
        session?.miningUnit ||
        session?.unitName ||
        session?.mineUnit ||
        session?.site ||
        'Unidad principal'

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

    // Panel "Edit profile" (azimuth, etc.): solo vistas que lo necesitan. Videovigilancia usa todo el ancho para el muro CCTV.
    const rightSidebarTabs = ['Inclinometer', 'Displacement Cumulative', '3D']
    const showRightSidebar = rightSidebarTabs.includes(activeTab)
    const geotechTabNames = ['Inclinometer', 'Displacement Cumulative', '3D']
    const isGeotechView = geotechTabNames.includes(activeTab)
    /** Mapas/Leaflet: bloquear scroll del contenedor para evitar doble scroll y huecos. */
    const mapCentricTabNames = ['Map', 'MiningGeoportal', 'ComplianceGeo', 'Mapa Detallado']
    /**
     * Editores a pantalla completa con cinta de herramientas propia: si el panel central hace scroll
     * vertical, el lienzo se desplaza y la barra de diseño puede quedar fuera de vista.
     * El scroll debe quedar solo dentro del editor (.page-scroll / iframe).
     */
    const fullBleedWorkbenchTabNames = ['Report v2', 'Report', 'Formula']
    const lockMainScrollViewport =
        mapCentricTabNames.includes(activeTab) || fullBleedWorkbenchTabNames.includes(activeTab)
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

    /**
     * Mapa de menús — mejoras integradas (frontend + backend C++ mapas_backend):
     *
     * | Menú principal (enterpriseGroups) | Pestañas | Backend / datos en tiempo real |
     * |-----------------------------------|----------|--------------------------------|
     * | Monitoreo en tiempo real          | Centro de Control, Sensores, CCTV      | API telemetría / Postgres |
     * | Geotecnia y modelado 3D           | Talud, Desplazamiento, Gemelo 3D         | Solo cliente (ECharts/R3F) |
     * | Mapas de faena y HD               | Mapa satelital, Mapa geotécnico HD     | /api/map/markers (C++→Postgres) |
     * | Territorio y cumplimiento GIS     | Geoservidor minero, Cumplimiento       | WMS + /api/map/official-zones, /api/map/compliance-intersections (C++ + GeoJSON en /data) |
     * | Ingeniería y reportabilidad       | Fórmula, redactores, Informe técnico    | APIs informes / formula_engine |
     */
    const tabs = [
        {
            name: 'Dashboard',
            label: 'Centro de Control',
            icon: Activity,
            glyph: 'KPI',
            badge: 'Live',
            tip: 'Resumen ejecutivo de indicadores operativos y productividad de mina.'
        },
        {
            name: 'Sensores Técnicos',
            label: 'Sensores de Mina',
            icon: BarChart2,
            glyph: 'IoT',
            tip: 'Telemetría de instrumentación, calidad de dato y estado por sensor.'
        },
        {
            name: 'Inclinometer',
            label: 'Estabilidad de Talud',
            icon: Activity,
            glyph: 'GEO',
            tip: 'Monitoreo geotécnico de inclinación, deformación y alertas tempranas.'
        },
        {
            name: 'Displacement Cumulative',
            label: 'Desplazamiento Acumulado',
            icon: Layers,
            glyph: 'MOV',
            tip: 'Evolución histórica de desplazamientos para análisis estructural.'
        },
        {
            name: '3D',
            label: 'Gemelo 3D Mina',
            icon: FileText,
            glyph: '3D',
            tip: 'Visualización 3D interactiva del frente minero e instrumentación.'
        },
        {
            name: 'Map',
            label: 'Mapa Satelital',
            icon: MapIcon,
            glyph: 'MAP',
            tip: 'Operación en mapa: marcadores vía API C++ (/api/map/markers), capas WMS, GeoJSON oficial y cumplimiento.'
        },
        {
            name: 'MiningGeoportal',
            label: 'Geoservidor Minero',
            icon: Globe2,
            glyph: 'GIS',
            badge: 'Hub',
            tip: 'Hub GIS minero (módulos A–F): concepto, enlaces INGEMMET/MINEM/MINAM y visor Leaflet con presets WMS; datos operativos en vivo desde el mismo backend C++.'
        },
        {
            name: 'ComplianceGeo',
            label: 'Cumplimiento Territorial',
            icon: ShieldCheck,
            glyph: 'REG',
            badge: 'Pro',
            tip: 'Semáforo y checklist + cruce activo↔polígono oficial: backend C++ (/api/map/compliance-intersections, /api/map/official-zones) y GeoJSON en volumen Docker /data.'
        },
        {
            name: 'Mapa Detallado',
            label: 'Mapa Geotécnico HD',
            icon: Layers,
            glyph: 'HD',
            badge: 'Pro',
            tip: 'Capas MBTiles de alta resolución para zonas críticas y detalle técnico.'
        },
        {
            name: 'Alarmas',
            label: 'Centro de Alarmas',
            icon: BellRing,
            glyph: 'ALM',
            badge: 'Live',
            tip: 'Motor de alarmas automáticas con umbrales, prioridades y creación de informes desde evento.'
        },
        {
            name: 'Surveillance',
            label: 'Video Vigilancia',
            icon: Compass,
            glyph: 'CAM',
            tip: 'Monitoreo visual de áreas activas con enfoque de seguridad operativa.'
        },
        {
            name: 'Telemetría',
            label: 'Dual-Stream',
            icon: Radio,
            glyph: 'TEL',
            badge: 'S2',
            tip: 'Dashboard dual-stream Kinesis+Kafka con monitoreo QuestDB y TimescaleDB en tiempo real.'
        },
        {
            name: 'Formula',
            label: 'Motor de Fórmula',
            icon: Sigma,
            glyph: 'AI',
            badge: 'NEW',
            tip: 'Ejecución del motor de cálculo minero para análisis y generación técnica.'
        },
        {
            name: 'Report',
            label: 'Redactor Técnico',
            icon: FileText,
            glyph: 'DOC',
            tip: 'Editor rápido para reportes operativos y novedades de turno.'
        },
        {
            name: 'Report v2',
            label: 'Informe Técnico',
            icon: Layout,
            glyph: 'PDF',
            badge: 'Beta',
            tip: 'Estudio corporativo avanzado de reportes multi-página y plantilla.'
        },
        {
            name: 'UserManagement',
            label: 'Mantenimiento Usuario',
            icon: Users,
            glyph: 'USR',
            tip: 'Gestión total de usuarios registrados, perfiles, claves y estados de acceso.'
        },
        {
            name: 'Permissions',
            label: 'Permisos y Accesos',
            icon: ShieldCheck,
            glyph: 'SEC',
            badge: 'Pro',
            tip: 'Matriz de configuración de permisos, niveles de acceso y autorizaciones por perfil.'
        }
    ]

    const enterpriseGroups = [
        {
            id: 'mantenimiento',
            title: 'Mantenimiento',
            icon: ShieldCheck,
            tip: 'Gestión administrativa de usuarios, seguridad y control de accesos.',
            items: ['UserManagement', 'Permissions'],
            navTag: 'ADM',
        },
        {
            id: 'monitoreo',
            title: 'Monitoreo en tiempo real',
            icon: Activity,
            tip: 'Seguimiento continuo de KPIs, sensores y vigilancia.',
            items: ['Dashboard', 'Sensores Técnicos', 'Alarmas', 'Surveillance', 'Telemetría'],
            navTag: 'LIVE',
        },
        {
            id: 'geotecnia',
            title: 'Geotecnia y modelado 3D',
            icon: Layers,
            tip: 'Análisis geotécnico, deformaciones y modelo tridimensional.',
            items: ['Inclinometer', 'Displacement Cumulative', '3D'],
            navTag: 'GEO',
        },
        {
            id: 'geoespacial_faena',
            title: 'Mapas de faena y HD',
            icon: MapIcon,
            tip: 'Mapa satelital operativo (API marcadores C++) y cartografía MBTiles de alta resolución.',
            items: ['Map', 'Mapa Detallado'],
            navTag: 'MAP',
        },
        {
            id: 'territorio_gis',
            title: 'Territorio y cumplimiento GIS',
            icon: Globe2,
            tip: 'Geoservidor minero (hub institucional WMS) y cumplimiento territorial con intersección GeoJSON + Postgres en backend C++.',
            items: ['MiningGeoportal', 'ComplianceGeo'],
            navTag: 'TIS',
        },
        {
            id: 'ingenieria',
            title: 'Ingeniería y reportabilidad',
            icon: Sigma,
            tip: 'Motor de cálculo y generación de informes técnicos y corporativos.',
            items: ['Formula', 'Report', 'Report v2'],
            navTag: 'DOC',
        }
    ]

    useEffect(() => {
        const groupForTab = enterpriseGroups.find((group) => group.items.includes(activeTab))
        if (groupForTab && groupForTab.id !== activeMainMenu) {
            setActiveMainMenu(groupForTab.id)
        }
    }, [activeTab, activeMainMenu])

    const activeGroup = enterpriseGroups.find((group) => group.id === activeMainMenu) || enterpriseGroups[0]
    const visibleTabs = tabs.filter((tab) => activeGroup.items.includes(tab.name))
    /** Report v2: modo compacto global para máxima visibilidad técnica */
    const compactReportChrome = true

    return (
        <div
            className={`dashboard-shell dashboard-shell-mining relative flex h-screen min-h-0 w-full overflow-hidden text-slate-100 font-sans selection:bg-cyan-500/30${
                compactReportChrome ? ' report-studio-chrome-compact' : ''
            }`}
        >

            {/* Main Content Area */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">

                {/* Top Header / Tab Bar — misma familia visual que login (auth-screen) */}
                <header
                    className={`relative overflow-hidden backdrop-blur-xl transition-all duration-300 ${
                        compactReportChrome
                            ? 'chrome-informe-header border-b border-cyan-500/35 px-3 py-1.5 lg:px-4'
                            : 'border-b border-cyan-500/25 bg-slate-950/75 px-4 py-3 lg:px-6'
                    }`}
                >
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_-90%,rgba(245,158,11,0.14),transparent_46%),radial-gradient(circle_at_86%_-95%,rgba(14,165,233,0.18),transparent_50%)]" />

                    <div
                        className={`relative z-10 flex flex-wrap items-center ${
                            compactReportChrome ? 'gap-x-3 gap-y-1.5' : 'gap-x-5 gap-y-3'
                        }`}
                    >
                        <div className="flex flex-1 min-w-[200px] items-center gap-4">
                            <PlatformBrandDashboardBlock
                                linePrimary={platformCompanyName}
                                lineSecondary={`${miningCompanyName} | ${miningUnitName}`}
                            />
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-3 md:gap-4 ml-auto">
                            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-emerald-500/35 bg-emerald-950/45 text-[10px] text-emerald-300 font-semibold whitespace-nowrap">
                                <ShieldCheck size={12} />
                                <span>Stack online</span>
                            </div>

                            <div className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-600/40 bg-slate-900/50 text-[10px] text-slate-400 font-medium whitespace-nowrap">
                                <Clock size={12} className="shrink-0 text-slate-500" />
                                <span>{currentDateLabel}</span>
                            </div>

                            <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/35 bg-amber-950/30 text-[10px] text-amber-100">
                                <span className="font-bold text-amber-200/90">Minera:</span>
                                <span>{miningCompanyName}</span>
                            </div>

                            <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-cyan-500/35 bg-cyan-950/30 text-[10px] text-cyan-100">
                                <span className="font-bold text-cyan-200/90">Unidad:</span>
                                <span>{miningUnitName}</span>
                            </div>

                            <div className="flex items-center gap-3 pl-1 md:pl-2 border-l border-slate-600/40 md:ml-1">
                                <div className="flex items-center gap-2 sm:gap-2.5 px-2 sm:px-3 py-1.5 rounded-xl border border-slate-500/45 bg-slate-900/80 text-[9px] sm:text-[10px] text-slate-100 shadow-inner min-w-0 max-w-full">
                                    {headerAvatarDataUrl && !avatarImageFailed ? (
                                        <img
                                            src={headerAvatarDataUrl}
                                            alt=""
                                            className="header-user-avatar w-8 h-8 sm:w-9 sm:h-9"
                                            width={36}
                                            height={36}
                                            onError={() => {
                                                console.warn('[SESSION_AVATAR] imagen base64 no válida o corrupta')
                                                setAvatarImageFailed(true)
                                            }}
                                        />
                                    ) : (
                                        <span
                                            className="header-user-avatar header-user-avatar--placeholder w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center shrink-0"
                                            title={
                                                avatarB64
                                                    ? 'Avatar no disponible (dato inválido). Cierre sesión y entre de nuevo tras un registro con IA activa.'
                                                    : 'Sin avatar facial guardado. Cierre sesión y vuelva a entrar tras registrarse con biométrico.'
                                            }
                                            aria-hidden
                                        >
                                            <UserRound size={18} className="text-amber-100" />
                                        </span>
                                    )}
                                    <span className="font-semibold text-slate-400 whitespace-nowrap shrink-0">Usuario:</span>
                                    <span className="font-bold text-slate-50 truncate min-w-0 max-w-[7rem] sm:max-w-[12rem] lg:max-w-[14rem]">
                                        {session?.fullName || session?.username || '—'}
                                    </span>
                                </div>
                                {canMaintain && (
                                    <button
                                        className="aurixa-toolbar-btn aurixa-toolbar-btn--indigo"
                                        onClick={() => setShowUserMaintenance(true)}
                                        title="Mantenimiento de usuarios de la plataforma"
                                    >
                                        <Users size={13} />
                                        <span className="hidden lg:inline">Usuarios</span>
                                    </button>
                                )}
                                {isAdmin && (
                                    <button
                                        className="aurixa-toolbar-btn aurixa-toolbar-btn--indigo aurixa-toolbar-btn--icon"
                                        onClick={() => setShowAuditCenter(true)}
                                        title="Abrir auditoria"
                                    >
                                        <FileText size={16} />
                                    </button>
                                )}
                                <button
                                    className="aurixa-toolbar-btn aurixa-toolbar-btn--danger"
                                    onClick={onLogout}
                                    title="Cerrar sesion"
                                >
                                    <LogOut size={14} />
                                    <span>Salir</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div
                        className={`relative z-10 ${compactReportChrome ? 'chrome-subnav-row' : 'mt-3'}`}
                    >
                        {navLevel === 'main' ? (
                            <div className="enterprise-main-nav">
                                {enterpriseGroups.filter(g => g.id !== 'mantenimiento_ti' || canMaintain).map((group) => {
                                    const Icon = group.icon
                                    const isActiveGroup = activeMainMenu === group.id
                                    return (
                                        <div key={group.id} className="tab-chip-wrap">
                                            <button
                                                className={`enterprise-main-btn ${isActiveGroup ? 'is-active' : ''}`}
                                                onClick={() => {
                                                    setActiveMainMenu(group.id)
                                                    const nextTab = tabs.find((tab) => group.items.includes(tab.name))
                                                    if (nextTab) setActiveTab(nextTab.name)
                                                    setNavLevel('sub')
                                                }}
                                                title={group.tip}
                                            >
                                                <span className="tab-icon-ring">
                                                    <Icon size={13} />
                                                </span>
                                                <span>{group.title}</span>
                                                <span className="tab-glyph" aria-hidden="true">{group.navTag || '·'}</span>
                                            </button>
                                            <div className="tab-tooltip">{group.tip}</div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="top-nav-shell top-nav-shell--wrap top-nav-shell--sub">
                                <button
                                    className="subnav-back-btn"
                                    onClick={() => setNavLevel('main')}
                                    title="Volver al menú principal"
                                >
                                    <ArrowLeft size={14} />
                                    Volver
                                </button>
                                <span className="subnav-context-label" title={activeGroup.tip}>
                                    {activeGroup.title}
                                </span>
                                {visibleTabs.map(t => {
                                    const Icon = t.icon
                                    const isActive = activeTab === t.name
                                    return (
                                        <div key={t.name} className="tab-chip-wrap">
                                            <button
                                                onClick={() => setActiveTab(t.name)}
                                                className={`tab-button tab-button--premium tab-button--3d ${isActive ? 'tab-button--active' : ''}`}
                                                aria-label={`Abrir ${t.name}`}
                                            >
                                                <span className="tab-icon-ring">
                                                    <Icon size={13} />
                                                </span>
                                                <span>{t.label || t.name}</span>
                                                <span className="tab-glyph" aria-hidden="true">{t.glyph}</span>
                                                {t.badge && <span className="tab-pill">{t.badge}</span>}
                                            </button>
                                            <div className="tab-tooltip">{t.tip}</div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Solo Informe técnico (v2): ancla la cinta de diseño bajo el submenú. Fórmula/Redactor usan su propia barra dentro del iframe/editor — el placeholder generaba una banda vacía. */}
                    {activeTab === 'Report v2' ? (
                        <div
                            id="report-v2-design-toolbar-host"
                            className="chrome-report-toolbar-slot relative z-[25] flex w-full shrink-0 min-h-[42px] flex-col"
                        />
                    ) : null}
                </header>

                {/* Dynamic Visualization Bench */}
                <main
                    className={`relative flex min-h-0 min-w-0 flex-1 bg-transparent ${
                        isGeotechView ? 'mining-main--geotech' : 'overflow-hidden'
                    }`}
                >
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
                        className={`dashboard-main-scroll relative flex min-h-0 min-w-0 flex-1 basis-0 flex-col ${
                            lockMainScrollViewport
                                ? 'dashboard-main-scroll--viewport-lock overflow-hidden overflow-x-hidden'
                                : 'overflow-y-auto overflow-x-hidden'
                        }`}
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

                        <div className="viz-route-host">
                            {activeTab === 'Inclinometer' && (
                                <GeotechWorkbench tabKey="Inclinometer">
                                    <InclinometerCharts
                                        xRange={[xMin, xMax]}
                                        yRange={[yMin, yMax]}
                                        azimuthAngle={azimuthAngle}
                                        installationAngle={installationAngle}
                                    />
                                </GeotechWorkbench>
                            )}
                            {activeTab === '3D' && (
                                <GeotechWorkbench tabKey="3D">
                                    <Viewer3D azimuthAngle={azimuthAngle} installationAngle={installationAngle} />
                                </GeotechWorkbench>
                            )}
                            {activeTab === 'Map' && <MapViewer />}
                            {activeTab === 'MiningGeoportal' && <MiningGeoportalView />}
                            {activeTab === 'ComplianceGeo' && (
                                <MapViewer
                                    layout="compliance"
                                    siteLabel={`${miningCompanyName} · ${miningUnitName}`}
                                />
                            )}
                            {activeTab === 'Mapa Detallado' && <DetailedMap />}
                            {activeTab === 'Dashboard' && <MiningDashboard />}
                            {activeTab === 'Sensores Técnicos' && (
                                <AdvancedSensors telemetryTenantId={telemetryScope.telemetryTenantId} />
                            )}
                            {activeTab === 'Alarmas' && (
                                <AlarmCenter
                                    telemetryTenantId={telemetryScope.telemetryTenantId}
                                    onCreateReportFromAlarm={(alarm) => {
                                        setActiveTab('Report v2')
                                    }}
                                />
                            )}
                            {activeTab === 'Surveillance' && (
                                <VideoDiagram telemetryTenantId={telemetryScope.telemetryTenantId} />
                            )}
                            {activeTab === 'Telemetría' && (
                                <TelemetryDashboard telemetryTenantId={telemetryScope.telemetryTenantId} />
                            )}
                            {activeTab === 'Displacement Cumulative' && (
                                <GeotechWorkbench tabKey="Displacement Cumulative">
                                    <DisplacementCharts xRange={[xMin, xMax]} yRange={[yMin, yMax]} />
                                </GeotechWorkbench>
                            )}
                            {activeTab === 'Report' && <RichTextEditor />}
                            {activeTab === 'UserManagement' && (
                                <UserManagementView />
                            )}
                            {activeTab === 'Permissions' && (
                                <PermissionsManagementView />
                            )}
                            {activeTab === "Report v2" && (
                                <ReportStudioV2
                                    platformCompanyName={session?.platformCompany || session?.ownerCompany}
                                    telemetryTenantId={telemetryScope.telemetryTenantId}
                                />
                            )}
                            {activeTab === "Formula" && (
                                <FormulaEngineEmbed
                                    platformCompanyName={session?.platformCompany || session?.ownerCompany}
                                    miningCompanyName={session?.company}
                                />
                            )}
                        </div>
                    </div>

                    {/* Temporal Legend Sidebar (Inside Main View) */}
                    {(activeTab === 'Inclinometer' || activeTab === '3D' || activeTab === 'Displacement Cumulative') && (
                        <div className="viz-legend-rail geotech-legend-rail hidden h-full min-h-0 w-[11.5rem] shrink-0 flex-col gap-2 overflow-y-auto border-l border-cyan-500/15 bg-slate-950/75 p-3 backdrop-blur-md sm:w-52 sm:p-4 lg:flex">
                            <div className="mb-1 border-b border-slate-600/40 pb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                                Serie temporal (demo)
                            </div>
                            {[
                                '04/08/2025 06:00 PM', '09/01/2024 06:00 PM', '01/27/2024 12:00 AM',
                                '08/13/2023 12:00 AM', '12/08/2022 09:52 AM', '05/04/2022 10:42 AM',
                                '09/11/2021 03:17 PM', '01/29/2021 10:49 AM', '06/27/2020 04:05 PM',
                                '11/22/2019 11:30 AM', '07/26/2019 10:03 AM', '06/07/2018 03:35 PM',
                                '01/27/2018 12:52 PM'
                            ].map((t, i) => (
                                <div key={t} className="flex cursor-default items-center gap-2 text-[9px] text-slate-500 transition-colors hover:text-cyan-200/90">
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

                    {/* Panel derecho alineado con el área de diagramas (no con toda la columna + cabecera) */}
                    <AnimatePresence>
                        {showRightSidebar && (
                            <motion.aside
                                initial={{ x: 20, opacity: 0 }}
                                animate={{ x: 0, opacity: 1 }}
                                exit={{ x: 20, opacity: 0 }}
                                transition={{ duration: 0.24 }}
                                className="mining-geotech-edit-aside sidebar-motion z-20 flex h-full min-h-0 w-[min(20rem,100%)] shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sm:w-80"
                            >
                                <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
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

                                    {sidebarTab === 'Layers' && (
                                        <div className="py-12 text-center text-[11px] italic text-slate-400">Configuraciones de {sidebarTab}...</div>
                                    )}
                                </div>

                                <div className="shrink-0 border-t border-slate-100 p-6 dark:border-slate-800">
                                    <AnimatedButton className="w-full justify-center" onClick={() => {}}>Save</AnimatedButton>
                                </div>
                            </motion.aside>
                        )}
                    </AnimatePresence>
                </main>
            </div>
            {/* Database Status Indicator (Floating) */}
            <div
                className={`absolute bottom-4 z-50 flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[10px] shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 ${showRightSidebar ? 'right-[calc(20rem+1rem)]' : 'right-4'}`}
            >
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="font-bold text-slate-600 dark:text-slate-400">DB: {dbStatus}</span>
            </div>

            {/* QR Modal */}
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
