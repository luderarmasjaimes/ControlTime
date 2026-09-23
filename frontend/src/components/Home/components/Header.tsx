import React from 'react';
import { ShieldCheck, Activity, Sparkles, Cpu, Building2, Wrench, Globe } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nProvider'
import { formatInternationalTel, phonePrefixForCountry } from '../../../auth/platformPrefs'
import PlatformRegionBar from '../../Platform/PlatformRegionBar'

interface HeaderProps {
  onOpenLogin: () => void;
  onOpenRegister: () => void;
  activeSection: string;
  setActiveSection: (section: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenLogin,
  onOpenRegister,
  activeSection,
  setActiveSection,
}) => {
    const { t, countryIso2: country, localizeMessage } = useI18n()
    const activePhonePrefix = phonePrefixForCountry(country, undefined)

  return (
    <>
      <div className="hidden lg:flex items-center justify-between px-6 py-0.5 bg-[#0a1122] text-xs text-slate-400 border-b border-[#3A3D40]/50">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            {t('header.systemOnline')}
          </span>
        </div>

        <div className="flex items-center gap-4">

          {/* Interactive Language Selector */}
          <PlatformRegionBar variant="auth" />

          <span className="text-slate-500">|</span>
          <span className="text-slate-400">{t('header.supportCall')}</span>
        </div>
      </div>
    <div className="sticky top-0 z-40 bg-[#070c18]/90 backdrop-blur-md border-b border-[#3A3D40]/60 text-slate-100">

      {/* Main Navigation Header */}
      <div className=" max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo */}
        <div 
          onClick={() => setActiveSection('hero')}
          className="flex items-center gap-3 cursor-pointer group"
        >
          <div className="w-8 h-8 bg-[#F05A28] rounded-sm flex items-center justify-center font-bold text-slate-950 font-mono text-base shadow-lg shadow-[#F05A28]/20 group-hover:scale-105 transition-transform">
            Ω
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl tracking-tight text-white uppercase font-sans">
                BEEMETRY <span className="text-[#F05A28]">OS</span>
              </span>
              <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 bg-[#F05A28]/15 text-[#FCD3B0] border border-[#F05A28]/40 rounded font-bold">
                {t('header.brandTag')}
              </span>
            </div>
            <p className="text-[10px] text-[#E1E4E8]/70 tracking-widest uppercase font-semibold">
              {t('header.brandSub')}
            </p>
          </div>
        </div>

        {/* Center Nav Items */}
        <nav className="hidden xl:flex items-center gap-1 bg-[#0D121F] p-1 rounded-lg border border-[#3A3D40] text-xs font-medium">
          <button
            onClick={() => setActiveSection('hero')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeSection === 'hero'
                ? 'bg-[#F05A28] text-slate-950 font-bold shadow-sm'
                : 'text-slate-300 hover:text-[#F05A28] hover:bg-[#1A2338]'
            }`}
          >
            {t('header.nav.home')}
          </button>
          <button
            onClick={() => setActiveSection('empresa')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeSection === 'empresa'
                ? 'bg-[#F05A28] text-slate-950 font-bold shadow-sm'
                : 'text-slate-300 hover:text-[#F05A28] hover:bg-[#1A2338]'
            }`}
          >
            {t('header.nav.about')}
          </button>
          <button
            onClick={() => setActiveSection('ventajas')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeSection === 'ventajas'
                ? 'bg-[#F05A28] text-slate-950 font-bold shadow-sm'
                : 'text-slate-300 hover:text-[#F05A28] hover:bg-[#1A2338]'
            }`}
          >
            {t('header.nav.advantages')}
          </button>
          <button
            onClick={() => setActiveSection('servicios')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeSection === 'servicios'
                ? 'bg-[#F05A28] text-slate-950 font-bold shadow-sm'
                : 'text-slate-300 hover:text-[#F05A28] hover:bg-[#1A2338]'
            }`}
          >
            {t('header.nav.services')}
          </button>
          <button
            onClick={() => setActiveSection('implementaciones')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeSection === 'implementaciones'
                ? 'bg-[#F05A28] text-slate-950 font-bold shadow-sm'
                : 'text-slate-300 hover:text-[#F05A28] hover:bg-[#1A2338]'
            }`}
          >
            Futuras implementaciones
          </button>
          <button
            onClick={() => setActiveSection('cursos')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              activeSection === 'cursos'
                ? 'bg-[#F05A28] text-slate-950 font-bold shadow-sm'
                : 'text-slate-300 hover:text-[#F05A28] hover:bg-[#1A2338]'
            }`}
          >
            Cursos
          </button>
        </nav>

        {/* Right CTA Buttons & Language Switcher (mobile) */}
        <div className="flex items-center gap-3">
          {/* Mobile language selector */}
          

          {/* Login Button */}
          <button
            onClick={onOpenLogin}
            className="bg-[#F05A28] hover:bg-[#d94d1f] text-slate-950 px-4 sm:px-5 py-2 rounded-md text-xs font-bold transition-all shadow-md shadow-[#F05A28]/25 uppercase tracking-wider"
          >
            {t('header.login')}
          </button>

          {/* Register Unit Primary CTA */}
          {/* <button
            onClick={onOpenRegister}
            className="bg-[#F05A28] hover:bg-[#d94d1f] text-slate-950 px-4 sm:px-5 py-2 rounded-md text-xs font-bold transition-all shadow-md shadow-[#F05A28]/25 uppercase tracking-wider"
          >
            {t('header.register')}
          </button> */}
        </div>
      </div>
    </div>
    </>
  );
};
