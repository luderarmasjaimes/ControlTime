import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Activity,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    ChevronDown,
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
    Building2,
    UserRound,
    Sigma,
    BellRing,
    Radio,
    Maximize2,
    X,
} from 'lucide-react'
import { log } from './lib/logger';
    // Hubspot is removed as it is not available in lucide-react
import { motion, AnimatePresence } from 'framer-motion'
import AnimatedButton from './components/UI/AnimatedButton'
import AzimuthCompass from './components/Special/AzimuthCompass'
import AuthGateway from './components/Auth/AuthGateway'
import TenantSwitcher from './components/Auth/TenantSwitcher'

// ─────────────────────────────────────────────────────────────────────────
// Carga diferida de las vistas pesadas (2026-08-02)
//
// Antes TODAS estas vistas eran imports estáticos, así que sus librerías
// entraban al bundle inicial aunque el usuario nunca abriera la pestaña:
// three.js (Viewer3D), echarts (dashboards/inclinómetro/desplazamiento),
// plotly (LiveChartBlock), konva (ReportStudioV2), leaflet (mapas), tiptap
// (editor), sql.js/WASM (edición offline) e hls.js (videovigilancia). Eso
// daba un main-*.js de 4.26MB que había que descargar, parsear y ejecutar
// ANTES de poder siquiera pintar la pantalla de login — que no usa ninguna
// de ellas.
//
// Con React.lazy cada vista se convierte en un chunk aparte que se pide
// recién al abrir su pestaña. El login y el chrome de la app quedan en un
// bundle pequeño, y el resto llega bajo demanda (y queda cacheado por el
// `Cache-Control: immutable` de /assets/ en nginx.conf).
// ─────────────────────────────────────────────────────────────────────────
const InclinometerCharts = React.lazy(() => import('./components/Special/InclinometerCharts'))
const Viewer3D = React.lazy(() => import('./components/Viewer/Viewer3D'))
const MapViewer = React.lazy(() => import('./components/Special/MapViewer'))
const MiningGeoportalView = React.lazy(() => import('./components/Special/MiningGeoportalView'))
const DetailedMap = React.lazy(() => import('./components/Special/DetailedMap'))
const DisplacementCharts = React.lazy(() => import('./components/Special/DisplacementCharts'))
const MiningDashboard = React.lazy(() => import('./components/Dashboard/MiningDashboard'))
const VideoDiagram = React.lazy(() => import('./components/Special/VideoDiagram'))
const RichTextEditor = React.lazy(() => import('./components/Editor/RichTextEditor'))
const AuditCenter = React.lazy(() => import('./components/Auth/AuditCenter'))
const AdvancedSensors = React.lazy(() => import('./components/Dashboard/AdvancedSensors'))
const KpiOperationsView = React.lazy(() => import('./components/Dashboard/KpiOperationsView'))
const AlarmCenter = React.lazy(() => import('./components/Dashboard/AlarmCenter'))
const TelemetryDashboard = React.lazy(() => import('./components/Dashboard/TelemetryDashboard'))
const GeotechWorkbench = React.lazy(() => import('./components/Dashboard/GeotechWorkbench'))
const ReportStudioV2 = React.lazy(() => import('./components/ReportStudioV2/App'))
const FormulaEngineEmbed = React.lazy(() => import('./components/Formula/FormulaEngineEmbed'))
const UserMaintenanceModal = React.lazy(() => import('./components/ReportStudioV2/components/modals/UserMaintenanceModal'))
const UserManagementView = React.lazy(() => import('./components/ReportStudioV2/components/views/UserManagementView'))
const CompanyManagementView = React.lazy(() => import('./components/ReportStudioV2/components/views/CompanyManagementView'))
const PermissionsManagementView = React.lazy(() => import('./components/ReportStudioV2/components/views/PermissionsManagementView'))
const AlarmConfigView = React.lazy(() => import('./components/ReportStudioV2/components/views/AlarmConfigView'))

/**
 * Fallback mientras se descarga el chunk de una vista diferida. Ocupa el alto
 * completo del área de trabajo para que el chrome (menús, cabecera) no dé un
 * salto de layout al montar la vista real.
 */
const ViewLoader = ({ label }: { label: string }) => (
    <div
        className="flex min-h-[60vh] w-full flex-1 flex-col items-center justify-center gap-3 text-slate-300"
        role="status"
        aria-live="polite"
    >
        <span className="view-loader__spinner" aria-hidden />
        <span className="text-xs font-medium tracking-wide text-slate-400">{label}</span>
    </div>
)
import { PlatformBrandDashboardBlock } from './brand/PlatformBrandMark'
import { ensureCompanyUsers } from './components/ReportStudioV2/lib/userBootstrap'
import { getSession, createSession, type Session } from './auth/authStorage'
import { fetchMyAvatarHd, logout as logoutApi } from './auth/authApi'
import { usePermissions, invalidatePermissionsCache } from './auth/usePermissions'
import { telemetryTenantIdFromSession } from './auth/telemetryTenant'
import { useI18n } from './i18n/I18nProvider'
import { ConfirmActionHost } from './components/UI/ConfirmActionDialog'

