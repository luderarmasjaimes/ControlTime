# ADR-040 — Sistema de diseño unificado de navegación enterprise (slate + acento ámbar, dos niveles siempre visibles)

## Actualización 2026-07-27 — cabecera operativa y carriles con flechas

Se mantiene la decisión de dos niveles visibles, pero ambos se organizan ahora
como **dos carriles contiguos en una sola franja compacta**: `Áreas` y las
opciones de la categoría activa. Cada carril:

- conserva una sola línea y scroll táctil/horizontal;
- muestra flechas anterior/siguiente únicamente cuando hay contenido oculto;
- usa iconos de 23 px, nombres cortos completos y estados 3D sutiles
  (relieve, hover y pulsación);
- dispone de foco visible y respeta `prefers-reduced-motion`.

La cabecera elimina la duplicación de Minera/Unidad, que ya figura bajo el
título `Beemetry · Centro Minero`, y reduce el estado a `En línea`. Con ello se
elimina el scrollbar accidental de la fila superior y se gana altura útil sin
reducir el tamaño de los objetivos táctiles.

**Status**: accepted (implementado y verificado en navegador real 2026-07-13)
**Fecha**: 2026-07-13
**Autores**: EC
**Ámbito**: plataforma (componente-agnóstico, aplica sobre el shell de `App.tsx`)

> Decisión de UI/UX sobre el shell de la plataforma (ADR-031); no reencuadra
> arquitectura de datos ni de identidad — es la capa de presentación del "portal"
> descrito operativamente por ADR-035 (plataforma enterprise multi-unidad LATAM).

## Contexto

El menú principal de la plataforma (`App.tsx`, el shell que envuelve todos los
componentes/módulos) había divergido en dos lenguajes visuales distintos, creados en
sesiones de trabajo diferentes:

1. El **nav principal** (categorías + módulos) usaba un tema ámbar/naranja saturado
   tipo "industrial minero" (degradados `rgba(251,146,60,...)`→`rgba(234,88,12,...)`),
   con botones de barra de herramientas (`aurixa-toolbar-btn--indigo`,
   `--sky`, `--slate`) que, pese a sus nombres, **todos renderizaban el mismo
   degradado naranja** — una inconsistencia real entre el nombre de la clase CSS y su
   resultado visual.
2. Las vistas nuevas de administración (Usuarios, Permisos, Config. de Alarmas,
   construidas en una sesión posterior) ya usaban un lenguaje **índigo/slate oscuro**
   tipo "SaaS corporativo".

Además, el patrón de navegación funcionaba por "perforación": el usuario veía las
categorías, hacía clic, y la barra **cambiaba por completo** a los módulos de esa
categoría con un botón "Volver" para salir — un patrón menos estándar en aplicaciones
enterprise (Azure Portal, Salesforce, GitHub mantienen ambos niveles visibles
simultáneamente) y menos descubrible para usuarios nuevos.

Un pedido posterior de "menú retráctil para maximizar el área del lienzo" reveló que
el nav de dos niveles, si ambos se muestran siempre, puede volverse demasiado alto en
viewports pequeños si las filas envuelven a 2 líneas — un problema real detectado
visualmente en captura de pantalla real del usuario (header ocupando ~32% de un
viewport de 720px de alto).

## Decisión

Se unifica todo el nav bajo un único sistema de diseño **slate como base + ámbar como
acento de marca** (no índigo puro, para conservar la identidad de marca ya establecida
en logos/branding, y no naranja saturado, para leer como "SaaS enterprise" en vez de
"cinta de seguridad industrial"), con una arquitectura de navegación de **dos niveles
siempre visibles**, ambos de una sola línea con scroll horizontal.

### Paleta y componentes
- Fondo: gradientes slate-900/950 (`rgba(15,23,42,...)`, `rgba(30,41,59,...)`).
- Acento activo/hover: ámbar (`rgba(245,158,11,...)`) como *ring*/glow, no relleno
  sólido — más contenido visualmente que el naranja sólido anterior.
- Badges semánticos reales por significado (antes todos los badges — "Live", "Beta",
  "Pro", "NEW", "S2", "Hub" — compartían el mismo degradado ámbar-rosa sin relación
  con su significado): esmeralda=Live, cian=Beta, violeta=Pro, ámbar=NEW, cian
  claro=S2, slate=Hub.
- Botones de barra de herramientas con acento semántico real por acción: índigo para
  gestión/administración (Usuarios), cian para informativo (Auditoría), rojo para
  destructivo (Salir) — antes los tres renderizaban el mismo naranja pese a nombres de
  clase distintos (`--indigo`, `--sky`, `--danger`).

### Navegación de dos niveles siempre visibles
- **Nivel 1** (categorías: Administración, Monitoreo en Vivo, Geotecnia y Modelo 3D,
  Mapas de la Mina, Terrenos y Permisos, Cálculos e Informes — ver ADR-042 para el
  renombrado a lenguaje llano) y **Nivel 2** (módulos de la categoría activa) se
  renderizan **simultáneamente**, siempre. Cambiar de categoría actualiza el Nivel 2 al
  instante, sin clic de "Volver" — el botón/patrón "Volver" se elimina por completo.
- Ambas filas son de **una sola línea con scroll horizontal** (`overflow-x: auto;
  flex-wrap: nowrap`), nunca envuelven a una segunda línea — esto es lo que resuelve
  el hallazgo de header excesivamente alto: antes, con `flex-wrap: wrap`, un viewport
  angosto duplicaba la altura de cada fila.
