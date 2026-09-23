# ADR-0004 — Arquitectura de navegación móvil: de dos carriles de escritorio a Drawer + pestañas

**Status**: accepted
**Fecha**: 2026-09-20
**Autores**: Claude Code (análisis técnico), revisado por Luder Armas
**Ámbito**: frontend-movil, navegación

## Contexto

El frontend web actual define su lenguaje de navegación en dos ADRs del
repo principal:

- [ADR-040](../../../docs/decisions/040-sistema-diseno-navegacion-enterprise.md)
  — dos carriles siempre visibles (categorías + módulos de la categoría
  activa), sin patrón "entrar y volver", con scroll horizontal de una sola
  línea, relieve 3D sutil en los botones.
- [ADR-042](../../../docs/decisions/042-nomenclatura-menus-lenguaje-llano-minero.md)
  — 6 categorías en lenguaje llano: **Gestión, Control, Terreno, Mapas,
  Permisos, Informes** — nombran lo que el usuario logra, no la tecnología
  subyacente.

Ambos patrones asumen mouse/hover y una pantalla ancha. Una pantalla de
teléfono (viewport típico 360-430px de ancho) no tiene espacio para dos
carriles horizontales simultáneos sin sacrificar la mayoría del alto de
pantalla — el propio ADR-040 documenta un bug real donde el header llegó a
comerse el 32% de un viewport de 720px de alto por un problema de wrap a dos
líneas; en un teléfono, el problema sería peor, no igual.

## Decisión

Se preserva la **jerarquía de información** (categoría → módulo) y el
**lenguaje llano** de ADR-042, pero se cambia el **mecanismo de interacción**
a patrones táctiles estándar de Android:

- **Nivel 1 (categorías)**: un `Drawer` (menú lateral) con las 6 categorías
  de ADR-042, ícono + nombre, accesible desde el ícono de hamburguesa en el
  `AppBar`. Se prefiere `Drawer` sobre una barra de navegación inferior
  porque 6 destinos exceden la recomendación de Material Design de 3-5 ítems
  para bottom navigation, y porque cada categoría despliega un segundo nivel
  propio (ver abajo) que necesita su propio espacio en pantalla.
- **Nivel 2 (módulos dentro de la categoría activa)**: un `TabBar`
  horizontal con scroll (`isScrollable: true`) inmediatamente debajo del
  `AppBar`, listando los módulos de esa categoría — mismo principio de
  "todo visible con scroll horizontal, nunca un menú desplegable oculto"
  que ADR-040, adaptado de hover-carril a swipe/tap de pestañas.
- Mapeo de los ~25 módulos a las 6 categorías (agrupación funcional):

  | Categoría | Módulos |
  |---|---|
  | Control | Dashboard, KPIs Operación, Alarmas, Sensores Técnicos, Telemetría, SimulationMonitor, Surveillance |
  | Terreno | Inclinómetro, Visor 3D (trayectorias de sondaje), Desplazamiento Acumulado |
  | Mapas | Mapa General, Geoportal Minero, Cumplimiento Geoespacial, Mapa Detallado |
  | Informes | Informes (visor nativo + puente de edición), Resumen de Fórmulas, Fórmulas (puente canvas) |
  | Gestión | Usuarios, Empresas, Configuración de Alarmas, Dispositivos, WhatsApp, Soporte, Candidatos RRHH |
  | Permisos | Matriz de Roles y Permisos |

- Cada módulo se implementa como una ruta hija de un `ShellRoute` de
  `go_router`, de forma que el `Drawer` y el `TabBar` de la categoría activa
  persisten mientras se navega entre módulos (mismo principio de "shell de
  navegación autenticado" que
  [ADR-175](../../../docs/decisions/175-navbar-extraccion-shell-autenticado.md)
  del repo principal aplica en el frontend web, con `NavBar.tsx` separado
  del contenido de cada vista).
- La vista legada "Report" (`RichTextEditor`/tiptap del frontend web) se
  confirmó como una demo no funcional, ya superada por ReportStudioV2 — se
  omite del mapeo; agregar un destino nuevo si algún día hace falta es un
  cambio trivial de una entrada en el `Drawer`.

## Consecuencias

### Positivas
- El usuario que ya conoce el frontend web reconoce las mismas 6 categorías
  y los mismos nombres de módulo — la curva de aprendizaje es sobre el
  gesto (swipe/tap vs. hover/click), no sobre el vocabulario.
- El patrón Drawer + TabBar es 100% idiomático de Android/Material Design —
  no se fuerza una metáfora de escritorio en una pantalla táctil.

### Negativas / Trade-offs
- La navegación a un módulo específico toma un toque más que en escritorio
  (abrir el Drawer → elegir categoría → elegir pestaña) — mitigado
  parcialmente dejando la última categoría/pestaña visitada como default al
  reabrir la app (persistida en `shared_preferences`).
- El agrupamiento de categorías no es una copia 1:1 del código
  `activeTab` del frontend web (que no tiene una noción explícita de
  categoría en el modelo de datos, solo en el layout de `NavBar.tsx`) — es
  una interpretación funcional; si el negocio prefiere un agrupamiento
  distinto, es un cambio de configuración (`app_router.dart`), no de
  arquitectura.

## Referencias
- `docs/decisions/040-sistema-diseno-navegacion-enterprise.md`,
  `042-nomenclatura-menus-lenguaje-llano-minero.md`,
  `175-navbar-extraccion-shell-autenticado.md` (repo principal)
- `lib/core/router/app_router.dart`, `lib/core/widgets/` (este proyecto)
