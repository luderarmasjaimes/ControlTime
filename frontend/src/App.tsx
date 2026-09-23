import React, { useEffect, useMemo, useState } from 'react'
import AuthGateway from './components/Auth/AuthGateway'
import HomePage from './components/Home/HomePage'
import NavBar from './components/UI/NavBar'
import { AvatarWidget } from './components/UI/AvatarWidget'
import { installNavClickGuard } from './lib/navClickGuard'
import { lazyWithRetry } from './lib/lazyWithRetry'

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
//
// Se usa lazyWithRetry (lib/lazyWithRetry.ts) en vez de React.lazy directo:
// una pestaña abierta desde ANTES de un deploy referencia el hash de chunk
// de la build anterior -- ese archivo ya no existe tras reconstruir el
// frontend (immutable cache, sin fallback), el import() 404 y React.lazy lo
// relanza como excepción de render que ViewErrorBoundary atrapa con un
// mensaje genérico sin relación con la vista. lazyWithRetry reintenta una
// vez con un reload completo de la página antes de dejar propagar el error.
// ─────────────────────────────────────────────────────────────────────────
const InclinometerCharts = lazyWithRetry(() => import('./components/Special/InclinometerCharts'))
const Viewer3D = lazyWithRetry(() => import('./components/Viewer/Viewer3D'))
const MapViewer = lazyWithRetry(() => import('./components/Special/MapViewer'))
const MiningGeoportalView = lazyWithRetry(() => import('./components/Special/MiningGeoportalView'))
const DetailedMap = lazyWithRetry(() => import('./components/Special/DetailedMap'))
const DisplacementCharts = lazyWithRetry(() => import('./components/Special/DisplacementCharts'))
const MiningDashboard = lazyWithRetry(() => import('./components/Dashboard/MiningDashboard'))
const VideoDiagram = lazyWithRetry(() => import('./components/Special/VideoDiagram'))
const RichTextEditor = lazyWithRetry(() => import('./components/Editor/RichTextEditor'))
const AdvancedSensors = lazyWithRetry(() => import('./components/Dashboard/AdvancedSensors'))
const KpiOperationsView = lazyWithRetry(() => import('./components/Dashboard/KpiOperationsView'))
const AlarmCenter = lazyWithRetry(() => import('./components/Dashboard/AlarmCenter'))
const TelemetryDashboard = lazyWithRetry(() => import('./components/Dashboard/TelemetryDashboard'))
const SimulationMonitor = lazyWithRetry(() => import('./components/Dashboard/SimulationMonitor'))
const GeotechWorkbench = lazyWithRetry(() => import('./components/Dashboard/GeotechWorkbench'))
const ReportStudioV2 = lazyWithRetry(() => import('./components/ReportStudioV2/App'))
const FormulaEngineEmbed = lazyWithRetry(() => import('./components/Formula/FormulaEngineEmbed'))
const UserManagementView = lazyWithRetry(() => import('./components/ReportStudioV2/components/views/UserManagementView'))
const CompanyManagementView = lazyWithRetry(() => import('./components/ReportStudioV2/components/views/CompanyManagementView'))
const PermissionsManagementView = lazyWithRetry(() => import('./components/ReportStudioV2/components/views/PermissionsManagementView'))
const AlarmConfigView = lazyWithRetry(() => import('./components/ReportStudioV2/components/views/AlarmConfigView'))
const SensorManagementView = lazyWithRetry(() => import('./components/ReportStudioV2/components/views/SensorManagementView'))
const FormulaOverviewView = lazyWithRetry(() => import('./components/ReportStudioV2/components/views/FormulaOverviewView'))
const WhatsappConfigView = lazyWithRetry(() => import('./components/ReportStudioV2/components/views/WhatsappConfigView'))
const SupportAdminView = lazyWithRetry(() => import('./components/ReportStudioV2/components/views/SupportAdminView'))
const CandidatesRrhhView = lazyWithRetry(() => import('./components/ReportStudioV2/components/views/CandidatesRrhhView'))