- Un único control explícito de **contracción** (`.nav-collapse-toggle`, icono
  `ChevronUp`/`ChevronDown`) oculta ambas filas para maximizar el área vertical del
  lienzo — reemplaza el comportamiento anterior de auto-colapsar implícitamente al
  hacer clic en un módulo (una heurística menos predecible). Una barra flotante
  inferior (`nav-restore-bar`) ofrece la misma acción cuando el nav ya está contraído
  y por tanto no visible, mostrando el contexto de categoría activa.
- El botón de contracción vive **fuera** de la fila con scroll (fila flex separada,
  `shrink-0`) para que siempre sea alcanzable sin depender de la posición de scroll de
  las categorías.

### Reglas duras
- Toda opción de navegación (categoría, módulo, botón de contracción, botones de
  barra de herramientas) tiene tooltip enriquecido (`.tab-tooltip`, hover/focus-within)
  **además** del atributo `title` nativo — ninguna opción nueva se agrega sin ambos.
- Ninguna fila de navegación usa `flex-wrap: wrap` — siempre `nowrap` + scroll
  horizontal, para garantizar altura de header predecible independiente del ancho de
  viewport o cantidad de ítems.
- Los selectores CSS de componentes reutilizables (badges de prioridad, botones de
  filtro) deben calificarse con su contenedor padre cuando compiten con reglas
  genéricas de reset (`.dashboard-shell button { color: inherit }`) — un hallazgo real
  de esta sesión: `.alarm-prio-chip` (una sola clase, especificidad 0,1,0) perdía
  sistemáticamente contra ese reset genérico (especificidad 0,1,1) pese a fijar
  `--prio-color` correctamente vía variable CSS inline; la corrección fue calificar el
  selector como `.alarm-prio-summary .alarm-prio-chip` (especificidad 0,2,0). Se deja
  como regla dura porque es un patrón de bug que puede repetirse en cualquier
  componente nuevo que use una sola clase para texto/color de botón.

## Consecuencias

### Positivas
- Lenguaje visual único entre el shell de navegación y las vistas de administración
  ya construidas (antes divergentes).
- Header con altura predecible y acotada independiente del viewport — el hallazgo de
  "menú muy alto" (header ~32% de un viewport de 720px) queda resuelto por diseño
  (una sola línea por fila, siempre), no por un ajuste puntual de padding.
- Navegación más descubrible: ambos niveles visibles simultáneamente sin necesidad de
  un modelo mental de "entrar/salir" de una categoría.
- Badges y botones de herramienta ahora comunican significado real por color, no solo
  por texto — más accesible para escaneo visual rápido.

### Negativas / Trade-offs
- El scroll horizontal en la fila de categorías, si en el futuro se agregan muchas más
  categorías, puede volverse menos descubrible que un menú que envuelve — mitigado por
  el hecho de que hoy son 6 categorías y caben sin scroll en la mayoría de viewports
  de escritorio (1280px+); se revisita si la cantidad de categorías crece
  sustancialmente.
- No se auditaron **todos** los componentes de la plataforma en busca del mismo bug de
  especificidad CSS documentado arriba — solo se corrigió donde se detectó
  (`alarm-prio-chip`, `alarm-sound-btn`, `alarm-filter-btn`). Queda como ítem de
  auditoría futura si aparecen más casos de "color fijado por variable CSS que no se
  aplica".

### Neutras
- No cambia ningún contrato de API ni modelo de datos — es puramente una decisión de
  presentación sobre el shell existente.

## Alternativas descartadas

### Unificar todo a índigo puro (abandonar el ámbar de marca)
Habría sido más simple de implementar, pero pierde la identidad de marca ya
establecida en logos y branding existente (`enterprise-brand-logo`, borde ámbar). Se
prefiere conservar el ámbar como acento reduciendo su saturación/rol (de relleno
sólido a *ring*/glow), en vez de eliminarlo.

### Mantener el patrón de "perforación" (categoría → módulos → Volver)
Es el patrón preexistente; se descarta a favor de dos niveles siempre visibles porque
es el estándar más común en aplicaciones enterprise comparables y reduce la carga
cognitiva de "¿en qué nivel estoy?" para usuarios nuevos — alineado con el pedido
explícito de simplicidad de uso para personal de operación minera (ver ADR-042).

### Sidebar lateral colapsable en vez de nav horizontal de dos filas
Es el patrón usado en apps tipo Azure Portal/Salesforce, pero habría significado una
reestructuración de layout más profunda (todo el contenido central se desplaza
horizontalmente) frente al pedido concreto de "maximizar área **vertical**" — un nav
horizontal contraíble resuelve directamente ese pedido sin tocar el layout de
contenido.

## Referencias
- `frontend/src/App.tsx` (estructura de nav de dos niveles, `enterpriseGroups`, `tabs`)
- `frontend/src/index.css` (`.enterprise-main-nav`, `.top-nav-shell`, `.tab-button`,
  `.tab-pill--*`, `.aurixa-toolbar-btn--*`, `.nav-collapse-toggle`, `.nav-restore-bar`)
- `frontend/src/components/Dashboard/AlarmCenter.tsx` +
  `frontend/src/components/ReportStudioV2/ribbon.css` (fix de especificidad CSS de
  `.alarm-prio-chip`)
- ADR-031 (backend/shell de plataforma compartida), ADR-035 (plataforma enterprise
  LATAM), ADR-042 (renombrado de menús a lenguaje llano para usuarios mineros)