/** Sesión ampliada con campos opcionales de contexto de plataforma/unidad, aún no emitidos por AuthGateway pero leídos defensivamente aquí. */
interface AppSession extends Session {
    platformCompany?: string
    ownerCompany?: string
    miningCompany?: string
    miningUnit?: string
    unitName?: string
    mineUnit?: string
    site?: string
}

interface TabDef {
    name: string
    label: string
    icon: React.ElementType
    glyph: string
    badge?: string
    tip: string
}

interface EnterpriseGroup {
    id: string
    title: string
    icon: React.ElementType
    tip: string
    items: string[]
    navTag: string
}

interface HorizontalNavRailProps {
    label: string
    ariaLabel: string
    children: React.ReactNode
    tone?: 'primary' | 'secondary'
}

/**
 * Carril horizontal accesible: mantiene una sola línea, muestra flechas solo
 * cuando existe contenido fuera de vista y conserva el scroll táctil/rueda.
 */
const HorizontalNavRail = ({
    label,
    ariaLabel,
    children,
    tone = 'primary',
}: HorizontalNavRailProps) => {
    const railRef = useRef<HTMLDivElement>(null)
    const [scrollState, setScrollState] = useState({ left: false, right: false })

    const updateScrollState = () => {
        const rail = railRef.current
        if (!rail) return
        const epsilon = 3
        setScrollState({
            left: rail.scrollLeft > epsilon,
            right: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - epsilon,
        })
    }

    useEffect(() => {
        updateScrollState()
        const rail = railRef.current
        if (!rail) return
        const observer = new ResizeObserver(updateScrollState)
        observer.observe(rail)
        Array.from(rail.children).forEach((child) => observer.observe(child))
        window.addEventListener('resize', updateScrollState)
        return () => {
            observer.disconnect()
            window.removeEventListener('resize', updateScrollState)
        }
    }, [children])

    const scrollRail = (direction: -1 | 1) => {
        const rail = railRef.current
        if (!rail) return
        rail.scrollBy({
            left: direction * Math.max(220, rail.clientWidth * 0.72),
            behavior: 'smooth',
        })
    }

    return (
        <section className={`mining-nav-rail mining-nav-rail--${tone}`} aria-label={ariaLabel}>
            <span className="mining-nav-rail__label">{label}</span>
            <button
                type="button"
                className={`mining-nav-arrow${scrollState.left ? ' is-visible' : ''}`}
                onClick={() => scrollRail(-1)}
                aria-label={`${label}: ←`}
                disabled={!scrollState.left}
            >
                <ChevronLeft size={18} aria-hidden />
            </button>
            <div
                ref={railRef}
                className="enterprise-main-nav"
                onScroll={updateScrollState}
                tabIndex={0}
                role="navigation"
                aria-label={ariaLabel}
            >
                {children}
            </div>
            <button
                type="button"
                className={`mining-nav-arrow${scrollState.right ? ' is-visible' : ''}`}
                onClick={() => scrollRail(1)}
                aria-label={`${label}: →`}
                disabled={!scrollState.right}
            >
                <ChevronRight size={18} aria-hidden />
            </button>
        </section>
    )
}

