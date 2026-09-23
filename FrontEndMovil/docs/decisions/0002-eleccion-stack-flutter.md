# ADR-0002 — Elección de stack: Flutter (no React Native ni Capacitor)

**Status**: accepted
**Fecha**: 2026-09-20
**Autores**: Luder Armas (decisión de producto), con Claude Code
**Ámbito**: frontend-movil

## Contexto

Para construir FrontEndMovil (ver [ADR-0001](0001-alcance-independencia-proyecto.md))
se evaluaron tres caminos técnicos antes de escribir código:

1. **React Native + Expo** — reutiliza TypeScript y parte del conocimiento
   del equipo que ya mantiene `frontend/` (React 18 + Zustand); app nativa
   real, no un WebView.
2. **Flutter** — rendimiento nativo, un solo codebase Dart, sin dependencia
   del ecosistema React; requiere que el equipo adopte Dart/Widgets, sin
   reutilizar código del frontend web existente.
3. **Capacitor** (envolver el frontend web React actual como WebView Android)
   — máxima reutilización de código (~90%), arranque más rápido, pero la
   experiencia final es un WebView, no una app nativa — no cumple el
   objetivo explícito de "interfaz reactiva" de alto rendimiento pedido.

Se presentó esta decisión al negocio junto con la de alcance
(ver [ADR-0001](0001-alcance-independencia-proyecto.md)) y el negocio eligió
**Flutter**, priorizando rendimiento y una experiencia verdaderamente nativa
por sobre la reutilización de código con el frontend web existente.

## Decisión

Se construye FrontEndMovil en **Flutter** (canal `stable`), Dart 3.x, con:

- **Estado**: `flutter_riverpod` — se prefirió sobre Bloc por menos
  boilerplate dado el volumen de features (~25 módulos) y sobre Provider
  clásico por mejor soporte de testing/DI; se usa sin generación de código
  (`riverpod_generator`) para no añadir fricción de `build_runner` en la
  primera entrega.
- **Navegación**: `go_router` con `ShellRoute` (ver
  [ADR-0004](0004-arquitectura-navegacion-movil.md)).
- **Red**: `dio` + `dio_cookie_manager` + `cookie_jar` (ver
  [ADR-0003](0003-autenticacion-sesion-biometria.md) para el porqué se
  necesita un cookie jar pese a que la autenticación normal es 100% Bearer).
- **Mapas**: `flutter_map` (Leaflet-equivalente, evita atar el proyecto a
  Google Maps/API key, igual que el frontend web usa Leaflet crudo, no
  Google Maps).
- **Gráficos**: `fl_chart` (MIT, sin costo de licencia) + `CustomPainter`
  propios para gauge radial/donut — igual costo de desarrollo que en React,
  donde esos widgets tampoco vienen de una librería de gráficos.
- **DTOs escritos a mano** (`fromJson`/`toJson`) en vez de `freezed`/
  `json_serializable`, priorizando velocidad de entrega en la primera
  versión; es un cambio de bajo costo migrar más adelante si se decide
  adoptar generación de código.

El detalle completo de paquetes está en `pubspec.yaml` y se documenta,
paquete por paquete, en el README del proyecto.

## Consecuencias

### Positivas
- Rendimiento de UI nativo (60/120fps), sin la sobrecarga de un WebView ni
  el motor de renderizado del navegador.
- Un solo lenguaje/framework para toda la lógica de la app (a diferencia de
  Capacitor, que seguiría dependiendo del bundle web existente).
- `flutter_map`, `fl_chart` y el resto del stack elegido son 100%
  open-source (licencias MIT/BSD), sin dependencias de licencias comerciales
  ni claves de API de pago obligatorias (a diferencia de, por ejemplo,
  Google Maps SDK o Syncfusion con licencia comercial).

### Negativas / Trade-offs
- **Cero reutilización de código** con `frontend/` (React/TypeScript) — todo
  el conocimiento de UI, validaciones de formularios y lógica de
  presentación se reescribe en Dart. Este trade-off se aceptó
  explícitamente al elegir Flutter sobre React Native.
- El equipo necesita adoptar Dart/Flutter como stack nuevo — mayor curva de
  arranque que Capacitor, similar a la de React Native.
- Dos de los ~25 módulos (editor de informes ReportStudioV2, canvas legado
  de Fórmulas) no tienen una vía de portar código existente en absoluto —
  ni siquiera con React Native se habría podido reutilizar ese código
  directamente, dado que son un canvas Konva de ~60.000 líneas y una app
  legada no-React respectivamente (ver
  [ADR-0005](0005-estrategia-modulos-alto-riesgo-informes-formulas.md)).

## Alternativas descartadas

### React Native + Expo
Habría permitido compartir tipos/DTOs y parte del conocimiento de dominio
con `frontend/`, y el equipo que mantiene el frontend web ya conoce
React/TypeScript. Descartada porque el negocio priorizó explícitamente
Flutter por rendimiento nativo, y porque ninguno de los módulos más
complejos (canvas de informes, canvas de fórmulas) es realmente portable
como código entre React web y React Native de todas formas — ambas rutas
requerían reconstruir esas dos pantallas desde cero.

### Capacitor (WebView del frontend React actual)
La opción de menor esfuerzo de desarrollo, pero la experiencia final sigue
siendo un WebView sobre el mismo bundle Vite/React ya optimizado para
mouse/teclado de escritorio, no para una pantalla táctil de teléfono — no
cumple el pedido explícito de una "interfaz reactiva" de app nativa.
Descartada por decisión de negocio.

## Referencias
- [ADR-0001](0001-alcance-independencia-proyecto.md) (alcance e independencia)
- [ADR-0003](0003-autenticacion-sesion-biometria.md) (autenticación/sesión)
- [ADR-0005](0005-estrategia-modulos-alto-riesgo-informes-formulas.md)
  (módulos de alto riesgo)
- `pubspec.yaml`
