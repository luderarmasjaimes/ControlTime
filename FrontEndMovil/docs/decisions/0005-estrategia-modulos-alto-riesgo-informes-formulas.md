# ADR-0005 — Estrategia para los módulos de más alto riesgo: Informes (editor Konva) y Fórmulas (canvas legado)

**Status**: accepted
**Fecha**: 2026-09-20
**Autores**: Claude Code (análisis técnico), revisado por Luder Armas
**Ámbito**: frontend-movil, informes, motor de fórmulas

## Contexto

El pedido de negocio fue replicar **todo** el menú del frontend web, al
mismo nivel de profundidad. Un análisis exhaustivo del código real de dos
módulos concretos muestra que "mismo nivel de profundidad" mediante una
reimplementación nativa 1:1 no es técnicamente realista en el mismo esfuerzo
que el resto de la app, y que, en el caso concreto de estos dos módulos, ni
siquiera sería la mejor experiencia de usuario en una pantalla táctil:

### ReportStudioV2 ("Informes")
- **~60.000 líneas** de código en ~90 archivos. El motor de canvas
  (`components/document/PageCanvas.tsx`, 3.174 líneas) es un híbrido
  Konva + HTML: bloques con posición absoluta, arrastrables,
  redimensionables, rotables, con guías de alineación, grupos vinculados,
  deshacer/rehacer (`store/useEditorStore.ts`, 5.175 líneas).
- Soporta 12+ tipos de bloque (texto con IA, tablas tipo hoja de cálculo con
  fórmulas y formato condicional, gráficos, imágenes, video, formas,
  tarjetas KPI, sensores individuales y multi-canal con mini-mapa Leaflet y
  mini-panel 3D embebidos, reporte sísmico, tabla de contenidos, portada,
  encabezado/pie).
- **Ya existe una vista de solo-lectura separada**
  (`components/viewers/ReadOnlyViewer.tsx`, 1.232 líneas), usada hoy en
  producción para ver/imprimir/exportar/compartir/modo presentador — con su
  propia virtualización de páginas para documentos grandes. Es
  significativamente más portable que el editor completo porque solo
  necesita renderizar un layout estático a partir del mismo JSON de bloques,
  sin la máquina de arrastre/transformación/deshacer.
- No existe ningún paquete de Flutter equivalente a un canvas Konva con
  overlay HTML — replicarlo nativamente sería, en la práctica, escribir un
  motor de canvas propio con `CustomPainter` + gestos desde cero, un
  proyecto en sí mismo del tamaño de varias semanas/meses de un ingeniero
  especializado, sin ninguna garantía de que edición "mouse-first" de
  bloques absolutamente posicionados tenga sentido de UX en una pantalla de
  teléfono de 6 pulgadas con los dedos.

### "Fórmulas" / pestaña Cálculo
- La UI real es un **`<iframe>`** (`components/Formula/FormulaEngineEmbed.tsx`,
  47 líneas) hacia una app legada **no-React** (HTML/JS/three.js/OpenCV,
  `frontend/public/formula/*`, ~5.000 líneas) servida por un microservicio
  C++ aparte (`formula_engine/`), con colaboración en tiempo real vía
  WebSocket propio (`/formula-api/ws`).
- No hay código React del cual "portar" nada — reconstruir esto de forma
  nativa significaría reingeniería inversa completa de un editor de
  diagramas de bloques/conexiones desde cero, sin ninguna especificación
  más allá del comportamiento observado.
- El backend computacional real (motor `tinyexpr`, ADR-187/188/189 del
  repo principal) ya está expuesto por REST normal
  (`GET /api/mining/formulas`, `GET /api/mining/devices/{id}/formulas`) —
  eso sí es 100% portable y no depende del canvas legado.

## Decisión

Para estos dos módulos únicamente, se entrega paridad funcional completa
mediante una combinación de **render nativo** (para lo que es
razonablemente portable) y **puente WebView autenticado** (para lo que no
lo es), en vez de una reimplementación nativa 1:1:

