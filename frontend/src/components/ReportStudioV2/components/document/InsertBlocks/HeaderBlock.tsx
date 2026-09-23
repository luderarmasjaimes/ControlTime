import { Html } from 'react-konva-utils';
import type { ReportElement } from '../../../store/useEditorStore';
import { getSession } from '../../../../../auth/authStorage';
import { resolveMiningUnitName } from '../../../lib/sessionChrome';
import { PLATFORM_CHROME_FONT, PLATFORM_CHROME_FONT_SIZE, PLATFORM_CHROME_COLOR, HeaderLogoImg } from './shared/platformChrome';

interface HeaderBlockProps {
  element: ReportElement;
  /** `tenantId` propio de la página (prop de PageCanvas) -- usado como
   * fallback cuando el bloque no trae uno explícito en `props.tenantId` ni
   * hay sesión activa con uno propio. */
  tenantId?: string;
}

/** Encabezado automático de página (ADR-046) -- empresa/unidad/usuario NUNCA
 * se leen de props (ya no existen ahí) -- se calculan en vivo desde la
 * sesión activa en cada render, así el bloque no puede quedar desactualizado
 * ni ser editado a mano. Bloqueado, sin interacción (`pointerEvents: 'none'`
 * en el `<Html>`) -- no acepta menú contextual ni arrastre. */
export default function HeaderBlock({ element, tenantId }: HeaderBlockProps) {
  const p = element.props || {};
  const session = getSession();
  const chromeParts = [session?.company, resolveMiningUnitName(session), session?.fullName || session?.username]
    .filter((v): v is string => Boolean(v && v.trim()));
  const chromeLabel = chromeParts.length > 0 ? chromeParts.join('  •  ').toUpperCase() : 'EMPRESA MINERA';
  return (
    <Html key={`${element.id}-header`} groupProps={{ x: element.x + 4, y: element.y + 4, listening: false }} divProps={{ style: { pointerEvents: 'none' } }}>
      <div
        className="report-canvas-html-shield"
        style={{
          width: element.width - 8, height: element.height - 8,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '2px solid #0f172a', boxSizing: 'border-box', padding: '0 4px', gap: 12,
        }}>
        {/* Alineado al margen izquierdo — empresa + unidad + usuario conectado, fijo (no editable) */}
        <span style={{
          fontFamily: PLATFORM_CHROME_FONT, fontSize: PLATFORM_CHROME_FONT_SIZE, fontWeight: 900,
          letterSpacing: 0.4, color: PLATFORM_CHROME_COLOR, whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis', minWidth: 0,
        }}>
          {chromeLabel}
        </span>
        {/* Lado derecho — logotipo corporativo (SVG, tenant_logo) */}
        {p.showLogo !== false && (
          <div style={{ height: '100%', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <HeaderLogoImg tenantId={p.tenantId || tenantId || session?.tenantId} />
          </div>
        )}
      </div>
    </Html>
  );
}
