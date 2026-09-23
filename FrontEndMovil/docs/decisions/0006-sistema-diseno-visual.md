# ADR-0006 — Sistema de diseño visual: mismos tokens que el frontend web, tema oscuro único

**Status**: accepted
**Fecha**: 2026-09-20
**Autores**: Claude Code (análisis técnico), revisado por Luder Armas
**Ámbito**: frontend-movil, diseño

## Contexto

El frontend web (`frontend/src/index.css`, `frontend/src/brand/`) define una
identidad visual concreta y ya validada por el negocio: base "slate" oscura
+ acento ámbar/naranja quemado, cuatro familias tipográficas con roles
distintos, y un lenguaje de navegación con "relieve 3D sutil"
([ADR-040](../../../docs/decisions/040-sistema-diseno-navegacion-enterprise.md)
del repo principal). Nota: `frontend/styles.css` es un sistema de tokens
**distinto y no relacionado** (una herramienta interna de gestión de
tilesets GIS con paleta púrpura/índigo) — no es la fuente de verdad de la
marca Beemetry/AURIXA y no se usa como referencia aquí.

## Decisión

Se replican exactamente los tokens de `frontend/src/index.css` como
`ThemeData` de Flutter, en un **tema oscuro único** (la plataforma nunca
ofrece modo claro en el shell autenticado hoy):

### Colores
```dart
primary       = Color(0xFFF07E41)  // ámbar/naranja quemado (acento de marca)
primaryGlow   = Color(0x66F07E41)  // rgba(240,126,65,0.4)
secondary     = Color(0xFF476074)  // azul-gris acero
accent        = Color(0xFFFF813D)  // variante más brillante del acento
bgMain        = Color(0xFF020617)  // navy casi negro
bgSidebar     = Color(0xFF0F172A)  // slate-900
bgCard        = Color(0x801E293B)  // slate-800 translúcido
textMain      = Color(0xFFF8FAFC)  // casi blanco
textDim       = Color(0xFF94A3B8)  // slate-400
border        = Color(0x14FFFFFF)  // rgba(255,255,255,0.08)
```
El acento ámbar se usa como **glow/anillo** (sombras, bordes de foco,
resaltado de estado activo), nunca como relleno sólido de un componente
grande — mismo principio que ADR-040 (evitar leerse como "cinta de
seguridad industrial").

### Tipografía (`google_fonts`)
- **Inter** — cuerpo de texto / UI general.
- **Outfit** — títulos, marca/wordmark.
- **Barlow Semi Condensed** — títulos con acento "minero" (paneles técnicos).
- **Rajdhani** — etiquetas condensadas de navegación (pestañas, chips).

### Componentes
- Botones de navegación (categorías del Drawer, pestañas de módulo):
  esquinas redondeadas (`BorderRadius.circular(10)`), gradiente slate oscuro
  de fondo, sombra en capas para el "relieve 3D sutil" (sombra exterior +
  highlight interior superior), anillo ámbar en el estado activo — traducción
  directa de `.enterprise-main-btn`/`.enterprise-sub-btn` del frontend web.
- Codificación semántica de color para insignias/badges (igual criterio que
  ADR-040): esmeralda = en vivo, cian = beta, violeta = pro, ámbar = nuevo,
  índigo = acciones de administración, rojo = acciones destructivas
  (ej. cerrar sesión).
- Logo: `aurixa-logo.svg` (mismo asset del frontend web, vía `flutter_svg`).

### Nomenclatura
Se mantiene el criterio de
[ADR-042](../../../docs/decisions/042-nomenclatura-menus-lenguaje-llano-minero.md):
etiquetas visibles en lenguaje llano minero (Gestión, Control, Terreno,
Mapas, Permisos, Informes y los nombres de módulo dentro de cada uno),
reservando terminología técnica solo para donde el usuario minero ya la
espera (talud, geotecnia, telemetría) — nunca para jerga de software.

## Consecuencias

### Positivas
- Un usuario que ya usa el frontend web reconoce inmediatamente la marca al
  abrir la app móvil — cero disonancia visual entre clientes.
- Cuatro tipografías vía `google_fonts` no tiene costo de licencia ni de
  distribución de assets propios.

### Negativas / Trade-offs
- No se ofrece tema claro en esta primera versión (igual que el frontend
  web hoy) — si el negocio lo pide más adelante, es una extensión del
  `ThemeData`, no un cambio de arquitectura.
- Los `BoxShadow` en capas para el efecto de relieve 3D tienen un costo de
  rendimiento marginal mayor que un color plano — aceptable dado que son
  solo los botones de navegación, no listas largas.

## Referencias
- `frontend/src/index.css`, `frontend/src/brand/platformBrand.config.ts`
  (repo principal — fuente de verdad de los tokens; **no**
  `frontend/styles.css`, que es un sistema no relacionado)
- `docs/decisions/040-sistema-diseno-navegacion-enterprise.md`,
  `042-nomenclatura-menus-lenguaje-llano-minero.md` (repo principal)
- `lib/core/theme/` (este proyecto)
