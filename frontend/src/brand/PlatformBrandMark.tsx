import React from 'react'
import {
    PLATFORM_ACCESS_LINE,
    PLATFORM_LOGO_SRC,
    PLATFORM_NAME,
    PLATFORM_SUITE_LINE,
} from './platformBrand.config'

/**
 * Marca en la esquina superior izquierda del panel de login/registro/biometría (credenciales),
 * no en toda la ventana. El resto de la app usa dashboard/toolbar globales.
 */
/** Dos líneas: nombre + subtítulo; el título «Acceso seguro» va debajo en el panel. */
export function PlatformBrandPanelHeader({
    subtitle = PLATFORM_SUITE_LINE,
    compact = false,
}: {
    subtitle?: string;
    compact?: boolean;
}) {
    return (
        <div
            className={`auth-panel-brand-header${compact ? ' auth-panel-brand-header--compact' : ''}`}
        >
            <img
                src={PLATFORM_LOGO_SRC}
                alt={PLATFORM_NAME}
                className="auth-panel-brand-header-logo"
            />
            <div className="auth-panel-brand-header-copy min-w-0">
                <div className="auth-panel-brand-name">{PLATFORM_NAME}</div>
                <div className="auth-panel-brand-tag">{subtitle}</div>
            </div>
        </div>
    )
}

/** @deprecated Solo si se requiere franja global; login/registro usan PlatformBrandPanelHeader. */
export function PlatformBrandAuthStrip({ suiteLine = PLATFORM_ACCESS_LINE }: { suiteLine?: string }) {
    return (
        <div className="auth-platform-brand-strip">
            <img src={PLATFORM_LOGO_SRC} alt={PLATFORM_NAME} className="enterprise-brand-logo" />
            <div className="enterprise-brand-copy min-w-0">
                <div className="enterprise-brand-company truncate">{PLATFORM_NAME}</div>
                <div className="enterprise-brand-suite truncate">{suiteLine}</div>
            </div>
        </div>
    )
}

/** Logo pequeño junto a la cabecera de la cámara biométrica. */
export function PlatformBrandCameraBadge({ size = 36 }: { size?: number }) {
    return (
        <img
            src={PLATFORM_LOGO_SRC}
            alt=""
            className="auth-camera-brand-logo"
            width={size}
            height={size}
        />
    )
}

/**
 * Bloque logo + texto para cabecera del dashboard (App.jsx).
 * linePrimary = operador de plataforma; lineSecondary = mina | unidad
 */
export function PlatformBrandDashboardBlock({ linePrimary, lineSecondary }: { linePrimary?: string; lineSecondary?: string }) {
    const primary = linePrimary || PLATFORM_NAME
    const secondary = lineSecondary || PLATFORM_SUITE_LINE
    return (
        <>
            <img src={PLATFORM_LOGO_SRC} alt={PLATFORM_NAME} className="enterprise-brand-logo" />
            <div className="enterprise-brand-copy min-w-0">
                <div className="enterprise-brand-company truncate">{primary}</div>
                <div className="enterprise-brand-suite truncate">{secondary}</div>
            </div>
        </>
    )
}

/** Informe corporativo / toolbar oscuro (Report Studio). */
export function PlatformBrandToolbarBlock({ titleLine, subtitleLine }: { titleLine?: string; subtitleLine?: string }) {
    const sub = subtitleLine || PLATFORM_SUITE_LINE
    return (
        <div className="studio-brand-wrap">
            <img
                src={PLATFORM_LOGO_SRC}
                alt={PLATFORM_NAME}
                className="enterprise-brand-logo"
                style={{ width: 44, height: 44, padding: 6 }}
            />
            <div className="studio-brand-copy">
                <strong>{titleLine || PLATFORM_NAME}</strong>
                <span>{sub}</span>
            </div>
        </div>
    )
}
