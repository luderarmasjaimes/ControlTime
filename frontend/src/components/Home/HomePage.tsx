import React, { useState } from 'react';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { CompanyOverviewSection } from './components/CompanyOverviewSection';
import { AdvantagesSection } from './components/AdvantagesSection';
import { ControlCenterShowcase } from './components/ControlCenterShowcase';
import { SoftwareModulesSection } from './components/SoftwareModulesSection';
import { ServicesSection } from './components/ServicesSection';
import { BrandSupportCarousel } from './components/BrandSupportCarousel';
import { FlowchartsShowcase } from './components/FlowchartsShowcase';
import { WordEditorShowcase } from './components/WordEditorShowcase';
import { VoiceDictationShowcase } from './components/VoiceDictationShowcase';
import { MiningUnitsSection } from './components/MiningUnitsSection';
import { ClientsCarousel } from './components/ClientsCarousel';
import { WhatsAppButton } from './components/WhatsAppButton';
import { Footer } from './components/Footer';
import { FacialScanModal } from './components/FacialScanModal';
import { LiveSystemDashboard } from './components/LiveSystemDashboard';
import { FutureImplementationsSection } from './components/FutureImplementationsSection'
import { TrainingCoursesSection } from './components/TrainingCoursesSection'
import { UserState } from './types';
import './home.css';

interface HomePageProps {
  onOpenLogin: () => void
}

const HomePage = ({onOpenLogin}: HomePageProps) => {
  const [activeSection, setActiveSection] = useState('hero');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [loginModalMode, setLoginModalMode] = useState<'login' | 'register'>('login');
  const [isFacialScanOpen, setIsFacialScanOpen] = useState(false);
  // Persona 100% ficticia para la demo interactiva de la página pública
  // (ADR-171): nombre, DNI y empresa inventados a propósito -- no deben
  // coincidir con una persona real ni con una empresa minera real, ya que
  // este estado alimenta el panel "en vivo" simulado (LiveSystemDashboard)
  // que cualquier visitante puede activar sin autenticarse de verdad.
  const [userState, setUserState] = useState<UserState>({
    isLoggedIn: false,
    userType: 'persona',
    name: 'Ing. Demo Beemetry',
    dniOrRuc: '00000000',
    company: 'Unidad Minera Demostración',
    role: 'Superintendente de Geotecnia (cuenta de demostración)',
    facialAuthEnabled: true,
  });

  // Función para cambiar de vista y resetear el scroll al tope
  const handleNavigateSection = (section: string) => {
    setActiveSection(section);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenLogin = () => {
    setLoginModalMode('login');
    setIsLoginModalOpen(true);
  };

  const handleOpenRegister = () => {
    setLoginModalMode('register');
    setIsLoginModalOpen(true);
  };

  const handleTriggerFacialScan = () => {
    setIsLoginModalOpen(false);
    setIsFacialScanOpen(true);
  };

  const handleFacialScanComplete = () => {
    setIsFacialScanOpen(false);
    setUserState((prev) => ({
      ...prev,
      isLoggedIn: true,
    }));
  };

  const handleLogout = () => {
    setUserState((prev) => ({
      ...prev,
      isLoggedIn: false,
    }));
  };

  // Switch de renderizado: Aquí ocurre la magia para no mostrar todo a la vez
  const renderActiveSection = () => {
    switch (activeSection) {
      case 'hero':
        return(
          <>
            <HeroSection onOpenLogin={onOpenLogin} onNavigateSection={handleNavigateSection} />
            <SoftwareModulesSection />
            <ControlCenterShowcase onOpenLogin={handleOpenLogin} />
            <FlowchartsShowcase />
            <WordEditorShowcase />
            <VoiceDictationShowcase />
            <MiningUnitsSection />
            <ClientsCarousel />

          </>
        );
      case 'empresa':
        return <CompanyOverviewSection />;
      case 'ventajas':
        return <AdvantagesSection />;
      case 'servicios':
        return(
          <>
            <ServicesSection />
            <BrandSupportCarousel />
          </>
        ) ;
      case 'implementaciones':
        return <FutureImplementationsSection />;
      case 'cursos':
        return <TrainingCoursesSection />;
      default:
        return <HeroSection onOpenLogin={onOpenLogin} onNavigateSection={handleNavigateSection} />;
    }
  };

  // Vista cuando el usuario está logeado
  if (userState.isLoggedIn) {
    return (
      <LiveSystemDashboard
        userState={userState}
        onLogout={handleLogout}
      />
    );
  }

  // Vista pública
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden text-slate-100 font-sans selection:bg-amber-500 selection:text-slate-950">
      
      <main className="min-h-0 flex-1 overflow-y-auto content-scroll">
        
        {/* El Header siempre se queda fijo arriba */}
        <Header
          onOpenLogin={onOpenLogin}
          onOpenRegister={handleOpenRegister}
          activeSection={activeSection}
          setActiveSection={handleNavigateSection}
        />

        {/* --- CONTENIDO DINÁMICO --- */}
        {renderActiveSection()}

        {/* Footer siempre abajo */}
        <Footer />
      </main>

      <WhatsAppButton />

      <FacialScanModal
        isOpen={isFacialScanOpen}
        onClose={() => setIsFacialScanOpen(false)}
        onScanComplete={handleFacialScanComplete}
      />
    </div>
  );
}

export default HomePage;