/** Etiquetas UI + tenant UUID único para APIs de telemetría/CCTV. */
function telemetryScopeFromSession(sess: AppSession | null | undefined) {
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
function normalizeSessionAvatarBase64(sess: AppSession | null | undefined): string | null {
    const raw = sess?.avatarCartoonBase64
    if (typeof raw !== 'string') return null
    const b64 = raw.replace(/\s/g, '')
    return b64.length > 0 ? b64 : null
}

function sessionAvatarDataUrlFromB64(b64: string | null): string | null {
    if (!b64) return null
    if (b64.startsWith('iVBOR')) return `data:image/png;base64,${b64}`
    if (b64.startsWith('/9j')) return `data:image/jpeg;base64,${b64}`
    return `data:image/png;base64,${b64}`
}

/** Cada badge tiene un color semántico propio (antes todos compartían el mismo degradado). */
function tabPillClassName(badge?: string): string {
    switch (badge) {
        case 'Live': return 'tab-pill tab-pill--live'
        case 'Beta': return 'tab-pill tab-pill--beta'
        case 'Pro': return 'tab-pill tab-pill--pro'
        case 'NEW': return 'tab-pill tab-pill--new'
        case 'S2': return 'tab-pill tab-pill--s2'
        case 'Hub': return 'tab-pill tab-pill--hub'
        default: return 'tab-pill'
    }
}

interface DashboardAppProps {
    session: AppSession
    onLogout: () => void
}

export const DashboardApp = ({ session, onLogout }: DashboardAppProps) => {
    const { t, language, countryIso2 } = useI18n()
    const telemetryScope = telemetryScopeFromSession(session)
    const mainScrollRef = useRef<HTMLDivElement>(null)
    const [activeTab, setActiveTab] = useState('Dashboard')
    const [sidebarTab, setSidebarTab] = useState('Azimuth')
    const [azimuthAngle, setAzimuthAngle] = useState(45)
    const [installationAngle, setInstallationAngle] = useState(55)
    const [azimuthOffset, setAzimuthOffset] = useState(true)
    const [dbStatus, setDbStatus] = useState('Sincronizado')
    const [activeMainMenu, setActiveMainMenu] = useState('monitoreo')
    // Nav de dos niveles siempre visibles (categorías + ítems de la categoría
    // activa, sin clic de "volver"). El usuario contrae/expande todo el bloque
    // con un único control (ver .nav-collapse-toggle) para ganar área vertical
    // del lienzo; un botón flotante inferior ofrece la misma acción cuando el
    // nav ya está contraído y no es visible.
    const [navCollapsed, setNavCollapsed] = useState(false)
    const [showAuditCenter, setShowAuditCenter] = useState(false)
    const [showUserMaintenance, setShowUserMaintenance] = useState(false)
    const [showUserMaintenancePrompt, setShowUserMaintenancePrompt] = useState(false)
    const [mainScrollHints, setMainScrollHints] = useState({ right: false, bottom: false })
    const isAdmin = (session?.role || '').toLowerCase() === 'admin'
    // ADR-079: antes comparaba session.role contra el string 'supervisor'
    // hardcodeado — el mismo tipo de drift que ADR-036/063 ya habían
    // corregido en otras pantallas (si gerencia otorga estas capacidades a
    // otro rol vía la matriz de permisos, este flag debe reflejarlo sin
    // tocar código). Ahora se ata a la capacidad real en `role_permissions`,
    // no al nombre del rol.
    const { hasPermission } = usePermissions()
    const canMaintain =
        isAdmin ||
        hasPermission('usuarios.manage') ||
        hasPermission('permisos.manage') ||
        hasPermission('alarmas.manage')
    // ADR-085/086: flag propio, deliberadamente NO incluido en canMaintain —
    // un manager con solo `empresas.view` (sin usuarios.manage/permisos.manage/
    // alarmas.manage) debe ver el catálogo de empresas sin heredar acceso a
    // las otras pantallas administrativas.
    const canViewCompanies = isAdmin || hasPermission('empresas.view')
    const currentDateLabel = useMemo(() =>
        new Intl.DateTimeFormat(`${language}-${countryIso2}`, {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date())
    , [language, countryIso2])
    const [avatarImageFailed, setAvatarImageFailed] = useState(false)
    const [avatarPreviewOpen, setAvatarPreviewOpen] = useState(false)
    const [avatarHdUrl, setAvatarHdUrl] = useState<string | null>(null)
    const [avatarHdLoading, setAvatarHdLoading] = useState(false)
    const [avatarHdFailed, setAvatarHdFailed] = useState(false)
    const avatarB64 = normalizeSessionAvatarBase64(session)
    const headerAvatarDataUrl = sessionAvatarDataUrlFromB64(avatarB64)

    useEffect(() => {
        setAvatarImageFailed(false)
    }, [avatarB64, session?.username])

    useEffect(() => {
        return () => {
            if (avatarHdUrl) URL.revokeObjectURL(avatarHdUrl)
        }
    }, [avatarHdUrl])

    useEffect(() => {
        if (!avatarPreviewOpen) return
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setAvatarPreviewOpen(false)
        }
        document.addEventListener('keydown', closeOnEscape)
        return () => document.removeEventListener('keydown', closeOnEscape)
    }, [avatarPreviewOpen])

    const openAvatarPreview = async () => {
        if (!headerAvatarDataUrl || avatarImageFailed) return
        setAvatarPreviewOpen(true)
        if (avatarHdUrl || avatarHdLoading) return
        setAvatarHdLoading(true)
        setAvatarHdFailed(false)
        try {
            const blob = await fetchMyAvatarHd()
            const nextUrl = URL.createObjectURL(blob)
            setAvatarHdUrl((previousUrl) => {
                if (previousUrl) URL.revokeObjectURL(previousUrl)
                return nextUrl
            })
        } catch (error) {
            log.warn('[SESSION_AVATAR] no se pudo cargar la versión HD; se usará la miniatura', error)
            setAvatarHdFailed(true)
        } finally {
            setAvatarHdLoading(false)
        }
    }
    const platformCompanyName = session?.platformCompany || session?.ownerCompany || 'Beemetry'
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
    // Referencia estable para InclinometerCharts/DisplacementCharts (memoizados,
    // ver React.memo): un literal `[xMin, xMax]` inline en el JSX se recrea en
    // cada render de App (22 useState propios, la mayoría ajenos a estas
    // pestañas), lo que anularía el memo pese a que los valores no cambiaron.
    const xRange = useMemo<[number, number]>(() => [xMin, xMax], [xMin, xMax])
    const yRange = useMemo<[number, number]>(() => [yMin, yMax], [yMin, yMax])

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

        let observer: ResizeObserver | null = null
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
     * | Monitoreo en Vivo                 | Centro de Control, Sensores, CCTV      | API telemetría / Postgres |
     * | Geotecnia y Modelo 3D             | Talud, Movimiento del Terreno, Vista 3D | Solo cliente (ECharts/R3F) |
     * | Mapas de la Mina                  | Mapa satelital, Mapa Detallado         | /api/map/markers (C++→Postgres) |
     * | Terrenos y Permisos               | Mapas Oficiales, Permisos por Zona     | WMS + /api/map/official-zones, /api/map/compliance-intersections (C++ + GeoJSON en /data) |
     * | Cálculos e Informes               | Calculadora, Reporte Rápido, Informe Técnico | APIs informes / formula_engine |
     */
    const tabs: TabDef[] = [
        {
            name: 'Dashboard',
            label: t('nav.control'),
            icon: Activity,
            glyph: 'KPI',
            badge: 'Live',
            tip: t('nav.openModule', { name: t('nav.control') })
        },
        {
            name: 'Sensores Técnicos',
            label: t('nav.sensors'),
            icon: BarChart2,
            glyph: 'IoT',
            tip: t('nav.openModule', { name: t('nav.sensors') })
        },
        {
            name: 'KPIs Operación',
            label: t('nav.kpis'),
            icon: Activity,
            glyph: 'IND',
            badge: 'New',
            tip: t('nav.openModule', { name: t('nav.kpis') })
        },
        {
            name: 'Inclinometer',
            label: t('nav.slope'),
            icon: Activity,
            glyph: 'GEO',
            tip: t('nav.openModule', { name: t('nav.slope') })
        },
        {
            name: 'Displacement Cumulative',
            label: t('nav.movement'),
            icon: Layers,
            glyph: 'MOV',
            tip: t('nav.openModule', { name: t('nav.movement') })
        },
        {
            name: '3D',
            label: t('nav.mine3d'),
            icon: FileText,
            glyph: '3D',
            tip: t('nav.openModule', { name: t('nav.mine3d') })
        },
        {
            name: 'Map',
            label: t('nav.satellite'),
            icon: MapIcon,
            glyph: 'MAP',
            tip: t('nav.openModule', { name: t('nav.satellite') })
        },
        {
            name: 'MiningGeoportal',
            label: t('nav.official'),
            icon: Globe2,
            glyph: 'OFI',
            badge: 'Hub',
            tip: t('nav.openModule', { name: t('nav.official') })
        },
        {
            name: 'ComplianceGeo',
            label: t('nav.permits'),
            icon: ShieldCheck,
            glyph: 'REG',
            badge: 'Pro',
            tip: t('nav.openModule', { name: t('nav.permits') })
        },
        {
            name: 'Mapa Detallado',
            label: t('nav.hdMap'),
            icon: Layers,
            glyph: 'HD',
            badge: 'Pro',
            tip: t('nav.openModule', { name: t('nav.hdMap') })
        },
        {
            name: 'Alarmas',
            label: t('nav.alarms'),
            icon: BellRing,
            glyph: 'ALM',
            badge: 'Live',
            tip: t('nav.openModule', { name: t('nav.alarms') })
        },
        {
            name: 'Surveillance',
            label: t('nav.cameras'),
            icon: Compass,
            glyph: 'CAM',
            tip: t('nav.openModule', { name: t('nav.cameras') })
        },
        {
            name: 'Telemetría',
            label: t('nav.telemetry'),
            icon: Radio,
            glyph: 'TEL',
            badge: 'S2',
            tip: t('nav.openModule', { name: t('nav.telemetry') })
        },
        {
            name: 'Formula',
            label: t('nav.calculation'),
            icon: Sigma,
            glyph: 'AI',
            badge: 'NEW',
            tip: t('nav.openModule', { name: t('nav.calculation') })
        },
        {
            name: 'Report',
            label: t('nav.quickReport'),
            icon: FileText,
            glyph: 'DOC',
            badge: 'Priority',
            tip: t('nav.openModule', { name: t('nav.quickReport') })
        },
        {
            name: 'Report v2',
            label: t('nav.reports'),
            icon: Layout,
            glyph: 'PDF',
            badge: 'Beta',
            tip: t('nav.openModule', { name: t('nav.reports') })
        },
        {
            name: 'UserManagement',
            label: t('nav.users'),
            icon: Users,
            glyph: 'USR',
            tip: t('nav.openModule', { name: t('nav.users') })
        },
        {
            name: 'CompanyManagement',
            label: t('nav.companies'),
            icon: Building2,
            glyph: 'EMP',
            tip: t('nav.openModule', { name: t('nav.companies') })
        },
        {
            name: 'Permissions',
            label: t('nav.access'),
            icon: ShieldCheck,
            glyph: 'SEC',
            badge: 'Pro',
            tip: t('nav.openModule', { name: t('nav.access') })
        },
        {
            name: 'AlarmConfig',
            label: t('nav.thresholds'),
            icon: BellRing,
            glyph: 'ALM',
            tip: t('nav.openModule', { name: t('nav.thresholds') })
        }
    ]

    const enterpriseGroups: EnterpriseGroup[] = [
        {
            id: 'mantenimiento',
            title: t('nav.manage'),
            icon: ShieldCheck,
            tip: t('nav.openModule', { name: t('nav.manage') }),
            items: ['UserManagement', 'Permissions', 'AlarmConfig'],
            navTag: 'ADM',
        },
        {
            // ADR-085/086: grupo propio (no dentro de 'mantenimiento') para que
            // su visibilidad dependa solo de `canViewCompanies` — si viviera en
            // 'mantenimiento', un manager con solo empresas.view vería también
            // las pestañas de Usuarios/Permisos/Alarmas sin poder abrirlas
            // (esas exigen canMaintain en su propio punto de montaje).
            id: 'empresas',
            title: t('nav.companies'),
            icon: Building2,
            tip: t('nav.openModule', { name: t('nav.companies') }),
            items: ['CompanyManagement'],
            navTag: 'EMP',
        },
        {
            id: 'monitoreo',
            title: t('nav.control'),
            icon: Activity,
            tip: t('nav.openModule', { name: t('nav.control') }),
            items: ['Dashboard', 'Sensores Técnicos', 'KPIs Operación', 'Alarmas', 'Surveillance', 'Telemetría'],
            navTag: 'LIVE',
        },
        {
            id: 'geotecnia',
            title: t('nav.ground'),
            icon: Layers,
            tip: t('nav.openModule', { name: t('nav.ground') }),
            items: ['Inclinometer', 'Displacement Cumulative', '3D'],
            navTag: 'GEO',
        },
        {
            id: 'geoespacial_faena',
            title: t('nav.maps'),
            icon: MapIcon,
            tip: t('nav.openModule', { name: t('nav.maps') }),
            items: ['Map', 'Mapa Detallado'],
            navTag: 'MAP',
        },
        {
            id: 'territorio_gis',
            title: t('nav.permits'),
            icon: Globe2,
            tip: t('nav.openModule', { name: t('nav.permits') }),
            items: ['MiningGeoportal', 'ComplianceGeo'],
            navTag: 'TER',
        },
        {
            id: 'ingenieria',
            title: t('nav.reports'),
            icon: Sigma,
            tip: t('nav.openModule', { name: t('nav.reports') }),
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

    const visibleEnterpriseGroups = useMemo(
        () => enterpriseGroups.filter((group) =>
            (group.id !== 'mantenimiento' || canMaintain) &&
            (group.id !== 'empresas' || canViewCompanies)
        ),
        [canMaintain, canViewCompanies, language]
    )
    const activeGroup = visibleEnterpriseGroups.find((group) => group.id === activeMainMenu) || visibleEnterpriseGroups[0]
    const visibleTabs = tabs.filter((tab) => activeGroup.items.includes(tab.name))
    /** Report v2: modo compacto global para máxima visibilidad técnica */
    const compactReportChrome = true

    useEffect(() => {
        if (!visibleEnterpriseGroups.some((group) => group.id === activeMainMenu)) {
            setActiveMainMenu(visibleEnterpriseGroups[0]?.id ?? 'monitoreo')
        }
    }, [activeMainMenu, visibleEnterpriseGroups])

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
                        className={`mining-command-row relative z-10 flex flex-nowrap items-center overflow-hidden whitespace-nowrap ${
                            compactReportChrome ? 'gap-x-3 gap-y-1.5' : 'gap-x-5 gap-y-3'
                        }`}
                    >
                        <div className="mining-command-brand flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                            <PlatformBrandDashboardBlock
                                linePrimary={`${platformCompanyName} · Centro Minero`}
                                lineSecondary={`${miningCompanyName} · ${miningUnitName}`}
                            />
                        </div>

                        <div className="mining-command-actions ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-2">
                            <div className="mining-status-chip mining-status-chip--online hidden sm:flex">
                                <ShieldCheck size={15} />
                                <span>{t('nav.online')}</span>
                            </div>

                            <div className="mining-status-chip hidden lg:flex">
                                <Clock size={14} className="shrink-0 text-slate-500" />
                                <span>{currentDateLabel}</span>
                            </div>

                            {/* Selector de unidad minera activa (multi-tenant): oculto si el
                                usuario solo pertenece a una — ver TenantSwitcher.tsx */}
                            <TenantSwitcher />

                            <div className="mining-user-actions flex items-center gap-2 pl-2 border-l border-slate-600/40">
                                <div
                                    className="mining-user-card flex items-center gap-2 px-2 py-1 rounded-xl min-w-0"
                                    title={t('nav.activeUser', { name: session?.fullName || session?.username || '—' })}
                                >
                                    {headerAvatarDataUrl && !avatarImageFailed ? (
                                        <button
                                            type="button"
                                            className="header-avatar-button"
                                            onDoubleClick={() => void openAvatarPreview()}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault()
                                                    void openAvatarPreview()
                                                }
                                            }}
                                            title={t('nav.expandAvatar')}
                                            aria-label={t('nav.expandAvatar')}
                                        >
                                            <img
                                                src={headerAvatarDataUrl}
                                                alt={t('avatar.thumbnailAlt', { name: session?.fullName || session?.username || t('audit.user') })}
                                                className="header-user-avatar w-8 h-8 sm:w-9 sm:h-9"
                                                width={36}
                                                height={36}
                                                draggable={false}
                                                onError={() => {
                                                    log.warn('[SESSION_AVATAR] imagen base64 no válida o corrupta')
                                                    setAvatarImageFailed(true)
                                                }}
                                            />
                                            <span className="header-avatar-button__expand" aria-hidden>
                                                <Maximize2 size={10} />
                                            </span>
                                        </button>
                                    ) : (
                                        <span
                                            className="header-user-avatar header-user-avatar--placeholder w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center shrink-0"
                                            title={
                                                avatarB64
                                                    ? t('avatar.invalid')
                                                    : t('avatar.missing')
                                            }
                                            aria-hidden
                                        >
                                            <UserRound size={18} className="text-amber-100" />
                                        </span>
                                    )}
                                    <span className="mining-user-card__name">
                                        {session?.fullName || session?.username || '—'}
                                    </span>
                                </div>
                                {canMaintain && (
                                    <div className="tab-chip-wrap">
                                        <button
                                            className="aurixa-toolbar-btn aurixa-toolbar-btn--indigo"
                                            onClick={() => setShowUserMaintenance(true)}
                                            title={t('nav.manageUsers')}
                                        >
                                            <Users size={13} />
                                            <span className="hidden lg:inline">{t('nav.users')}</span>
                                        </button>
                                        <div className="tab-tooltip">{t('nav.manageUsers')}</div>
                                    </div>
                                )}
                                {isAdmin && (
                                    <div className="tab-chip-wrap">
                                        <button
                                            className="aurixa-toolbar-btn aurixa-toolbar-btn--sky aurixa-toolbar-btn--icon"
                                            onClick={() => setShowAuditCenter(true)}
                                            title={t('nav.audit')}
                                        >
                                            <FileText size={16} />
                                        </button>
                                        <div className="tab-tooltip">{t('nav.audit')}</div>
                                    </div>
                                )}
                                <div className="tab-chip-wrap">
                                    <button
                                        className="aurixa-toolbar-btn aurixa-toolbar-btn--danger"
                                        onClick={onLogout}
                                        title={t('nav.logout')}
                                    >
                                        <LogOut size={14} />
                                        <span>{t('nav.logout')}</span>
                                    </button>
                                    <div className="tab-tooltip">{t('nav.logoutTip')}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div
                        className={`relative z-10 ${compactReportChrome ? 'chrome-subnav-row' : 'mt-3'}${navCollapsed ? ' hidden' : ''}`}
                    >
                        {/* Navegación compacta de una sola franja: categorías principales + módulos activos
                            en una sola línea para quitar peso visual del header y reducir el espacio
                            que el menú ocupa sobre el área de trabajo. */}
                        <div className="mining-nav-deck">
                            <HorizontalNavRail
                                label={t('nav.areas')}
                                ariaLabel={t('nav.areas')}
                                tone="primary"
                            >
                                {visibleEnterpriseGroups.map((group) => {
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
                                                }}
                                                title={group.tip}
                                                aria-current={isActiveGroup ? 'true' : undefined}
                                            >
                                                <span className="tab-icon-ring">
                                                    <Icon size={17} />
                                                </span>
                                                <span>{group.title}</span>
                                                <span className="tab-glyph" aria-hidden="true">{group.navTag || '·'}</span>
                                            </button>
                                            <div className="tab-tooltip">{group.tip}</div>
                                        </div>
                                    )
                                })}
                            </HorizontalNavRail>

                            <HorizontalNavRail
                                label={activeGroup?.title || t('nav.options')}
                                ariaLabel={`${t('nav.options')}: ${activeGroup?.title || ''}`}
                                tone="secondary"
                            >
                                {visibleTabs.map(tab => {
                                    const Icon = tab.icon
                                    const isActive = activeTab === tab.name
                                    const isPriorityReportingTab = tab.name === 'Report' || tab.name === 'Report v2'
                                    return (
                                        <div key={tab.name} className="tab-chip-wrap">
                                            <button
                                                onClick={() => setActiveTab(tab.name)}
                                                className={`enterprise-sub-btn ${isActive ? 'is-active' : ''} ${isPriorityReportingTab ? 'enterprise-sub-btn--report-priority' : ''}`}
                                                aria-label={t('nav.openModule', { name: tab.label || tab.name })}
                                                aria-current={isActive ? 'true' : undefined}
                                                title={tab.tip}
                                            >
                                                <span className="tab-icon-ring">
                                                    <Icon size={16} />
                                                </span>
                                                <span>{tab.label || tab.name}</span>
                                                {tab.badge && <span className={tabPillClassName(tab.badge)}>{tab.badge}</span>}
                                            </button>
                                            <div className="tab-tooltip">{tab.tip}</div>
                                        </div>
                                    )
                                })}
                            </HorizontalNavRail>

                            <div className="tab-chip-wrap shrink-0">
                                <button
                                    type="button"
                                    className="nav-collapse-toggle"
                                    onClick={() => setNavCollapsed(true)}
                                    title={t('nav.collapseTip')}
                                >
                                    <ChevronUp size={13} />
                                    <span className="hidden sm:inline">{t('nav.collapse')}</span>
                                </button>
                                <div className="tab-tooltip">{t('nav.collapseTip')}</div>
                            </div>
                        </div>
                    </div>

                    {/* Solo Informe técnico (v2): ancla la cinta de diseño bajo el submenú. Fórmula/Redactor usan su propia barra dentro del iframe/editor — el placeholder generaba una banda vacía. */}
                    {activeTab === 'Report v2' ? (
                        <div
                            id="report-v2-design-toolbar-host"
                            className="chrome-report-toolbar-slot relative z-[25] flex w-full shrink-0 min-h-[42px] flex-col"
                        />
                    ) : null}
                </header>

                {/* Barra inferior de restauración: reaparece el menú completo (todos los módulos). */}
                {navCollapsed && (
                    <button
                        type="button"
                        className="nav-restore-bar"
                        onClick={() => setNavCollapsed(false)}
                        title={t('nav.restore')}
                    >
                        <ChevronDown size={15} aria-hidden />
                        <span>{t('nav.restore')}</span>
                        {activeGroup?.title && <span className="nav-restore-bar__ctx">{activeGroup.title}</span>}
                    </button>
                )}

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
                            {/* Una sola frontera Suspense para todo el host de vistas: solo
                                hay una vista montada a la vez (todas las ramas de abajo son
                                excluyentes por activeTab), así que no hace falta una por vista. */}
                            <React.Suspense fallback={<ViewLoader label={t('common.loading')} />}>
                            {activeTab === 'Inclinometer' && (
                                <GeotechWorkbench tabKey="Inclinometer">
                                    <InclinometerCharts
                                        xRange={xRange}
                                        yRange={yRange}
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
                            {activeTab === 'KPIs Operación' && (
                                <KpiOperationsView telemetryTenantId={telemetryScope.telemetryTenantId} />
                            )}
                            {activeTab === 'Alarmas' && (
                                <AlarmCenter
                                    telemetryTenantId={telemetryScope.telemetryTenantId}
                                    onCreateReportFromAlarm={() => {
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
                                    <DisplacementCharts xRange={xRange} yRange={yRange} />
                                </GeotechWorkbench>
                            )}
                            {activeTab === 'Report' && <RichTextEditor />}
                            {/* ADR-079: antes estas tres vistas solo dependían del filtro de
                                menú lateral (canMaintain, más abajo) para no aparecer — si
                                activeTab llegaba a valer 'UserManagement'/'Permissions'/
                                'AlarmConfig' por cualquier otra vía, el componente se montaba
                                igual. Se agrega el mismo guard aquí, en el punto real de
                                render, consistente con el que ya protegía a UserMaintenanceModal. */}
                            {activeTab === 'UserManagement' && canMaintain && (
                                <UserManagementView />
                            )}
                            {activeTab === 'CompanyManagement' && canViewCompanies && (
                                <CompanyManagementView />
                            )}
                            {activeTab === 'Permissions' && canMaintain && (
                                <PermissionsManagementView />
                            )}
                            {activeTab === 'AlarmConfig' && canMaintain && (
                                <AlarmConfigView />
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
                            </React.Suspense>
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
                                                className={`flex-1 py-1 text-[11px] font-bold transition-all relative ${sidebarTab === tab ? 'text-orange-600 dark:text-orange-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                            >
                                                {tab}
                                                {sidebarTab === tab && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-orange-600 dark:bg-orange-400 rounded-full" />}
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
            {/* fallback={null}: son modales: mientras baja su chunk no debe
                aparecer nada encima de la pantalla. Se mantienen las mismas
                condiciones de montaje que antes de diferirlos (AuditCenter ya
                se auto-oculta con !open), así que no cambia el estado interno
                que conservaban entre aperturas. */}
            <React.Suspense fallback={null}>
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
            </React.Suspense>
            {canMaintain && showUserMaintenancePrompt && (
                <div className="fixed inset-0 z-[1100] bg-slate-950/55 backdrop-blur-[2px] flex items-center justify-center px-4">
                    <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
                        <div className="px-6 py-5 border-b border-slate-200 bg-gradient-to-r from-orange-50 via-white to-orange-100">
                            <h3 className="text-base font-extrabold text-slate-800">{t('maintenance.title')}</h3>
                            <p className="mt-1 text-sm text-slate-600">
                                {t('maintenance.logged', { company: session?.company || t('maintenance.unit') })}
                            </p>
                        </div>
                        <div className="px-6 py-5 text-sm text-slate-700">
                            {t('maintenance.question')}
                        </div>
                        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
                            <button
                                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100 transition-colors"
                                onClick={() => setShowUserMaintenancePrompt(false)}
                            >
                                {t('maintenance.later')}
                            </button>
                            <button
                                className="px-4 py-2 rounded-lg border border-orange-700 bg-orange-600 text-white font-semibold hover:bg-orange-700 transition-colors"
                                onClick={() => {
                                    setShowUserMaintenancePrompt(false)
                                    setShowUserMaintenance(true)
                                }}
                            >
                                {t('maintenance.open')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {avatarPreviewOpen && headerAvatarDataUrl && (
                <div
                    className="avatar-preview-overlay"
                    onMouseDown={() => setAvatarPreviewOpen(false)}
                    role="presentation"
                >
                    <section
                        className="avatar-preview-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="avatar-preview-title"
                    >
                        <header className="avatar-preview-dialog__header">
                            <div>
                                <p className="avatar-preview-dialog__eyebrow">{t('avatar.eyebrow')}</p>
                                <h2 id="avatar-preview-title">
                                    {session?.fullName || session?.username || t('avatar.user')}
                                </h2>
                            </div>
                            <button
                                type="button"
                                className="avatar-preview-dialog__close"
                                onClick={() => setAvatarPreviewOpen(false)}
                                aria-label={t('avatar.close')}
                                autoFocus
                            >
                                <X size={19} />
                            </button>
                        </header>
                        <div className="avatar-preview-dialog__body">
                            {avatarHdLoading && (
                                <div className="avatar-preview-loading" role="status">
                                    <span />
                                    {t('avatar.loading4k')}
                                </div>
                            )}
                            <img
                                src={avatarHdUrl || headerAvatarDataUrl}
                                alt={t('avatar.enlargedAlt', { name: session?.fullName || session?.username || t('audit.user') })}
                                className={avatarHdLoading ? 'is-loading' : ''}
                                onMouseDown={(event) => event.stopPropagation()}
                                draggable={false}
                            />
                        </div>
                        <footer className="avatar-preview-dialog__footer">
                            <span className={avatarHdUrl ? 'is-ready' : avatarHdFailed ? 'is-fallback' : ''}>
                                {avatarHdUrl
                                    ? t('avatar.ready4k')
                                    : avatarHdFailed
                                      ? t('avatar.fallback')
                                      : t('avatar.protected')}
                            </span>
                            <small>{t('avatar.closeHelp')}</small>
                        </footer>
                    </section>
                </div>
            )}
            <ConfirmActionHost />
        </div>
    )
}

const App = () => {
    const [session, setSession] = useState<AppSession | null>(() => {
        return getSession()
    })

    if (!session) {
        return <AuthGateway onAuthenticated={setSession} />
    }

    return (
        <DashboardApp
            session={session}
            onLogout={() => {
                // ADR-029 (revisado): logout revoca la sesión en el servidor
                // (best-effort) antes/junto con limpiar el estado local.
                void logoutApi()
                // ADR-079: sin esto, la caché de permisos (module-level, no
                // atada al ciclo de vida de un componente) sobreviviría al
                // logout y un login posterior con OTRO usuario en la misma
                // pestaña vería el permiso de la sesión anterior hasta que
                // cambiara userId/tenantId de forma distinta.
                invalidatePermissionsCache()
                setSession(null)
            }}
        />
    )
}

export default App
