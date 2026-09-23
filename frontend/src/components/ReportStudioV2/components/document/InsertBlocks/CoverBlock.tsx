import { Html } from 'react-konva-utils';
import type { ReportElement } from '../../../store/useEditorStore';
import { getSession } from '../../../../../auth/authStorage';
import { resolveMiningUnitName } from '../../../lib/sessionChrome';
import { findCoverTemplate } from '../../../lib/coverTemplates';
import { PLATFORM_CHROME_FONT, HeaderLogoImg } from './shared/platformChrome';

interface CoverBlockProps {
  element: ReportElement;
  tenantId?: string;
  onContextMenu: (elementId: string, event: React.MouseEvent) => void;
}

/** Carátula a toda hoja (ADR-046/ADR-048) -- empresa/unidad/autor jamás se
 * leen de props, se calculan en vivo desde la sesión activa (mismo criterio
 * que el encabezado), así no pueden quedar desactualizados ni ser editados/
 * borrados a mano desde el panel de propiedades. 5 diseños reales por
 * audiencia (Gerencia/Control Interno/Auditoría Interna/Campo/Normativo,
 * ver lib/coverTemplates.ts) -- `props.bgColor`/`textColor`/`classification`/
 * `title` explícitos del usuario SIEMPRE ganan sobre la plantilla, esta solo
 * rellena lo que el usuario no personalizó. */
export default function CoverBlock({ element, tenantId, onContextMenu }: CoverBlockProps) {
  const p = element.props || {};
  const session = getSession();
  const chromeCompany = session?.company;
  const chromeUnit = resolveMiningUnitName(session);
  const chromeAuthor = session?.fullName || session?.username;
  const tpl = findCoverTemplate(p.coverTemplate);
  return (
    <Html key={`${element.id}-cover`} groupProps={{ x: element.x, y: element.y, listening: false }} divProps={{ style: { pointerEvents: 'none' } }}>
      <div
        className="report-canvas-html-shield"
        onContextMenu={(e) => onContextMenu(element.id, e)}
        style={{
          width: element.width, height: element.height, overflow: 'hidden',
          position: 'relative', display: 'flex', flexDirection: 'column',
          boxSizing: 'border-box', color: p.textColor || tpl.textColor,
          fontFamily: tpl.bodyFontFamily || 'inherit',
          // ADR-048 (revisado): la carátula ya NO admite una foto
          // como fondo propio (generaba un mosaico repetido y, al
          // ser un bloque bloqueado, esa foto no se podía mover ni
          // redimensionar). La foto de la unidad minera ahora es
          // un bloque `image` independiente y libre (insertado centrado
          // sobre esta misma página vía "Insertar Imagen Empresa"). El color
          // de fondo es configurable (props.bgColor); si no se
          // definió ninguno se usa el fondo de la plantilla elegida.
          background: p.bgColor || tpl.background,
        }}>
        {/* Franja de clasificación — todo el ancho de la hoja */}
        <div style={{ background: tpl.classificationBg, color: tpl.classificationColor, fontSize: 12, fontWeight: 800, letterSpacing: 2, textAlign: 'center', padding: '10px 0', textTransform: 'uppercase' }}>
          {p.classification || tpl.classificationLabel}
        </div>
        {/* Logotipo de la empresa — esquina superior derecha */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '20px 40px 0' }}>
          <div style={{ background: '#ffffff', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', minHeight: 40 }}>
            <HeaderLogoImg tenantId={p.tenantId || tenantId || session?.tenantId} />
          </div>
        </div>
        {/* Título + empresa + unidad — anclado al pie de este
           bloque (no centrado verticalmente): deja libre toda la
           franja superior para la foto de la unidad minera, que
           se inserta ahí arriba del texto (pedido explícito: "la
           imagen mas arriba y el texto debajo de la imagen"). */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: '24px 56px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 44, fontWeight: 900, margin: '0 0 16px', lineHeight: 1.15, textShadow: '0 2px 16px rgba(0,0,0,0.45)', fontFamily: tpl.titleFontFamily }}>
            {p.title || tpl.titleFallback}
          </h1>
          {(chromeCompany || chromeUnit) && (
            <div style={{ width: 64, height: 3, borderRadius: 2, background: tpl.accentColor, margin: '0 0 16px', opacity: 0.9 }} />
          )}
          {chromeCompany && <div style={{ fontSize: 22, fontWeight: 700, textShadow: '0 1px 8px rgba(0,0,0,0.4)' }}>{chromeCompany}</div>}
          {chromeUnit && <div style={{ fontSize: 16, opacity: 0.9, marginTop: 4, letterSpacing: 0.5 }}>{chromeUnit}</div>}
        </div>
        {/* Metadatos + marca Beemetry — franja inferior */}
        <div style={{
          borderTop: `1px solid ${tpl.accentColor}55`, padding: '18px 40px',
          display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between',
          background: tpl.footerBg,
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12 }}>
            {p.docCode && <span><b>Código:</b> {p.docCode}</span>}
            {chromeAuthor && <span><b>Autor:</b> {chromeAuthor}</span>}
            {p.date && <span><b>Fecha:</b> {p.date}</span>}
          </div>
          {/* "Logotipo" de plataforma (wordmark) — pedido explícito
             del negocio ("tampoco vemos el logotipo... de BEEMETRY"),
             mismo tratamiento tipográfico que header/footer. */}
          <span style={{
            fontFamily: PLATFORM_CHROME_FONT, fontSize: 13, fontWeight: 900,
            letterSpacing: 1.2, opacity: 0.95,
          }}>
            BEEMETRY
          </span>
        </div>
      </div>
    </Html>
  );
}