### Informes
1. **Lista de informes** (`GET /api/reports`) y **visor nativo** de un
   informe: un renderizador Flutter propio que interpreta el mismo JSON de
   bloques que ya consume `ReadOnlyViewer.tsx` (texto, tabla, gráfico,
   imagen, KPI, sensor, mapa, sección de portada/encabezado/pie) en un
   layout estático de página, con zoom/pan táctil, exportar/compartir
   (reutilizando `GET /api/reports/{id}/export/pdf`,
   `POST /api/reports/{id}/share-link`), y un modo presentador a pantalla
   completa — cubre ver, imprimir, compartir y presentar un informe
   íntegramente de forma nativa.
2. **Edición completa**: un `WebViewWidget` (`webview_flutter`) que carga
   la URL real del editor ReportStudioV2 del frontend web, inyectando el
   access token Bearer ya vigente en la sesión móvil (vía un parámetro de
   arranque o un mensaje `postMessage` al cargar, nunca hardcodeado) — el
   usuario edita con el editor real, sin duplicar sus 60.000 líneas, y sin
   perder ninguna funcionalidad de edición.

### Fórmulas
1. **Resumen de Fórmulas** (`FormulaOverview`): lista nativa de
   `GET /api/mining/formulas` — 100% portable, sin canvas.
2. **Canvas de diagramas de bloques**: mismo patrón de puente `WebView`
   hacia la URL del editor legado (`/formula/index.html` vía el proxy de
   nginx), autenticado con la misma sesión.

Ambos puentes se documentan como tales en la UI (un indicador claro de "modo
edición avanzada", no un intento de disfrazar el WebView de nativo) y
comparten un mismo widget base (`core/widgets/authenticated_webview.dart`)
para la inyección de sesión.

## Consecuencias

### Positivas
- El usuario tiene el 100% de la funcionalidad de ambos módulos desde el
  día uno — nada queda "pendiente para una fase futura".
- El trabajo de ver/imprimir/compartir/presentar informes (el uso más
  probable en un teléfono) es nativo de verdad, con buen rendimiento y sin
  depender de un WebView para el caso de uso más común.
- Cero riesgo de divergencia funcional entre "lo que el editor web puede
  hacer" y "lo que el puente móvil permite" — es literalmente el mismo
  editor.

### Negativas / Trade-offs
- La experiencia de edición de informes y de fórmulas en el celular es la
  de una app web de escritorio dentro de un WebView — no está optimizada
  para dedos/pantalla pequeña. Aceptado explícitamente como el costo de no
  reescribir un canvas de 60.000 líneas o un editor de diagramas legado
  desde cero.
- El puente WebView requiere que el dispositivo tenga conectividad de red
  equivalente a usar la app web (no funciona offline) — a diferencia del
  resto de la app, que puede cachear localmente lecturas recientes.
- Mantener la inyección de sesión Bearer→WebView sincronizada con la
  rotación/expiración del token del cliente nativo agrega una pieza de
  integración propia que no existe en ningún otro módulo.

## Ruta de nativización futura

Si el uso real en producción muestra que la edición de informes desde el
celular es frecuente y el WebView resulta insuficiente (rendimiento, UX),
la ruta natural es nativizar primero un subconjunto de tipos de bloque más
simples (texto, imagen, KPI) mientras los bloques complejos (tabla tipo
hoja de cálculo, multi-gráfico con mini-mapa) siguen en el puente — nunca
"todo o nada". Esto es una decisión de negocio futura, no parte del alcance
de esta primera entrega.

## Referencias
- `frontend/src/components/ReportStudioV2/` (repo principal — referencia de
  comportamiento, ~60.000 líneas, no código a portar)
- `frontend/src/components/ReportStudioV2/components/viewers/ReadOnlyViewer.tsx`
  (repo principal — base conceptual del visor nativo)
- `frontend/src/components/Formula/FormulaEngineEmbed.tsx`,
  `frontend/public/formula/` (repo principal)
- `docs/decisions/187-administracion-sensores-motor-formulas-tiempo-real.md`,
  `188-reconstruccion-tab-calculo-motor-real.md`,
  `189-catalogo-plantillas-formula-calibracion-geotecnica.md` (repo
  principal)
- [ADR-0002](0002-eleccion-stack-flutter.md) (elección de Flutter)
- `lib/features/reports/`, `lib/features/formula/` (este proyecto)