import { purgeOfflineCacheOnLogout } from './components/ReportStudioV2/lib/offlineSqlite'
import { getSession, clearSession, type Session } from './auth/authStorage'
import { logout as logoutApi, refreshAccessToken } from './auth/authApi'
import { usePermissions, invalidatePermissionsCache } from './auth/usePermissions'
import { telemetryTenantIdFromSession } from './auth/telemetryTenant'

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

type PublicView = 'home' | 'auth'

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

interface DashboardAppProps {
    session: AppSession
    onLogout: () => void
}

export const DashboardApp = ({ session, onLogout }: DashboardAppProps) => {
    const telemetryScope = telemetryScopeFromSession(session)
    const { hasPermission } = usePermissions()
    const isAdmin = (session?.role || '').toLowerCase() === 'admin'
    const canMaintain =
        isAdmin ||
        hasPermission('usuarios.manage') ||
        hasPermission('permisos.manage') ||
        hasPermission('alarmas.manage') ||
        hasPermission('dispositivos.manage')
    const canViewCompanies = isAdmin || hasPermission('empresas.view')
    const canManageSupport = isAdmin || hasPermission('soporte.manage')
    const canViewSupportAdmin =
        isAdmin || hasPermission('soporte.view') || hasPermission('soporte.manage') || Boolean(session?.department)
    const miningCompanyName = session?.company || session?.miningCompany || 'Empresa minera'
    const miningUnitName =
        session?.miningUnit ||
        session?.unitName ||
        session?.mineUnit ||
        session?.site ||
        'Unidad principal'

    const [activeTab, setActiveTab] = useState('Dashboard')
    const [azimuthAngle, setAzimuthAngle] = useState(45)
    const [installationAngle, setInstallationAngle] = useState(55)

    // Scale states (editados desde el panel "Edit profile" del NavBar)
    const [xMin, setXMin] = useState(-40)
    const [xMax, setXMax] = useState(40)
    const [yMin, setYMin] = useState(0)
    const [yMax, setYMax] = useState(40)
    // Referencia estable para InclinometerCharts/DisplacementCharts (memoizados,
    // ver React.memo): un literal `[xMin, xMax]` inline en el JSX se recrea en
    // cada render, lo que anularía el memo pese a que los valores no cambiaron.
    const xRange = useMemo<[number, number]>(() => [xMin, xMax], [xMin, xMax])
    const yRange = useMemo<[number, number]>(() => [yMin, yMax], [yMin, yMax])

    // Vista activa: NavBar es el chrome (menús, cabecera, sidebar de edición)
    // y solo indica qué pestaña está activa; el contenido en sí (qué
    // componente pesado montar) se decide y se importa aquí, para que NavBar
    // no tenga que conocer ni importar ninguna de estas vistas.
    // Red de seguridad de diagnóstico, SIEMPRE activa en producción (mismo
    // criterio que navClickGuard.ts para el incidente de 2026-09-11): causa
    // raíz real encontrada 2026-09-15 -- un usuario con rol `viewer` podía
    // llegar a `activeTab='DeviceManagement'` (vía el botón "Crear la primera
    // fórmula en Sensores" de FormulaOverviewView, que no filtraba por
    // permiso) sin tener `canMaintain`; como NINGUNA rama de abajo matcheaba,
    // el área de contenido quedaba completamente vacía (fondo oscuro =
    // "pantalla en negro", reportado como "se queda colgado"). El fix real
    // es no ofrecer navegación hacia una pestaña sin permiso (ver el paso de
    // `onOpenSensors` condicionado a `canMaintain` más abajo); este log +
    // fallback visible queda como red de seguridad para cualquier otro botón
    // futuro que caiga en el mismo error.
    const KNOWN_TAB_KEYS = new Set([
        'Inclinometer', '3D', 'Map', 'MiningGeoportal', 'ComplianceGeo', 'Mapa Detallado',
        'Dashboard', 'Sensores Técnicos', 'KPIs Operación', 'Alarmas', 'Surveillance',
        'Telemetría', 'SimulationMonitor', 'Displacement Cumulative', 'Report',
        'UserManagement', 'CompanyManagement', 'Permissions', 'AlarmConfig',
        'DeviceManagement', 'FormulaOverview', 'WhatsappConfig', 'SupportAdmin',
        'CandidatesRrhh', 'Report v2', 'Formula',
    ]);
    const PERMISSION_GATED_TABS: Record<string, { ok: boolean; need: string }> = {
        UserManagement: { ok: canMaintain, need: 'usuarios.manage / permisos.manage / alarmas.manage / dispositivos.manage / admin' },
        CompanyManagement: { ok: canViewCompanies, need: 'empresas.view / admin' },
        Permissions: { ok: canMaintain, need: 'usuarios.manage / permisos.manage / alarmas.manage / dispositivos.manage / admin' },
        AlarmConfig: { ok: canMaintain, need: 'usuarios.manage / permisos.manage / alarmas.manage / dispositivos.manage / admin' },
        DeviceManagement: { ok: canMaintain, need: 'usuarios.manage / permisos.manage / alarmas.manage / dispositivos.manage / admin' },
        WhatsappConfig: { ok: canManageSupport, need: 'soporte.manage / admin' },
        SupportAdmin: { ok: canViewSupportAdmin, need: 'soporte.view / soporte.manage / admin / depto. asignado' },
        CandidatesRrhh: { ok: canViewSupportAdmin, need: 'soporte.view / soporte.manage / admin / depto. asignado' },
    };
    const gate = PERMISSION_GATED_TABS[activeTab];
    if (gate && !gate.ok) {
        // eslint-disable-next-line no-console
        console.error('[TAB_DIAGNOSTIC] pantalla vacía: la pestaña activa está gateada por permiso y el usuario no lo tiene', {
            activeTab, permisoRequerido: gate.need, sessionRole: session?.role,
        });
    } else if (!KNOWN_TAB_KEYS.has(activeTab)) {
        // eslint-disable-next-line no-console
        console.error('[TAB_DIAGNOSTIC] pantalla vacía: activeTab no coincide con ninguna pestaña conocida', { activeTab });
    }

    const content = (
        <>
            {gate && !gate.ok && (
                <div className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-slate-950 text-slate-200">
                    <p className="text-sm font-black uppercase tracking-widest text-amber-400">Sin permiso para esta sección</p>
                    <p className="max-w-md text-center text-xs text-slate-400">
                        Tu rol actual ({session?.role || 'sin rol'}) no tiene el permiso necesario
                        ({gate.need}) para ver "{activeTab}". Volvé al menú y elegí otra sección.
                    </p>
                </div>
            )}
            {!gate && !KNOWN_TAB_KEYS.has(activeTab) && (
                <div className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-slate-950 text-slate-200">
                    <p className="text-sm font-black uppercase tracking-widest text-rose-400">Pestaña desconocida: "{activeTab}"</p>
                    <p className="max-w-md text-center text-xs text-slate-400">
                        Revisá la consola del navegador (mensaje [TAB_DIAGNOSTIC]) y compartí ese detalle.
                    </p>
                </div>
            )}
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
            {activeTab === 'SimulationMonitor' && (
                <SimulationMonitor telemetryTenantId={telemetryScope.telemetryTenantId} />
            )}
            {activeTab === 'Displacement Cumulative' && (
                <GeotechWorkbench tabKey="Displacement Cumulative">
                    <DisplacementCharts xRange={xRange} yRange={yRange} />
                </GeotechWorkbench>
            )}
            {activeTab === 'Report' && <RichTextEditor />}
            {/* ADR-079: antes estas tres vistas solo dependían del filtro de
                menú lateral (canMaintain, en NavBar) para no aparecer — si
                activeTab llegaba a valer 'UserManagement'/'Permissions'/
                'AlarmConfig' por cualquier otra vía, el componente se montaba
                igual. Se agrega el mismo guard aquí, en el punto real de
                render. */}
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
            {activeTab === 'DeviceManagement' && canMaintain && (
                <SensorManagementView onOpenAlarmConfig={() => setActiveTab('AlarmConfig')} />
            )}
            {activeTab === 'FormulaOverview' && (
                <FormulaOverviewView
                    onOpenSensors={canMaintain ? () => setActiveTab('DeviceManagement') : undefined}
                    onOpenCalculo={() => setActiveTab('Formula')}
                />
            )}
            {activeTab === 'WhatsappConfig' && canManageSupport && (
                <WhatsappConfigView />
            )}
            {activeTab === 'SupportAdmin' && canViewSupportAdmin && (
                <SupportAdminView />
            )}
            {activeTab === 'CandidatesRrhh' && canViewSupportAdmin && (
                <CandidatesRrhhView />
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
        </>
    )

    return (
        <>
            <NavBar
                session={session}
                onLogout={onLogout}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                xMin={xMin}
                setXMin={setXMin}
                xMax={xMax}
                setXMax={setXMax}
                yMin={yMin}
                setYMin={setYMin}
                yMax={yMax}
                setYMax={setYMax}
                azimuthAngle={azimuthAngle}
                setAzimuthAngle={setAzimuthAngle}
                installationAngle={installationAngle}
                setInstallationAngle={setInstallationAngle}
                content={content}
            />
            {/* Avatar animado (ADR-150/164): widget flotante montado una sola
                vez en el shell del dashboard para sobrevivir la navegación
                entre pestañas -- ver AvatarWidget.tsx. */}
            <AvatarWidget />
        </>
    )
}
const App = () => {
    const [session, setSession] = useState<AppSession | null>(() => {
        return getSession()
    })
    const [publicView, setPublicView] = useState<PublicView>('home')
    const [restoringSession, setRestoringSession] = useState<boolean>(() => !!getSession())

    // Guardia de diagnóstico en producción -- ver navClickGuard.ts (portado
    // del avance de Luder 2026-09-11, hallazgo real: un overlay flotante
    // tapando los botones de .mining-nav-rail).
    useEffect(() => installNavClickGuard(), [])

    useEffect(() => {
        if (!session) {
            setRestoringSession(false)
            return
        }
        let cancelled = false
        refreshAccessToken().then((token) => {
            if (cancelled) return
            if (!token) {
                // La cookie de refresh no existe/venció/fue revocada -- no hay
                // forma de recuperar la sesión sin volver a autenticarse.
                clearSession()
                setSession(null)
            }
            setRestoringSession(false)
        })
        return () => {
            cancelled = true
        }
        // Solo debe correr una vez al montar (o cuando session pasa de null a
        // un valor, tras un login) -- no en cada cambio de campo de session.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [!!session])

    if (restoringSession) {
        // Pantalla mínima: evita que el dashboard llegue a montar (y disparar
        // llamadas protegidas sin Bearer todavía) mientras se resuelve el
        // refresh silencioso -- solo se ve un instante en una recarga normal.
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a', color: '#94a3b8', fontSize: '0.85rem' }}>
                Restaurando sesión…
            </div>
        )
    }

    if (!session) {
        if (publicView === 'auth') {
            return <AuthGateway onAuthenticated={setSession} onBackToHome={() => setPublicView('home')} />
        }
        return <HomePage onOpenLogin={() => setPublicView('auth')} />
    }

    return (
        <DashboardApp
            session={session}
            onLogout={() => {
                // Debe leer la sesión SALIENTE (getSession() todavía no
                // limpiada -- clearSession() corre recién dentro del
                // .finally() de logoutApi(), tras el round-trip de red) para
                // saber qué caché offline aislar/purgar. Mismo motivo que
                // invalidatePermissionsCache() de abajo: sin esto, el
                // informe técnico offline de este usuario (datos de
                // cliente) quedaría accesible en texto plano en el
                // navegador para el siguiente que inicie sesión en el mismo
                // dispositivo (ADR-022 asume tablet de campo compartida).
                // Solo purga si no hay cambios offline sin sincronizar
                // (dirty=1) -- nunca convierte un logout en pérdida de
                // datos.
                void purgeOfflineCacheOnLogout()
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
                setPublicView('home')
            }}
        />
    )
}

export default App
