import React, { useState } from 'react'
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
} from 'lucide-react'
    // Hubspot is removed as it is not available in lucide-react
import { motion, AnimatePresence } from 'framer-motion'
import AnimatedButton from './components/UI/AnimatedButton'
import InclinometerCharts from './components/Special/InclinometerCharts'
import Viewer3D from './components/Viewer/Viewer3D'
import MapViewer from './components/Special/MapViewer'
import AzimuthCompass from './components/Special/AzimuthCompass'
import DisplacementCharts from './components/Special/DisplacementCharts'
import MiningDashboard from './components/Dashboard/MiningDashboard'
import VideoDiagram from './components/Special/VideoDiagram'
import QRGenerator from './components/Special/QRGenerator'
import RichTextEditor from './components/Editor/RichTextEditor'
import AuthGateway from './components/Auth/AuthGateway'
import AuditCenter from './components/Auth/AuditCenter'
import { clearSession, getSession } from './auth/authStorage'

const DashboardApp = ({ session, onLogout }) => {
    const [activeTab, setActiveTab] = useState('Dashboard')
    const [sidebarTab, setSidebarTab] = useState('Azimuth')
    const [azimuthAngle, setAzimuthAngle] = useState(45)
    const [installationAngle, setInstallationAngle] = useState(55)
    const [azimuthOffset, setAzimuthOffset] = useState(true)
    const [dbStatus, setDbStatus] = useState('Sincronizado')
    const [showMenu, setShowMenu] = useState(false)
    const [showQR, setShowQR] = useState(false)
    const [showAuditCenter, setShowAuditCenter] = useState(false)
    const isAdmin = (session?.role || '').toLowerCase() === 'admin'

    // Scale states
    const [xMin, setXMin] = useState(-40)
    const [xMax, setXMax] = useState(40)
    const [yMin, setYMin] = useState(0)
    const [yMax, setYMax] = useState(40)
    const [showTitles, setShowTitles] = useState(true)

    const rightSidebarTabs = ['Inclinometer', 'Displacement Cumulative', '3D', 'Surveillance']
    const showRightSidebar = rightSidebarTabs.includes(activeTab)

    const tabs = [
        { name: 'Dashboard', icon: Activity },
        { name: 'Inclinometer', icon: Activity },
        { name: 'Displacement Cumulative', icon: Layers },
        { name: '3D', icon: FileText },
        { name: 'Map', icon: MapIcon },
        { name: 'Surveillance', icon: Compass },
        { name: 'Report', icon: FileText }
    ]

    return (
        <div className="flex h-screen w-full bg-[#f8fafc] dark:bg-[#020617] text-slate-900 dark:text-slate-100 font-sans selection:bg-blue-500/30 overflow-hidden">

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0">

                {/* Top Header / Tab Bar */}
                <header className="h-14 flex items-center px-6 gap-4 border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md">
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                        {tabs.map(t => {
                            const Icon = t.icon
                            return (
                                <button
                                    key={t.name}
                                    onClick={() => setActiveTab(t.name)}
                                    className={`tab-button ${activeTab === t.name
                                        ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400'
                                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'} `}
                                >
                                    <Icon size={14} />
                                    <span className="hidden sm:inline">{t.name}</span>
                                </button>
                            )
                        })}
                    </div>

                    <div className="flex-1" />

                    <div className="flex items-center gap-3 text-[10px] text-slate-500 font-medium">
                        <Clock size={12} />
                        <span>Jan 27 2018 - Apr 08 2025</span>
                    </div>

                    <div className="flex items-center gap-2 relative">
                        <div className="hidden md:flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-300">
                            <span className="font-bold">{session?.fullName || 'Usuario'}</span>
                            <span className="text-slate-400">{session?.company || 'Empresa'}</span>
                        </div>
                        <button
                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-blue-500 bg-blue-50 dark:bg-blue-900/20"
                            onClick={() => setShowQR(true)}
                        >
                            <Download size={16} />
                        </button>
                        <button
                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400"
                            onClick={() => setShowMenu(!showMenu)}
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
                            className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-500"
                            onClick={onLogout}
                            title="Cerrar sesion"
                        >
                            <LogOut size={16} />
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
                </header>

                {/* Dynamic Visualization Bench */}
                <main className="flex-1 overflow-hidden relative flex bg-white">
                    <div className="flex-1 overflow-hidden">
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
                        {activeTab === 'Dashboard' && <MiningDashboard />}
                        {activeTab === 'Surveillance' && <VideoDiagram src="" />}
                        {activeTab === 'Displacement Cumulative' && (
                            <DisplacementCharts xRange={[xMin, xMax]} yRange={[yMin, yMax]} />
                        )}
                        {activeTab === 'Report' && <RichTextEditor />}
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
        </div>
    )
}

const App = () => {
    const [session, setSession] = useState(() => getSession())

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
