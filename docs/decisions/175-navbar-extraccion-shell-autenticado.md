# ADR-175 — Extracción de `NavBar.tsx`: shell de navegación autenticado fuera de `App.tsx`

**Status**: implemented, verificado conforme (formalizado retroactivamente 2026-09-12 — el código ya existía sin ADR)
**Fecha**: 2026-09-12
**Autores**: Luder Armas (formalización retroactiva, con Claude Code)
**Ámbito**: plataforma
**Relación**: refactor de código, no cambia el contrato de ADR-040/042/095/132.

## Contexto

`App.tsx` concentraba ~1600 líneas de cabecera/navegación/menús del shell
autenticado (carriles de Áreas/Opciones, chip de usuario/avatar, logout,
edición de escalas/ángulos) inline dentro del propio componente `App`,
junto con la carga diferida de vistas, el manejo de sesión, y el
enrutamiento entre vistas públicas/autenticadas. Llegó al repositorio ya
extraído a un componente propio (`components/UI/NavBar.tsx`, ~1300 líneas),
reduciendo `App.tsx` a 338 líneas, sin ADR que registrara el cambio. Dado
que es una reestructuración de superficie considerable de un componente
gobernado por varias decisiones previas (diseño de navegación, nomenclatura,
manejo de sesión), la auditoría de conformidad (2026-09-11) lo señaló como
algo que merece su propio registro — no porque cambie ninguna de esas
decisiones, sino para que quede escrito *que* se movió, *a dónde*, y que se
verificó que sigue cumpliendo lo ya decidido.

## Decisión

Se extrae la cabecera/navegación del shell autenticado de `App.tsx` a
`components/UI/NavBar.tsx`, recibiendo por props la sesión, la pestaña
activa y el contenido a renderizar (`content`) — `App.tsx` decide QUÉ vista
pesada montar según `activeTab`; `NavBar` decide únicamente el CHROME
(menús, cabecera, panel de edición de escalas). Es una separación de
responsabilidades (contenedor de rutas vs. shell visual), sin introducir
ningún concepto nuevo de navegación.

**Verificado explícitamente que NO regresa nada de lo ya decidido**:

- [ADR-040](040-sistema-diseno-navegacion-enterprise.md) (diseño: dos
  carriles contiguos, flechas automáticas, iconos grandes, scroll, relieve
  3D sutil): confirmado línea por línea en el componente extraído —
  `HorizontalNavRail` sigue implementando flechas `ChevronLeft/Right`
  visibles solo con overflow de scroll, anillo de icono, tooltip + `title`
  por ítem, botón de colapsar/restaurar carril. Diseño intacto.
- [ADR-042](042-nomenclatura-menus-lenguaje-llano-minero.md) (nomenclatura
  llana: Gestión, Control, Terreno, Mapas, Informes, Usuarios, Accesos,
  Umbrales): las claves de `I18nProvider.tsx` (`nav.manage`, `nav.control`,
  `nav.ground`, `nav.maps`, `nav.reports`, `nav.users`, `nav.access`,
  `nav.thresholds`) siguen presentes y en uso, sin regresión.
- [ADR-132](132-bearer-en-memoria-cookies-namespaced-aislamiento-multifrontend.md)
  (bearer en memoria, nunca `localStorage`): grep de `localStorage` sobre
  `NavBar.tsx` da **cero resultados** — el componente que ahora muestra la
  sesión/avatar/logout no reintrodujo el patrón que ese ADR retiró.
- [ADR-095](095-usermaintenancemodal-css-autocontenida-marca.md) (fix de
  code-splitting de un modal montado fuera del chunk lazy de
  ReportStudioV2): `UserMaintenanceModal` se sigue montando por import
  estático (no lazy) desde el shell — ahora desde `NavBar.tsx` en vez de
  `App.tsx` — y conserva su propia hoja de estilos autocontenida
  (`UserMaintenanceModal.css`); el fix de ese ADR sigue siendo válido
  independientemente de qué componente lo monta.

## Consecuencias

### Positivas
- `App.tsx` pasa de ~1600 a 338 líneas — mucho más legible como "qué vista
  monto según la pestaña activa", sin la cabecera/navegación mezclada en
  el mismo archivo.
- Separación clara de responsabilidades facilita cambios futuros al chrome
  de navegación sin tocar el enrutamiento de vistas, y viceversa.

### Negativas / Trade-offs
- Ninguna identificada — es un refactor de extracción sin cambio de
  comportamiento observado ni regresión sobre los ADR que gobiernan esta
  superficie.

## Alternativas descartadas

No aplica — es un refactor de organización de código, no una decisión de
arquitectura con alternativas de diseño distintas a evaluar.

## Referencias
- `frontend/src/App.tsx` (338 líneas tras la extracción)
- `frontend/src/components/UI/NavBar.tsx` (~1300 líneas, el shell extraído)
- ADR-040 (diseño de navegación), ADR-042 (nomenclatura), ADR-095 (modal autocontenido), ADR-132 (bearer en memoria)
