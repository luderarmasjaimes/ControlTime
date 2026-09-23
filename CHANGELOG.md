# Changelog — Beemetry / AURIXA Plataforma Minera

Insumo para la decisión de release v0.1. No implica que el equipo ya haya
decidido cortar la versión — ver `RUNBOOK.md` para lo que falta antes de
GO-LIVE.

## [Unreleased] — 2026-09-23

### Auditoría integral, cierre de ADR y plan maestro (ADR-210, 211, 212)

Pedido explícito: análisis completo de la plataforma, plan actualizado mes a mes,
pendientes/riesgos/decisiones de Gerencia y verificación de conflictos ADR↔código.
Sin cambios de código de producto. Log ADR verificado sin huecos (000-212). Cerrados
por evidencia los estados de ADR-085/086/088/109/110/116/150. Hallazgos operativos
documentados: migraciones 115/116 sin aplicar en la BD viva, runner de migraciones
bloqueado por dos scripts con prefijo 81, 400 cambios sin commit. Avance: 72,5% oficial,
73,3% auditado, ≈47 tareas de salida a producción. Registro único de decisiones G-1…G-17
en ADR-212 ([ADR-210](docs/decisions/210-auditoria-integral-2026-09-23-cierre-adr-y-conflictos.md),
[ADR-211](docs/decisions/211-saneamiento-ledger-migraciones-version-81-duplicada-y-seeds-dev.md),
[ADR-212](docs/decisions/212-plan-maestro-2026-09-23-pendientes-riesgos-decisiones-gerencia.md)).

## [Unreleased] — 2026-09-20

### Avatar: recorte de solo cabeza + catálogo de cuerpo/vestimenta pre-hecho, avatar flotante 50% más chico

Pedido explícito del usuario: dejar de depender de segmentar hombros/ropa
fotografiados (fuente documentada de varios incidentes reales previos,
ADR-157/158) y en su lugar recortar solo la cabeza, componerla sobre una
plantilla de cuerpo/vestimenta pre-hecha seleccionable, y reducir el avatar
flotante interactivo a la mitad de su tamaño.

- **Recorte de solo cabeza con mejor calidad de borde**: nuevo segmentador
  multiclase de MediaPipe (pelo/piel-cara/piel-cuerpo/ropa/otros, TFLite/CPU,
  sin costo de GPU) reemplaza el casco convexo dilatado a lo bruto que se
  usaba antes -- corte de cuello siempre por una línea fija (mentón +
  margen), nunca por una inferencia de "dónde empieza el hombro".
- **Catálogo de 4 plantillas de cuerpo/vestimenta** dibujadas por código
  (`polo_azul`, `chaleco_seguridad`, `camisa_gris`, `chaqueta_campo`) -- sin
  difusión (SD1.5 no puede pintar de forma confiable un cuerpo sin cara) ni
  arte de terceros (cero licencia nueva que auditar).
- **"Cambiar de vestimenta" instantáneo**: nuevo selector en el diálogo de
  avatar HD de la cabecera -- recompone contra otra plantilla sin GPU ni
  difusión (recorte de cabeza ya persistido en el registro), a diferencia de
  los 15-40s de una generación completa.
- **Avatar flotante 50% más chico** (`AvatarWidget.tsx`, pedido explícito).

Verificado con build real: backend (`Dockerfile.verify`, ctest 100%),
frontend (`tsc`+`vite build` sin errores) y `ai_engine` reconstruido y
probado en vivo dentro del contenedor real (`/avatar_body_templates` y
`/recompose_avatar_body` con un recorte sintético, sin datos biométricos
reales) -- encontró y corrigió un bug real de alineación (hueco entre
mentón y cuello) antes de darlo por bueno. Pendiente: verificación visual
con una foto de registro real (sin cámara disponible en esta sesión)
([ADR-203](docs/decisions/203-avatar-recorte-cabeza-catalogo-cuerpo-vestimenta.md)).

### ReportStudioV2: fidelidad ampliada de la importación de PDF (estilos, encabezados/TOC, listas, márgenes)

Pedido explícito del usuario tras probar la v1: "la máxima fidelidad
posible" en ubicación de texto/imágenes, índices, listas, márgenes,
colores y estilos. El importador (ADR-199) ahora extrae del PDF spans de
estilo real (negrita/cursiva/color/tamaño/fuente por carácter), detecta
encabezados (vía el esquema real del PDF o por tamaño de fuente relativo)
que alimentan automáticamente la Tabla de Contenidos del editor, alinea
párrafos, reconoce listas con su profundidad, intercala imágenes en su
posición real de lectura (antes quedaban todas al final de cada página), y
configura el tamaño/orientación/márgenes del documento importado según el
PDF de origen. Todo esto reutiliza mecanismos que el editor YA tenía
(`TextStyleSpan`, Tabla de Contenidos, `setPaperSize`/`setOrientation`/
`setPageMargins`) -- no hubo que tocar código del editor. Verificado en
vivo (imagen Docker real reconstruida, PDF de prueba con encabezado/
subtítulo numerado/lista/negrita/alineación real) encontró y corrigió 3
bugs reales: encabezados numerados ("1. Introducción") que se confundían
con ítems de lista y quedaban sin detectar, alineación falsa "centrado" en
párrafos normales (se comparaba contra el borde físico de la hoja en vez
del área de contenido real), y profundidad de lista siempre en 0 (se
medía contra el propio bloque del ítem en vez de un margen de página real)
([ADR-199 §7](docs/decisions/199-importacion-pdf-ocr-avanzado.md)).

### ReportStudioV2: export nativo completo (XLSX, PPTX reconstruido, índice/marcadores reales en PDF, contraseña opcional)

Lleva PPTX y XLSX al mismo estándar nativo que ya tenía DOCX (texto/tablas
armados directamente desde el JSON del informe, no una captura de pantalla)
y cierra brechas de navegación/permiso en PDF:

- **PPTX reconstruido desde cero**: cada diapositiva se arma con texto,
  tablas y tarjetas KPI/sensor NATIVOS y editables en PowerPoint; solo
  gráficos/portada/imágenes siguen como PNG capturado (mismos 4 tipos que
  ya usa DOCX). Se retira el mecanismo viejo de overlay sobre una captura de
  página completa. Efecto colateral real encontrado y corregido: la
  conversión PPTX→MP4 con narración asumía una imagen de fondo por
  diapositiva — ahora genera sus propios frames por separado.
- **XLSX (nuevo formato)**: exporta las tablas ya insertadas en el informe
  a un libro de Excel real — una hoja por tabla (celdas numéricas reales,
  texto enriquecido, bordes/colores) más una hoja "Índice" con
  hipervínculos internos reales a cada una.
- **PDF con índice real**: panel de marcadores de navegación (Acrobat/
  Chrome) por cada encabezado del informe, y el bloque de tabla de
  contenidos visible dentro del documento ahora es clickeable (enlaces
  internos reales), la misma paridad que ya tenía el campo TOC de Word.
- **PDF sin contraseña (perfiles avanzados)**: nueva opción de exportación,
  disponible solo para roles con el permiso dedicado
  `informes.export_sin_clave` (sembrado a administrador/gerente por
  defecto) — el resto de los roles sigue recibiendo siempre el PDF cifrado
  de siempre.

Verificado con build real del backend en Docker (CTest 100%), typecheck
completo del frontend (0 errores) y pruebas unitarias directas de cada
pieza nueva del sidecar contra documentos de prueba — sin verificación E2E
en vivo contra Chromium real todavía
([ADR-201](docs/decisions/201-xlsx-tablas-pptx-nativo-pdf-indice-real.md)).

## [Unreleased] — 2026-09-19

### ReportStudioV2: importación de PDF con OCR avanzado

Nuevo botón "Importar PDF (OCR)" junto a "Importar Word (.docx)" (ribbon
Datos → Importación): sidecar nuevo `ocr_engine/` (PaddleOCR
PP-StructureV2, CPU-only, separado de `ai_engine` por el mismo motivo de
conflicto de dependencias ML que ya llevó a aislar `avatar_engine`/
`silentface_engine`), extracción híbrida por página (texto digital real vía
PyMuPDF cuando existe, OCR completo con layout/tabla/figuras solo en
páginas escaneadas). Resuelve desde el día 1 dos hallazgos que
[ADR-173](docs/decisions/173-importacion-word-docx-mammoth.md) había dejado
pendientes para `.docx`: validación de firma de archivo en las 3 capas y
resumen post-importación (páginas digitales vs. OCR, confianza promedio).
Verificado end-to-end en vivo (build real del backend, imagen Docker real
del sidecar, requests reales): encontró y corrigió un bug real de la
librería `paddleocr` (`PPStructure(lang='es')` tronaba el proceso con
`sys.exit` -- su modelo de layout solo soporta en/ch), resuelto separando
layout/tabla del reconocimiento de texto real en español. Limitación de
precisión documentada, no un bug: el modelo multilingüe a veces omite
diacríticos del español (ej. "año"→"ano")
([ADR-199](docs/decisions/199-importacion-pdf-ocr-avanzado.md)).

## [Unreleased] — 2026-09-14

Catch-up documental: esta sección cubre el trabajo real entre el 2026-09-11
(última entrada de este archivo antes de esta) y hoy —
[ADR-168 a ADR-188](docs/decisions/README.md), 21 decisiones en 3 días. Se
agrega como sección nueva, sin reordenar ni reescribir las entradas
previas — mismo criterio que ya usaba la sección de abajo.

### Decisiones de negocio y seguridad formalizadas

Aprobación de alcance (no aún operativa) de soporte por WhatsApp/SMS,
pendiente de cuentas comerciales de Meta y Twilio
([ADR-168](docs/decisions/168-spec025-soporte-whatsapp-aprobacion-contractual-sms-comercial.md)),
pentest externo declarado requisito obligatorio antes de producción, sin
proveedor contratado todavía
([ADR-169](docs/decisions/169-pentest-externo-seguridad-requisito-obligatorio-produccion.md)),
y evaluación de capacidad VPS/GPU pendiente de decisión de compra tras
medir en vivo que un export de 2.104 páginas/6.300 diagramas proyecta ~145
min y que el headroom de GPU actual es de solo 403 MiB
([ADR-170](docs/decisions/170-evaluacion-vps-gpu-pendiente-exportacion-documentos-extensos.md)).
Decomiso completo (no solo mitigación) del vector de autoasignación de rol
en el registro público que motivó el hallazgo crítico de ADR-134
([ADR-177](docs/decisions/177-decomiso-autoasignacion-rol-autoregistro-publico.md)).
Descarte del SDK biométrico comercial Dermalog por licencia con costo
adicional — decisión de negocio sin impacto en producción, el sistema real
ya no depende de ese SDK
([ADR-180](docs/decisions/180-descarte-dermalog-licencia-comercial-costo-adicional.md)).

### Alcance del proyecto y deuda técnica

"Operaciones de Campo" (offline/ERP) declarado explícitamente fuera de
alcance del proyecto actual, retirado del seguimiento de avance — queda
solo como referencia técnica para una eventual iniciativa derivada
([ADR-178](docs/decisions/178-operaciones-campo-fuera-de-alcance-implementacion-futura-independiente.md)).
Catálogo de pendientes de bajo riesgo (código muerto, configuración sin
usar, hooks construidos y no conectados) para limpieza futura, sin decisión
de arquitectura nueva
([ADR-176](docs/decisions/176-catalogo-pendientes-borrado-mejora-correccion.md)).
Landing pública pre-login formalizada como superficie de marketing con
datos deliberadamente ilustrativos hasta que existan clientes reales
([ADR-171](docs/decisions/171-pagina-publica-marketing-datos-ilustrativos.md)).

### ReportStudioV2: tablas, importación Word, capacidades de editor

Motor de hoja de cálculo embebido en el bloque de tabla (7 fórmulas,
formato condicional, combinar celdas,
[ADR-172](docs/decisions/172-motor-tablas-excel-formulas-formato-condicional.md)),
importación de documentos `.docx` vía `mammoth`
([ADR-173](docs/decisions/173-importacion-word-docx-mammoth.md)), y un
lote de capacidades avanzadas del store del editor: undo/redo con
agrupación temporal, autoFlow, `linkedGroup`, configuración de página, y
navegación de diapositivas con vista previa de arrastre
([ADR-174](docs/decisions/174-capacidades-avanzadas-editor-store-navegacion-diapositivas.md)).
Extracción de `NavBar.tsx` fuera de `App.tsx` (de ~1954 a 354 líneas), sin
regresión de comportamiento
([ADR-175](docs/decisions/175-navbar-extraccion-shell-autenticado.md)).

### KPIs en tiempo real: bug de query y escalamiento real

Bug real de query SQL en el endpoint SSE de KPIs corregido, con nuevo hook
`useLiveKpi.ts` (EventSource nativo, auth por cookie,
[ADR-179](docs/decisions/179-push-sse-kpis-bug-real-query-y-cliente-frontend.md)).
Escalamiento a más de 200 conexiones SSE simultáneas resuelto con un pool
de conexiones Postgres en vez de migrar todo el servidor a Boost.Asio
asíncrono — verificado con prueba de carga real de 200 conexiones (PASS) y
prueba real de caída de réplica
([ADR-181](docs/decisions/181-sse-kpis-pool-conexiones-en-vez-de-asio-strands.md)).

### Exportación de informes: bugs de gráficos, benchmark real y decisión de negocio

Corrección de bugs reales en la exportación de los 20 tipos de gráfico
soportados (etiquetas de histograma, truncamiento en pie/donut/funnel,
[ADR-182](docs/decisions/182-verificacion-export-20-tipos-grafico-bugs-histograma-funnel.md)).
Benchmark real del criterio O3 del SOW (export <5s): tiempo medido real
~29s, ~5.9x sobre el objetivo contractual
([ADR-183](docs/decisions/183-benchmark-real-o3-export-pdf-falla-umbral-5s.md)),
seguido de una pasada de optimización real (fuentes locales,
`domcontentloaded` en vez de esperar red completa,
[ADR-184](docs/decisions/184-optimizacion-real-export-o3-fuentes-locales-domcontentloaded.md))
y, finalmente, la **decisión de negocio** de tolerar el tiempo optimizado en
vez de seguir invirtiendo en el objetivo literal de <5s — desviación
reconocida y aceptada explícitamente, pendiente de countersign formal de
Gerencia General
([ADR-185](docs/decisions/185-decision-negocio-cierre-o3-export-async-tolerancia-espera.md)).

### Bug real de rendimiento en TimescaleDB

Consulta de "último valor" sin cota de tiempo sobre `telemetry_fact`
(~10.900 chunks acumulados) que no completaba ni con `statement_timeout` de
10s, afectando al evaluador de alarmas, al dashboard general y al estado de
simulación — corregido en los 3 sitios acotando la ventana de tiempo,
medido antes/después contra el stack real
([ADR-186](docs/decisions/186-bug-real-timescaledb-chunk-scan-sin-cota-tiempo.md)).

### Motor de fórmulas real y reconstrucción del tab "Cálculo"

Activación del esquema de fórmulas por sensor que estaba diseñado pero
nunca implementado: parámetros configurables, expresiones `tinyexpr`,
evaluador en tiempo real (poller 10s), y pantalla real de administración de
sensores
([ADR-187](docs/decisions/187-administracion-sensores-motor-formulas-tiempo-real.md)).
Reconstrucción del tab legado "Cálculo" (antes un catálogo de demostración
fabricado, empresa/mina ficticias, sin relación con sensores reales) para
operar sobre datos reales, con un catálogo nuevo de tipos de sensor
gobernado por un admin de plataforma, y cierre del gap de autorización por
tenant en las rutas de lienzo del sidecar
([ADR-188](docs/decisions/188-reconstruccion-tab-calculo-motor-real.md)).

### Retiro completo de InsightFace como motor biométrico secundario

Ejecutado el wiring que ADR-166 (2026-09-11) había dejado pendiente:
retirada la llamada auxiliar a `/face_embedding` de `face_analysis.cpp` (registro
y login), la rama `insightface_onnx` de `loginFaceTargetedPg`, y el paquete
`insightface`/modelo `buffalo_l` de `ai_engine`. **Hallazgo nuevo en esta
pasada**: el motor de avatares (`eye_analyzer.py`) también corría InsightFace
para dos chequeos internos de calidad (similitud de identidad del avatar,
bbox de respaldo) — la misma licencia no comercial que motivó ADR-166
aplicaba ahí también, sin que el ADR original lo hubiera detectado. Ambos
casos ya degradaban con gracia a "sin señal" sin motor disponible, así que
no requirieron código nuevo, solo dejar de instalar el paquete
([ADR-166, actualización 2026-09-14](docs/decisions/166-decomiso-insightface-secundario-adopcion-seetaface6.md)).

### Gobierno: confirmación formal pendiente de ADR-134 cerrada

El arquitecto del proyecto confirma por escrito la decisión de no auditar/
notificar retroactivamente el hallazgo crítico de ADR-134: la plataforma
está en etapa de desarrollo, sin clientes en ambiente de certificación,
pruebas ni producción. Cierra el ítem 6 de las 8 decisiones solicitadas a
Gerencia el 30-ago, que seguía sin registro escrito formal pese a la
decisión técnica ya tomada el 11-sep
([ADR-134, actualización 2026-09-14](docs/decisions/134-fix-critico-escalada-privilegios-autoregistro-empresa-existente.md)).

### Gobierno: R3 cerrado al 100% — countersign formal del Arquitecto TI sobre O3

El Arquitecto TI confirma por escrito que el tiempo de export medido y
optimizado (ADR-183/184, ~24-27s en el peor caso) no puede mejorarse hasta
el objetivo original de 5s sin una inversión de arquitectura no justificada
hoy, y refuerza el razonamiento de negocio de ADR-185: la exportación no es
de uso operativo frecuente, porque el informe técnico está pensado para
vivir dentro de la propia plataforma minera, no para exportarse de forma
rutinaria. Cierra el ítem 1 de las 8 decisiones solicitadas a Gerencia el
30-ago (acta formal de cierre de R3) — R3 pasa de 97.1% (68/70) a 100%
(70/70), avance global de 71.4% a 72.4% (144/199)
([ADR-185, actualización 2026-09-14](docs/decisions/185-decision-negocio-cierre-o3-export-async-tolerancia-espera.md)).

### Guía de migración a laptop nueva corregida — causa raíz real de una migración bloqueada

`MIGRACION_NUEVA_LAPTOP_2026-08-12.md` no listaba `avatar_engine`,
`silentface_engine` ni `avatar_animation_engine` (agregados después de su
fecha, ADR-141/143/150) — al migrar a una laptop nueva usando `export-stack.ps1`/
`import-stack.ps1` (ADR-111), las imágenes de esos 3 servicios llegaron bien
(el script las descubre en vivo desde `docker-compose.yml`), pero el
**`docker-compose.yml` de la laptop nueva estaba desactualizado**, sin sus
bloques de servicio — esos scripts nunca transfieren el archivo compose en
sí, solo imágenes/volúmenes/dumps de BD. Diagnóstico correcto: llevar el
`docker-compose.yml` real y actualizado del repositorio origen, no
reconstruir bloques de GPU/healthcheck a mano desde los ADR (tienen valores
no obvios, p. ej. `start_period: 900s` en `avatar_engine` por la descarga
de ~5GB en el primer arranque). Guía actualizada con las 3 filas de
servicio faltantes y sus rutas de host/volúmenes.

### Catálogo de plantillas de fórmula de calibración geotécnica (ADR-189)

Investigación profunda de la cadena de reglas ThingsBoard legada
`PiezometerRC-V2` (78 nodos/100 conexiones, compartida por el developer):
resultó ser un catálogo fijo de 23 familias de física de calibración de
instrumentos geotécnicos (Geokon, RST, Soil Instruments, Slope Indicator,
Casagrande), no un editor de fórmulas libre — documentado en
`docs/INVESTIGACION_MOTOR_CALCULO_LEGADO_THINGSBOARD_PIEZOMETROS_2026-09-14.md`.
El motor real (ADR-187) solo admitía una variable de telemetría por sensor,
insuficiente para reproducir esas 23 familias (todas necesitan mínimo
Freq+Temp, 4 necesitan además Press). Construido: catálogo de 27 plantillas
parametrizadas sobre el motor real (`db_scripts/95`), extensión acotada de
ingesta a canales nombrados solo para sensores multivariados (nueva ruta
`POST /api/mining/telemetry/multi`, cero regresión para sensores existentes
de un solo canal), endpoint para aplicar una plantilla a un sensor de una
sola vez (`POST .../formulas/apply-template`), extensión del sistema real de
alarmas para poder alarmar sobre un valor calculado en vez de solo telemetría
cruda, y UI de aplicación en `SensorManagementView.tsx`. Compiló limpio
(Catch2 100%) y sin errores de TypeScript. Pendiente: aplicar el script SQL
manualmente y verificar numéricamente contra un sensor real antes de usarse
en producción — ver ADR-189 para las simplificaciones documentadas y lo que
deliberadamente no se portó (excepciones hardcodeadas por dispositivo del
legado).

### Bug real: pantalla en negro al navegar a una sección sin permiso

Reportado en vivo por el developer probando con un usuario de rol `viewer`:
"Fórmulas de Sensores" ofrecía un botón "Crear la primera fórmula en
Sensores →" a cualquier usuario, sin filtrar por permiso; al hacer clic,
`App.tsx` cambiaba a la pestaña `DeviceManagement`, pero esa vista solo se
monta si `canMaintain` es verdadero — para un `viewer` ninguna rama de
renderizado coincidía y el área de contenido quedaba completamente vacía
(fondo oscuro = pantalla en negro), sin ningún error visible ni forma de
volver salvo recargar. Diagnosticado en vivo con un log
`[TAB_DIAGNOSTIC]` agregado para la ocasión (confirmó `sessionRole: 'viewer'`
en el momento exacto del cuelgue). Fix real de raíz: `onOpenSensors` ahora se
pasa `undefined` a `FormulaOverviewView` cuando el usuario no tiene
`canMaintain` (ese componente ya ocultaba sus propios botones si la prop no
llegaba) — un `viewer` ya no ve un botón que lo lleva a un callejón sin
salida. Queda además, como red de seguridad permanente (mismo criterio que
`navClickGuard.ts`, incidente de 2026-09-11), un fallback visible + log de
consola para cualquier otra pestaña gateada por permiso que llegue a
`activeTab` sin acceso, en vez de una pantalla vacía sin explicación.

### Filtros de búsqueda en Administración de Sensores

A pedido del developer, probando con Alpayana (142 sensores reales, 56 tipos
distintos): la tabla de sensores no tenía forma de acotar la vista más allá
de scrollear. Se agregó una barra de filtros combinables (búsqueda de texto
por código/nombre/etiqueta/serie/ID externo, tipo de sensor, zona, estado) en
`SensorManagementView.tsx`, con opciones de tipo/zona derivadas en vivo de
los sensores realmente cargados (no de la lista fija `SENSOR_TYPES` de 7
valores del formulario de alta, que no cubre los tipos reales de un tenant
como Alpayana). Filtrado 100% en el navegador (sin llamada nueva al
backend), con estado vacío específico para "sin resultados del filtro"
distinto de "sin sensores registrados".

### Bug real: `sensor_input_channel_def` nunca se creó (ADR-189)

Probando en vivo el catálogo de plantillas contra `PZ-VW-02` (piezómetro
real de Alpayana), aplicar una plantilla "funcionaba" (creaba las 3
fórmulas) pero enviar una lectura multicanal fallaba con `400
sensor_not_multichannel`. La tabla `sensor_input_channel_def` se diseñó y se
usó en todo el backend de ADR-189 pero su `CREATE TABLE` nunca se incluyó en
el script SQL — el `INSERT` correspondiente fallaba en silencio (resultado
sin revisar) y el resto de la aplicación de la plantilla seguía de largo
igual. Fix: nueva migración `db_scripts/96_sensor_input_channel_def.sql` +
manejo de error real en los 3 pasos de escritura de "Aplicar plantilla" (ya
no siguen en silencio si algo falla). Verificado en vivo end-to-end tras el
fix: lectura de prueba real (Freq=8520, Temp=18.5) → el evaluador calculó
MPA/MCA/ALT reales en el siguiente ciclo (~10s), los tres `status='ok'`.

## [Unreleased] — 2026-09-11

Catch-up documental: esta sección cubre el trabajo real entre el 2026-08-21
(última entrada de este archivo) y hoy, formalizado en
[ADR-129 a ADR-167](docs/decisions/README.md) — 20 días con la mayor
actividad documental del proyecto hasta la fecha, concentrada en biometría/
avatar (2026-09-02 a 09-11) y en el cierre de las decisiones pendientes del
corte gerencial del 2026-09-10. No reordena ni reescribe las entradas
previas.

### Plataforma y seguridad: hallazgo crítico, RBAC cruzado, MFA

RBAC de acceso cruzado empresa minera/organización
([ADR-130](docs/decisions/130-rbac-empresas-minera-organizacion-acceso-cruzado.md)),
consolidación del modelo de telemetría para 25k/s sostenidos
([ADR-131](docs/decisions/131-consolidacion-modelo-telemetria-unificado.md)),
aislamiento de cookies namespaced entre frontends en el mismo host
([ADR-132](docs/decisions/132-bearer-en-memoria-cookies-namespaced-aislamiento-multifrontend.md))
y endurecimiento post red-team propio (CSP, cookie cross-site, validación de
entrada,
[ADR-133](docs/decisions/133-endurecimiento-post-red-team-csp-cookie-cross-site-validacion-entrada.md)).
**Hallazgo más grave del proyecto hasta ahora**: `POST /api/auth/register`
público aceptaba `role:admin` contra una empresa ya existente con usuarios
reales, entregando una sesión administrativa completa — cerrado y verificado
en vivo el mismo día
([ADR-134](docs/decisions/134-fix-critico-escalada-privilegios-autoregistro-empresa-existente.md));
MFA/TOTP, alertas de seguridad y RUC obligatorio en el bootstrap de admin
([ADR-135](docs/decisions/135-mfa-totp-alertas-seguridad-ruc-bootstrap.md)).
Motor de alarmas reconciliado con SPEC-016 (cache de reglas, tasa de cambio,
debounce, evaluación por evento con hook post-commit, 179ms medidos en vivo,
[ADR-140](docs/decisions/140-alertas-umbral-cache-tasa-debounce-sensor.md)).

### Reportabilidad: notificaciones, QR sin password, DOCX nativo

Envío de informes a otros usuarios + notificaciones multicanal (in_app/
email/whatsapp/sms,
[ADR-137](docs/decisions/137-envio-informes-notificaciones-multicanal.md)),
enlace directo por QR sin password como segundo mecanismo junto al PDF
cifrado
([ADR-138](docs/decisions/138-enlace-directo-pdf-qr-sin-password.md)) y
exportación a `.docx` 100% client-side vía OpenXML
([ADR-139](docs/decisions/139-exportacion-docx-nativa-cliente.md)).

### Biometría y avatar: el bloque más grande del período

Ocho días (2026-09-02 a 09-10) de la mayor actividad de ADR del proyecto,
mayormente ámbito `ia`: avatar estilizado por difusión local (SD1.5 +
ControlNet,
[ADR-141](docs/decisions/141-avatar-estilizado-difusion-local-sd15-controlnet.md)),
liveness verificado en servidor con parpadeo natural pasivo, desafío activo
de un gesto y contador ICAO sin tolerancia
([ADR-142](docs/decisions/142-liveness-challenge-verificado-en-servidor.md),
[145](docs/decisions/145-parpadeo-natural-simultaneo-5-lecturas.md),
[146](docs/decisions/146-desafio-1-gesto-acercarse-alejarse-camara.md),
[148](docs/decisions/148-fusion-parpadeo-sensible-y-candado-lecturas-icao.md),
[149](docs/decisions/149-desafio-activo-en-paralelo-con-espera-de-parpadeo.md),
[156](docs/decisions/156-contador-icao-sin-tolerancia-y-retos-variados-con-reinicio.md) —
el defecto latente de clasificación "con lentes" que este último dejó sin
resolver ya está corregido, según confirma el developer, pendiente
certificación formal de QA). SilentFace movido a servicio aislado,
resolviendo de raíz un conflicto real de cuDNN con TensorFlow
([ADR-143](docs/decisions/143-silentface-servicio-aislado-cudnn.md));
InspireFace evaluado y descartado por licencia académica, sin ruta a
producción comercial
([ADR-144](docs/decisions/144-inspireface-evaluacion-licencia-academica.md)).
Guardrails de registro: buffer de nginx, reintentos no transitorios,
precheque de DNI/username
([ADR-147](docs/decisions/147-buffer-nginx-reintento-transitorio-precheque-dni.md),
[153](docs/decisions/153-reintento-login-facial-no-transitorio-y-precheque-username.md)),
beacon de diagnóstico de incidentes de cliente
([ADR-154](docs/decisions/154-beacon-diagnostico-client-incident.md)), OTP de
contacto antes de habilitar la cámara
([ADR-161](docs/decisions/161-otp-validacion-contacto-pre-registro.md)) y
reemplazo del tracking facial del cliente por MediaPipe Tasks Vision (WASM)
([ADR-162](docs/decisions/162-tracking-facial-local-mediapipe-wasm.md)).
Avatar animado evaluado (SadTalker verificado E2E con habla real; body
completo descartado por límite real de VRAM del host,
[ADR-150](docs/decisions/150-avatar-animado-reenactment-evaluacion.md),
[160](docs/decisions/160-avatar-cuerpo-completo-pose-driven-descartado-vram.md)),
con mejoras de calidad, encuadre y uniforme/logo de marca
([ADR-155](docs/decisions/155-avatar-diffusion-desactiva-safety-checker-nsfw.md),
[157](docs/decisions/157-avatar-encuadre-y-visibilidad-en-primera-sesion.md),
[158](docs/decisions/158-avatar-fuente-solo-etapa-1-icao.md),
[159](docs/decisions/159-avatar-mejoras-calidad-gfpgan-steps-mejor-seed.md),
[164](docs/decisions/164-avatar-busto-uniforme-logo-y-wiring-soporte.md)).
Curación del dataset de lentes (66k→111k imágenes) y reentrenamiento del
clasificador ONNX, con un fix de saturación de CPU que reaplica el mismo
patrón de ADR-100
([ADR-163](docs/decisions/163-curacion-dataset-lentes-reentrenamiento-onnx.md),
[165](docs/decisions/165-cpu-saturacion-workers-curacion-lentes.md)).

### Cierre de decisiones pendientes de Gerencia (2026-09-10/11)

El corte gerencial del 2026-09-10 dejó 10 decisiones pendientes; 9 ya están
cerradas: **InsightFace decomisionado** por licencia no comercial (mismo
hallazgo que InspireFace, pero éste sí en producción), reemplazado por
SeetaFace6Open ya integrado
([ADR-166](docs/decisions/166-decomiso-insightface-secundario-adopcion-seetaface6.md));
**alcance v1 del avatar de soporte** fijado a saludo de bienvenida, con
justificación de la inversión en IA y un **piloto QA implementado y
verificado en vivo** (avatar por difusión solo para cuentas en
`AVATAR_DIFFUSION_QA_USERNAMES`, aún vacía —
[ADR-167](docs/decisions/167-avatar-soporte-alcance-v1-saludo-bienvenida-justificacion-ia.md));
**validación SUNAT activada** vía Chequea, con un bug real de TLS 1.2-only
encontrado y corregido en el primer intento en vivo
([ADR-087](docs/decisions/087-validacion-ruc-registro-externo-opcional.md));
postura Enterprise LATAM confirmada (proyectos activos en Perú, Brasil,
Ecuador, Chile; pilotos sobre la VPS de Perú, topología edge+hub sin
aprobar,
[ADR-035](docs/decisions/035-plataforma-enterprise-latam.md)); rebaseline de
Operaciones de Campo aprobado como proyecto derivado
([ADR-110](docs/decisions/110-operaciones-campo-offline-integracion-erp.md));
notificación retroactiva de ADR-134 evaluada y no requerida (sin clientes
reales en ningún entorno a la fecha del hallazgo). Queda 1 decisión abierta:
pentest externo, simulacro DR y UAT sin proveedor ni fecha.

De paso: se corrigieron 13 citas cruzadas erróneas (ADR-146/148/149/156
citaban "ADR-143" por "ADR-145"), se cerró el hueco de numeración
ADR-151/152 (nunca tuvieron archivo — ver
[ADR-151](docs/decisions/151-numero-reservado-sin-uso.md)/
[152](docs/decisions/152-numero-reservado-sin-uso.md)), y se resolvió el
riesgo de trazabilidad de 227 archivos sin commitear (62 modificados + 165
nuevos) en 9 commits temáticos, ya en `origin/2026-08-21`.

## [Unreleased] — 2026-08-21

Catch-up documental: esta sección cubre el trabajo real de código entre el
2026-07-27 (última entrada de este archivo) y hoy, formalizado en
[ADR-068 a ADR-128](docs/decisions/README.md) — 61 decisiones que hasta ahora
solo vivían en `docs/decisions/` y en el árbol de trabajo, sin registro aquí.
No reordena ni reescribe las entradas previas.

### Reportabilidad: TypeScript estricto, bloques técnicos y presentaciones nativas

Migración completa del frontend de producción a TypeScript estricto
([ADR-069](docs/decisions/069-migracion-frontend-typescript-estricto.md)) y
bloques/plantillas técnicas por composición
([ADR-070](docs/decisions/070-bloques-tecnicos-plantillas-semanticas-composicion.md)),
con TOC fijo en página 2 con continuaciones automáticas
([ADR-071](docs/decisions/071-toc-pagina-dos-continuaciones-automaticas.md)) y
modal propio (`SaveTitleModal`) reemplazando `window.prompt()`, con fixes de
consistencia visual del ribbon
([ADR-073](docs/decisions/073-modal-propio-reemplaza-dialogos-nativos-consistencia-ribbon.md)).
Exportación a PPTX en modo presentación vía sidecar híbrido imagen + overlay
de texto editable
([ADR-083](docs/decisions/083-exportacion-pptx-modo-presentacion-sidecar-hibrido.md))
y conversión de ese PPTX a video narrado por diapositiva con `ffmpeg`
([ADR-084](docs/decisions/084-conversion-pptx-video-narracion-diapositiva.md)).
Vista previa de impresión, marca de agua y PDF cifrado con contraseña
([ADR-080](docs/decisions/080-marca-de-agua-y-password-pdf.md)). Cierre del
proceso: autoría nativa de documentos tipo "presentación" (16:9) en
ReportStudioV2, sin pasar por exportar un documento existente
([ADR-128](docs/decisions/128-plantillas-documento-tipo-presentacion.md)), y
aislamiento por usuario/tenant del caché offline SQLite del navegador con
purga en logout
([ADR-127](docs/decisions/127-aislamiento-cache-offline-sqlite-por-usuario.md)).
De paso: avatar biométrico local HD bajo demanda
([ADR-074](docs/decisions/074-avatar-biometrico-local-hd-bajo-demanda.md)),
lectura de DNI por cámara (PDF417+MRZ, sin RENIEC)
([ADR-094](docs/decisions/094-lectura-dni-camara-pdf417-mrz.md)) e
internacionalización país/idioma en el acceso
([ADR-075](docs/decisions/075-internacionalizacion-pais-idioma-acceso.md)).

### Auth, RBAC y empresas

CORS multiorigen para un segundo frontend externo
([ADR-081](docs/decisions/081-cors-multiorigen-frontend-externo.md)), access
token en cookie `HttpOnly` con CSRF double-submit
([ADR-082](docs/decisions/082-autenticacion-cookie-httponly-csrf-double-submit.md)),
separación de identificadores UUID y secretos CSPRNG
([ADR-076](docs/decisions/076-separacion-identificadores-secretos-csprng.md))
y migración versionada de contraseñas legacy a Argon2id
([ADR-077](docs/decisions/077-migracion-password-argon2id-versionada.md)).
RBAC real en informes (permisos por transición de workflow + inmutabilidad
post-firma,
[ADR-079](docs/decisions/079-rbac-workflow-informes-inmutabilidad-firma.md)),
CRUD completo de empresas
([ADR-085](docs/decisions/085-crud-empresas-y-pantalla-administracion.md))
con RBAC granular `empresas.view`/`empresas.manage`
([ADR-086](docs/decisions/086-rbac-granular-empresas-view-manage.md)),
validación de RUC con excepción externa opcional
([ADR-087](docs/decisions/087-validacion-ruc-registro-externo-opcional.md)) y,
ya en agosto, validación fiscal para Ecuador, Chile y Costa Rica con
fallback estructural para el resto del catálogo
([ADR-102](docs/decisions/102-validacion-fiscal-ecuador-chile-costa-rica-fallback.md)).
Geolocalización del dispositivo cliente extendida al login por
contraseña/PIN
([ADR-107](docs/decisions/107-geolocalizacion-cliente-login-contrasena.md)) y
estándares de accesibilidad/contraste en formularios
([ADR-106](docs/decisions/106-accesibilidad-contraste-formularios-ui.md)).

### Biometría: cambio de proveedor por defecto y liveness activo

Tres proveedores evaluados en cadena — SeetaFace6 libre y fail-closed
([ADR-104](docs/decisions/104-seetaface6-proveedor-biometrico-local.md)),
luego **DeepFace + Silent-Face-Anti-Spoofing como proveedor local por
defecto**
([ADR-105](docs/decisions/105-deepface-silentface-proveedor-biometrico-primario.md)),
que deja a Dermalog parcialmente superseded
([ADR-089](docs/decisions/089-biometria-dermalog-cli-integration.md) — ver su
bloque de actualización). Fallback a pipeline legacy cuando InsightFace
falla, sin bloquear
([ADR-099](docs/decisions/099-fallback-insightface-no-bloqueante.md)), límite
de hilos de onnxruntime para evitar sobre-suscripción en Docker
([ADR-100](docs/decisions/100-onnxruntime-thread-limit-insightface.md)) y
aislamiento por sesión en captura biométrica en vivo
([ADR-098](docs/decisions/098-aislamiento-sesion-captura-biometrica.md)).
Cierre de un hallazgo real de seguridad: la validación dejaba pasar con
lentes puestos (sin chequeo ICAO en login) — fusión ONNX corregida a
solo-veto y carrera de captura resuelta
([ADR-119](docs/decisions/119-validacion-lentes-biometria-login-y-fusion-onnx.md)),
con groundwork de liveness activo por giro de cabeza y recalibración de
`eye_analyzer.py` por resolución de cámara + thread-safety de MediaPipe
([ADR-125](docs/decisions/125-recalibracion-thread-safety-eye-analyzer.md)),
reactivado como **liveness activa por desafío-respuesta** (parpadear/boca/
girar cabeza) en login y registro
([ADR-126](docs/decisions/126-liveness-activo-desafio-respuesta.md)). Pool de
conexiones TCP reutilizables hacia `ai_engine`
([ADR-124](docs/decisions/124-pool-conexiones-tcp-ai-engine.md)).

### Núcleo de plataforma y datos

OpenCV 4.12.0 vía vcpkg en el backend, reemplaza apt 4.6.0
([ADR-096](docs/decisions/096-opencv-4-12-vcpkg-backend.md)); `ai_engine`
migra a NumPy 2.x, onnxruntime 1.23.2 y opencv-python-headless 4.14.x
([ADR-097](docs/decisions/097-numpy2-onnxruntime-opencv-python-ai-engine.md)).
Conversión GDAL runtime por CLI, administrada y confinada, supersede el
diferimiento de ADR-028
([ADR-072](docs/decisions/072-gdal-cli-runtime-admin-confinado.md)). Vite
5→8/Rolldown con fix de interop CJS→ESM en Plotly
([ADR-093](docs/decisions/093-vite8-rolldown-migracion-parcial-interop-plotly.md)).
Línea base de telemetría demostrada: **25.000 eventos/s por edge, cero
pérdida; 100.000 eventos/s explícitamente no aprobado**
([ADR-108](docs/decisions/108-capacidad-telemetria-25k-topologia-escalamiento.md)),
lote de líneas por lectura TLS en `mining-gateway` para reducir writes por
sesión
([ADR-120](docs/decisions/120-lote-lineas-lectura-tls-mining-gateway.md)),
catálogo por zonas y analítica multiserie de sensores
([ADR-109](docs/decisions/109-catalogo-zonas-sensores-graficos-multiserie.md))
y portabilidad del stack (export/import y perfil mínimo de telemetría, sin
ser DR)
([ADR-111](docs/decisions/111-portabilidad-stack-export-import-perfil-telemetria.md)).

### Integraciones externas: RP/Odoo y GEOCATMIN

Integración RP con TimeTelemetry/Odoo — réplica local, escritura por
XML-RPC, push realtime al frontend externo
([ADR-103](docs/decisions/103-integracion-rp-timetelemetry-replica-xmlrpc.md)).
Coordenadas geográficas de empresa en `auth_companies` para centrar Mapas en
la mina real
([ADR-121](docs/decisions/121-coordenadas-geograficas-empresa-mapa.md)) e
**integración nativa total de GEOCATMIN/INGEMMET** con ingreso directo a la
zona minera de la sesión activa
([ADR-123](docs/decisions/123-geocatmin-integracion-plataforma-minera.md),
SPEC-024 — nueva).

### Módulo nuevo: soporte / bot de WhatsApp (sin SPEC formal todavía)

Ocho ADR en cuatro días (2026-08-18/19) construyen un módulo completo que
**no existía en el cronograma v36 ni tiene número de SPEC asignado**: bot
conversacional de WhatsApp Business con menú, reclamos e IA, más plantillas
de presentación
([ADR-112](docs/decisions/112-chatbot-whatsapp-menu-reclamos-plantillas.md)),
enrutamiento multilínea por área vía `metadata.phone_number_id`
([ADR-113](docs/decisions/113-whatsapp-multilinea-enrutamiento-por-area.md)),
administración en caliente de números de contacto
([ADR-114](docs/decisions/114-whatsapp-bot-administracion-numeros-contacto.md)),
departamento de usuario + RRHH como quinta categoría de soporte
([ADR-115](docs/decisions/115-departamento-usuario-rbac-rrhh.md)),
persistencia del chat web con panel admin de búsqueda
([ADR-116](docs/decisions/116-persistencia-chat-web-panel-admin-busqueda.md)),
canal HomeMinero (web) con preparación para MovilMinero (campo, todavía sin
app)
([ADR-117](docs/decisions/117-canal-chatbot-homeminero-movilminero.md)),
aceleración GPU para Ollama por latencia del chatbot
([ADR-118](docs/decisions/118-chatbot-aceleracion-gpu-ollama.md)) y
postulaciones de CV por WhatsApp con extracción y scoring por IA local
([ADR-122](docs/decisions/122-cv-postulantes-whatsapp-ia-local-scoring.md)).
Verificado por build/tests; la entrega real a un teléfono depende de
credenciales de producción de Meta todavía no provistas.

### Operaciones de campo (propuesta, sin código)

Operaciones de campo offline-first e integración gobernada con ERP queda
**propuesta**, pendiente de aprobación de producto y arquitectura — no
confundir con una decisión ya tomada
([ADR-110](docs/decisions/110-operaciones-campo-offline-integracion-erp.md)).

### Metodología y housekeeping

Depreciación formal de los ADR tempranos de `specs/adr` para el Router de
IA — `docs/decisions/` queda como único log vigente
([ADR-090](docs/decisions/090-deprecacion-adr-tempranos-ia.md)). Composición
RAII para OpenCV en C++
([ADR-091](docs/decisions/091-opencv-composicion-raii.md)) y plantilla
corporativa Beemetry/TimeTelemetry como referencia de diseño
([ADR-092](docs/decisions/092-plantilla-corporativa-timetelemetry-referencia-diseno.md)).
Corrección real encontrada en `db_scripts/`: cuatro colisiones de numeración
(`29_*`, `44_*`, `54_*`, `56_*` duplicados) resueltas renombrando los
archivos más nuevos a `64_`–`67_`, con `docker-compose.yml` actualizado para
no romper el primer arranque de un volumen `db_data` nuevo — ver el detalle
completo en [docs/decisions/README.md](docs/decisions/README.md).

### Pendiente de este catch-up

`scripts/project-status-metrics.ps1` sigue reportando **106/196 tareas =
54,1%** sin cambios desde el 2026-08-18: los 17 ADR más recientes (112–128)
documentan código real, pero varias piezas —el módulo de soporte/WhatsApp
completo y SPEC-024 (GEOCATMIN)— todavía no tienen `tasks.md` propio y por
lo tanto no mueven esa métrica. Ver
`docs_/01_Planificacion/Informe_Estado_Proyecto_Actualizado_2026-08-18.md`
para el detalle de gates y riesgos.

## [Unreleased] — 2026-07-27

### CORS multiorigen para un segundo frontend externo (2026-08-02)

`BEEMETRY_CORS_ALLOWED_ORIGIN` admite ahora una lista separada por comas
(retrocompatible con un solo valor). `router::Router::dispatch()` refleja,
por request, cuál de esos orígenes matchea el header `Origin` entrante —
sin tocar cookies/CSRF ni el wildcard `*`. Habilita una segunda app
frontend (repo aparte) contra este mismo backend cuando se despliega
same-site. Detalle completo en
[ADR-081](docs/decisions/081-cors-multiorigen-frontend-externo.md) y el
contrato de auth/permisos para esa app en
[docs/integration/EXTERNAL_FRONTEND_AUTH.md](docs/integration/EXTERNAL_FRONTEND_AUTH.md).

De paso, `pdf-export-service/Dockerfile` dejó de fallar en build: la imagen
base de Puppeteer trae dos repos apt de Google Chrome preconfigurados
(`google-chrome.list`, `google.list`) que no usa (el Chromium real lo
instala Puppeteer, no apt) y cuya clave GPG rota — cuando queda vencida,
`apt-get update` tumbaba la instalación de `qpdf`/`ffmpeg` aunque no
dependan de ese repo. Se eliminan ambos archivos antes de actualizar.

### Optimización de latencia frontend/backend (2026-08-02)

Revisión de rendimiento de extremo a extremo. Tres cuellos de botella
independientes que se multiplicaban entre sí:

- **Bundle inicial: 4.26MB → 607KB (177KB con gzip).** Todas las vistas
  pesadas (`three`, `echarts`, `plotly`, `konva`, `leaflet`, `tiptap`,
  `sql.js`, `hls.js`) eran imports estáticos en `App.tsx`, así que se
  descargaban y parseaban íntegras antes de pintar el login — que no usa
  ninguna. Ahora van con `React.lazy` + una frontera `Suspense`, y
  `build.rollupOptions.output.manualChunks` las separa en chunks `vendor-*`
  estables (cacheables a 1 año, ya no se invalidan al tocar código propio).
- **nginx no comprimía nada salvo HTML.** Se sirvían ~9.3MB de JS sin
  comprimir. Se habilita `gzip` (+ `gzip_static`, `gzip_proxied any` para que
  también aplique a los JSON de `/api/`).
- **El backend cerraba la conexión TCP después de CADA request.**
  `session()` en `main.cpp` leía una sola request y hacía `shutdown`: cada
  llamada a la API costaba un handshake TCP completo *más* el spawn de un
  hilo del SO nuevo (el accept loop hace `std::thread(...).detach()`). Ahora
  hay bucle keep-alive con tope de 100 requests/conexión y timeout de ocio
  configurable (`BEEMETRY_HTTP_KEEPALIVE_TIMEOUT`, default 15s; `0` restaura
  el comportamiento anterior). El timeout usa `SO_RCVTIMEO` y no
  `expires_after()` de beast, que solo afecta a operaciones asíncronas — con
  lecturas síncronas una conexión ociosa habría dejado su hilo colgado.
- **Plotly: 4.75MB → 1.15MB.** `LiveChartBlock` era el único consumidor de
  Plotly en toda la app y solo dibuja trazas `scatter` y `bar`; se cambia el
  bundle completo por `plotly.js-basic-dist-min`.
- `router.cpp`: el match de rutas por prefijo usaba `substr()`, que
  construía un `std::string` temporal por ruta evaluada y por request. Ahora
  usa `starts_with` (C++20).

### Vista previa de impresión, marca de agua y PDF cifrado con contraseña (2026-08-02)

- ADR-080: "Imprimir" del ribbon ya no imprime la app completa — abre una
  vista previa real (`ReadOnlyViewer`) con "Imprimir" (nativo del navegador)
  y "Descargar PDF protegido" como acciones separadas.
- Todo PDF exportado vía `GET /api/reports/{id}/export/pdf` ahora lleva marca
  de agua en cada página (texto resuelto server-side, reutiliza la columna
  `report_document_settings.watermark_json` que existía sin uso desde
  ADR-019) y queda cifrado con una contraseña de usuario generada por
  descarga (`qpdf`, cifrado PDF estándar AES-256) — no persiste en ningún
  lado, se muestra una única vez en el frontend.
- Post-procesado (watermark + cifrado) vive en el sidecar
  `pdf-export-service` (nuevas dependencias: `pdf-lib`, `qpdf` vía apt) —
  el backend C++ sigue sin ninguna dependencia de manipulación de PDF.
- Nueva variable de entorno obligatoria en producción:
  `PDF_OWNER_PASSWORD_SECRET` (`docker-compose.prod.yml`, `.env.example`).

### RBAC real en el módulo de informes (2026-08-02)

- ADR-079 cierra una brecha crítica encontrada en auditoría: el módulo de
  informes (`report_routes.cpp`/`report_service.cpp`) solo verificaba tenant,
  nunca rol/permiso — cualquier usuario del tenant podía aprobar, firmar o
  eliminar cualquier informe técnico minero.
- Permiso por transición de workflow resuelto por el estado actual (mismo lock
  de fila que la máquina de estados): `informes.edit` en `draft`/`rejected`,
  `informes.sign` en `in_review`/`approved`. Crear/importar exige
  `informes.edit`; eliminar exige `informes.sign`.
- Un informe `signed`/`archived` queda inmutable sin excepción de rol (ni
  admin) — ni edición de contenido ni eliminación.
- Nuevo hook reutilizable `frontend/src/auth/usePermissions.ts` (consume el
  endpoint `GET /api/auth/permissions`, ya existente pero sin uso hasta hoy) —
  reemplaza comparaciones de `session.role` hardcodeadas en `WorkflowPanel`,
  `ReportsAdminModal` y el `canMaintain` de la plataforma; agrega guard de
  render explícito a las vistas de administración.

### Auditoría ADR y bloqueantes de identidad

- Evidencia local cerrada al 2026-07-29: backend `3c6acc4d30a1`, frontend
  `32a8977e4138`, smoke auth E2E completo y deduplicación de empresa con 409
  case-insensitive.
- Router IA corrige trazabilidad de auth: infiere `SPEC-006` desde rutas
  `backend/src/auth`/`frontend/src/auth` y carga ADR-076/077/078 sin depender
  de que el texto de la tarea mencione el SPEC explícitamente.
- Inventario real de hashes actualizado: 14 cuentas Argon2id y 40 legacy; el
  retiro del verificador legacy queda como gate operativo hasta inventario cero
  o reset administrado formal.
- ADR-076 implementa OpenSSL CSPRNG para IDs, refresh/`jti` y API keys.
- ADR-077 implementa Argon2id autocontenido y rehash oportunista de hashes
  históricos sin invalidación masiva.
- CORS queda acotado al origen configurado, con credenciales y
  `X-CSRF-Token`; producción exige un origen HTTPS explícito.
- El build productivo ejecuta Catch2/CTest y falla cerrado ante regresiones.
- ECharts actualizado a 6.1.x: auditoría productiva npm en 0 vulnerabilidades.
- ADR-078 agrega alta admin de empresas con deduplicación y tenant real.
- Eliminado el panel TOC muerto; queda un único bloque TOC insertable.
- ADR-029/037/043/058/060/073/075, SPEC-006/008 e índice vigente
  reconciliados; `csrf_token_v2`, estado de despliegue y pendientes reales
  quedan explícitos.

### Acceso internacional por país

- Selector compacto país/idioma disponible desde login y registro, con
  PE→español, BR→portugués, CA→francés y US→inglés; cambio manual permitido.
- Traducción integral de las cuatro pantallas de autenticación, estados
  biométricos y navegación principal; nombres de países localizados.
- RUC peruano, CNPJ brasileño y documentos fiscales norteamericanos se
  validan según país; teléfonos se muestran con prefijo y se envían en E.164.
- Fallback local mantiene los selectores operativos sin catálogo backend.
- Eliminados `alert()`, `confirm()` y `prompt()` nativos activos; avisos,
  confirmaciones y captura de títulos usan modales accesibles traducidos.
- Corregidos el smoke CSRF (`csrf_token_v2`), las colisiones de sus datos de
  prueba y el UUID hexadecimal de longitud variable que hacía fallar altas
  aleatoriamente.
- Verificación: TypeScript/build OK, Vitest 25/25, E2E auth/face/audit/CSV/
  refresh-CSRF/logout OK, matriz fiscal PE/BR/US/CA 8/8 y navegador real ES/PT/FR/EN
  sin overflow a 1280×720 y backend Docker/CMake enlazado al 100 %.
- ADR-075 y SPEC-006/008 actualizados tras revisar conflictos con decisiones
  de navegación, LATAM, tenant, registro y biometría.

### Avatar biométrico local HD

- Avatar de cabecera rediseñado con relieve, indicador de ampliación y foco
  accesible; doble clic abre visor corporativo y clic fuera o `Esc` lo cierra.
- Generación local preferente MediaPipe/OpenCV, con fallback ONNX/AnimeGAN,
  miniatura de sesión y maestro vertical 4K bajo demanda.
- Nuevo endpoint autenticado `/api/auth/avatar/hd`, sin `user_id` controlado
  por cliente; caché privada y fallback para usuarios históricos.
- Se evita guardar el 4K en `localStorage`; la captura biométrica cruda no se
  agrega a la sesión ni se retiene por esta función.
- ADR-074 reconcilia el alcance biométrico real con ADR-004/025/027 sin
  habilitar visión EPP ni levantar el gate legal.
- Verificación: Python compila; TypeScript/build OK y 20 pruebas Vitest OK.
- Backend Docker/CMake compila y enlaza al 100 %. El paralelismo del build
  queda configurable y limitado a 2 por defecto para evitar agotar Docker.

### Navegación corporativa minera

- Cabecera compacta con título `Beemetry · Centro Minero`, contexto
  Minera/Unidad sin duplicación y estados resumidos.
- Menú reorganizado en carriles contiguos `Áreas` + opciones activas, ambos
  de una línea, con flechas automáticas y scroll táctil/horizontal.
- Iconos y objetivos táctiles más grandes, relieve 3D sutil, foco accesible y
  soporte para movimiento reducido.
- Etiquetas visibles simplificadas para operación: Gestión, Control, Terreno,
  Mapas, Permisos e Informes; Usuarios, Accesos y Umbrales.
- Verificación: TypeScript, build de producción, 18 pruebas frontend y QA
  visual en 1917 px/1366 px.

## [Unreleased] — 2026-07-24

### Auditoría integral de arquitectura

- ADR-068 documenta IA editorial multimodelo y limita la búsqueda
  bibliográfica externa a una acción explícita que no envía el cuerpo del
  informe ni telemetría.
- ADR-069 formaliza la migración del frontend productivo a TypeScript
  estricto.
- ADR-070 documenta bloques técnicos, plantillas semánticas y composición
  sobre tipos existentes.
- ADR-071 formaliza TOC único en página 2 y continuaciones automáticas.
- ADR-072 supersede ADR-028: GDAL runtime queda admin-only, con rutas
  confinadas, allowlists y jobs autenticados/tenant-owned.
- `docs/decisions/` pasa a ser la fuente canónica efectiva para RAG, agentes y
  CI; `specs/adr/` permanece como registro histórico. Las consultas con un
  identificador explícito (`ADR-NNN`) priorizan ahora el archivo canónico
  exacto antes de resultados semánticos o superseded.
- ADR-019 se reclasifica `partial`: faltan referencias cruzadas automáticas.
  ADR-025 se reconcilia con el runtime: login facial activo, visión EPP
  diferida y gate legal vigente.

### Verificación

- Frontend: tipos, build y 18 pruebas verdes.
- Plataforma IA: 9 pruebas verdes.
- Stack Docker: 17 servicios saludables; imagen web reconstruida.
- Estado histórico de esa corrida: 1 CVE moderada en `echarts@5.6.0` y
  fallback de contraseña. Ambos quedaron cerrados en la entrega 2026-07-27
  descrita al inicio de este changelog (ECharts 6.1.x + ADR-077).

## [Unreleased] — 2026-07-19

### Seguridad — auditoría integral interna/externa (ADR-058)
Auditoría con evidencia real (no estática nada más: pruebas en vivo contra
el stack corriendo). Resumen de lo CERRADO en esta pasada y lo que queda
como decisión del equipo.

**CERRADO (corregido + verificado en vivo):**
- **XSS almacenado en celdas de tabla del editor de informes** (alto). Las
  celdas son `contentEditable` que guardaban HTML crudo (`onChange(innerHTML)`)
  y se re-sembraban con `el.innerHTML = value` (TableBlock.tsx). Un editor
  podía pegar `<img onerror>`/`<svg onload>`/`<script>` en una celda; al
  abrir OTRO editor/revisor el informe en modo edición, el payload
  ejecutaba en su navegador. Como access+refresh token viven en
  localStorage, un XSS = robo de sesión persistente. Fix: sanitizador
  allowlist sin dependencias (`lib/sanitizeHtml.ts`, DOMParser) aplicado al
  renderizar y al guardar. Verificado: neutraliza todos los vectores y
  conserva el formato legítimo (`<span style="color;font-weight">` intacto).
  El ReadOnlyViewer y el export PDF ya eran seguros (React escapa `{cell}`).
- **IDOR horizontal + fuga sin auth en `/api/sensors/data`** (alto). (a) Sin
  `tenant_id` devolvía el inventario GLOBAL de sensores de TODOS los tenants
  sin pedir siquiera sesión; (b) con `tenant_id` solo verificaba que
  existiera una sesión, no que ese tenant perteneciera a ella — un usuario
  del tenant A podía leer los sensores del tenant B pasando su UUID. Fix
  (sensor_service.cpp): sesión obligatoria + tenant efectivo derivado de la
  sesión vía `resolveAllowedSensorTenant` (mismo criterio IDOR-proof que
  reports/surveillance). Verificado: sin token → 401 (antes 200 con datos).
  El mismo blindaje se aplicó al nuevo `/api/mining/telemetry/summary`.
- **Dependencias con CVEs altas**: Axios 1.13.6 → 1.18.1 (cierra SSRF por
  bypass de NO_PROXY, prototype-pollution auth-bypass, CRLF y null-byte
  injection), + form-data y linkify-it (ReDoS). `npm audit`: 3 altas → 0.
- **HSTS** (`Strict-Transport-Security`) añadido a las 4 locations estáticas
  de nginx (defensa en profundidad; el proxy TLS externo lo reenvía).
- **`dangerouslySetInnerHTML` innecesarios** en AlarmConfigView eliminados
  (etiquetas con Unicode real ≥ ≤ en vez de entidades HTML).

**VERIFICADO SANO (sin cambios necesarios):**
- Inyección SQL: todos los WHERE dinámicos usan placeholders `$N` con
  `PQexecParams`; nombres de columna desde whitelist. Limpio.
- Endpoints sensibles (kpis, markers, alarmas, cámaras, reports, dashboard
  metrics) ya devuelven 401 sin token.
- Secretos: todos vía `${...}`/`.env` (gitignoreado, sin secretos en git).
  Sin texto plano en compose.
- Contenedores: límites de recursos (memory+cpus) por servicio; backend
  HTTP solo a loopback en prod (nginx es el único ingress); ingesta IoT
  8443 autentica por `device_api_key_hash`. 17/17 contenedores healthy.

**PENDIENTE — decisión/esfuerzo del equipo (documentado, no cerrable en una
pasada de auditoría):**
- **Refresh token en localStorage** (alto): tanto access como refresh viven
  en localStorage (authStorage.ts), robables por cualquier XSS = toma
  persistente de cuenta. El ADR-029 lo describe como "server-side" pero se
  entrega y almacena en el cliente. Remediación recomendada: mover el
  refresh a cookie `HttpOnly; Secure; SameSite=Strict` + protección CSRF
  (hacerlo mal cambia XSS-theft por CSRF). Cambio arquitectónico.
- **Pentest externo de caja negra** (ya es la tarea #9 del backlog): los
  checks automatizables están cubiertos; un pentest formal requiere
  contratación y alcance del equipo de seguridad.
- **echarts@6** (1 CVE moderada restante): la corrige un salto semver-major
  que puede romper todos los gráficos → migración deliberada, no forzada.
- Menores: `db_replica` corre como `user: root` (solo interno, sin puerto
  al host); el compose de DEV expone mailpit/mqtt/tiles (el de PROD no);
  otros proyectos comparten el host Docker (superficie de movimiento
  lateral ajena a esta plataforma).

### Dashboards — widgets estilo ThingsBoard en Monitoreo→Sensores (ADR-057)
- **Análisis de C:\thingsboard-master** (522 `widget_types` del sistema +
  librería ui-ngx): las familias de widget con valor minero Y con datos
  reales disponibles en `/api/sensors/data` son tres, y se portaron como
  módulo reutilizable `Dashboard/widgets/SensorWidgets.tsx` integrado en la
  vista EXISTENTE Monitoreo → Sensores (`AdvancedSensors.tsx`):
  - **Gauge radial con zonas** (TB `analogue_radial_gauge` /
    `digital_speedometer`): lectura actual del sensor seleccionado con arco
    verde/ámbar/rojo. Sin umbrales por sensor en el esquema todavía, las
    zonas se derivan del rango observado en su propio historial de 7 días
    (verde <75%, ámbar <90% — criterio por defecto de ThingsBoard).
  - **Tarjetas de agregación** (TB value/aggregation cards): mínimo,
    promedio, máximo y último del historial del sensor, con unidad real.
  - **Doughnut de distribución por estado** (TB `doughnut`): sensores del
    ámbito visible agrupados online/warning/critical/offline, total al
    centro.
- Familias evaluadas y DESCARTADAS deliberadamente por falta de datos de
  respaldo en el esquema `sensors` (verificado contra la BD): tanques de
  líquido, `battery_level`, `signal_strength`/RSSI, gateway/edge — un
  widget sobre datos inventados es peor que ninguno; se implementarán
  cuando la telemetría transporte esos campos. `TelemetryDashboard` (S2)
  no se amplió porque hoy corre sobre telemetría simulada (mock).
- **Dato demo corregido**: `mining_sensor_history` tenía su última muestra
  el 2026-04-15 — fuera de la ventana de 7 días del endpoint, por lo que el
  gráfico "Historial reciente" preexistente llevaba meses mostrando "Sin
  historial" (y los widgets nuevos habrían nacido vacíos). Se re-sembró la
  historia demo desplazando las muestras a la ventana actual (+336 filas).
- Verificado E2E en vivo: gauge + donut + gráfico renderizando con datos
  reales del inclinómetro INC-TAJO-01 (mín 11.66° · prom 12.42° · máx
  13.11° · último 12.53°).

## [Unreleased] — 2026-07-18

### Mapas — TODOS los tiles externos rotos por CSP × Service Worker (ADR-056)
- **Incidente**: el 100% de los tiles del mapa (base satelital Google + los
  WMS gubernamentales: INGEMMET, MINEM, OEFA, ANA, SERNANP, SENAMHI, MTC,
  IGN) aparecían rotos, con los servidores respondiendo bien por curl.
  **Causa raíz**: los `fetch()` de un Service Worker se rigen por la CSP
  del SCRIPT DEL WORKER, no por la de la página. `tile-cache-sw.js`
  (cacheo offline de tiles) intercepta esas URLs y las re-pide con fetch
  interno; la CSP general (`connect-src 'self' ws: wss:`) mataba cada
  fetch externo al instante ("Failed to fetch" en 0 ms) → tile roto, y
  como nunca había éxito, la caché offline jamás se poblaba (fallo
  permanente, no intermitente). **Fix**: `location = /tile-cache-sw.js`
  dedicada en `nginx.conf` con CSP propia (`default-src 'none';
  connect-src 'self' https:`) — el permiso amplio queda acotado SOLO al
  worker de tiles (mismo criterio que `img-src https:` de la página: el
  campo "WMS personalizado" admite cualquier GeoServer); la CSP estricta
  de la SPA no cambia.
- **Timeout adaptativo en el SW**: el corte de red a 2.5 s solo aplica
  ahora cuando EXISTE copia en caché a la cual caer; sin respaldo se
  espera hasta 20 s (un GetMap de SENAMHI tarda ~3 s por sí solo, y la
  ráfaga inicial de Leaflet —~18 tiles contra 6 conexiones por host—
  encolaba los últimos más allá del timeout).
- **Catálogo WMS saneado** (`wmsCorporateCatalog.json` v2, re-probado en
  vivo 2026-07-18): SENAMHI migrado a `/geoserver/ows` (el alias
  `/geoserver/wms` responde en >25 s); el WMS público de MINAM fue dado
  de baja por la entidad (404) y queda como plantilla manual; la región
  INGEMMET pasa a ser la primera del catálogo para que el preset POR
  DEFECTO del MapViewer sea una capa verificada y no una plantilla vacía
  (antes: abrir el mapa + "Activar WMS" → "Complete URL y capa WMS", nada
  cargaba).
- Verificado E2E en vivo: base satelital 18/18 tiles OK, INGEMMET
  catastro 18/18, SENAMHI clima 18/18, MTC vial 18/18, IGN centros
  poblados 18/18 (antes: 18/18 rotos en todos).

### Informes — Editor de texto enriquecido (ADR-055)
- **Bug real corregido: el área resaltada/seleccionada "se perdía" al
  agrandar el tamaño de fuente de una selección (A+/A- de la barra
  flotante)**. Causa raíz: el editor de texto usa una técnica de doble capa
  (`<textarea>` invisible para captura nativa + `<div>` superpuesto que
  pinta el formato real por tramo) — el `<textarea>` solo admite UN tamaño
  de fuente uniforme para todo su contenido, así que en cuanto una porción
  seleccionada tenía su propio tamaño (distinto al del bloque), el
  rectángulo de selección NATIVO del navegador (atado a ese tamaño
  uniforme/pequeño) quedaba desalineado y diminuto respecto al texto real,
  mucho más grande, que se veía en la capa de encima. Corregido
  reemplazando la selección nativa por un indicador propio, calculado
  dentro del mismo overlay que ya resuelve el tamaño real por tramo (por
  lo que hereda el escalado correcto automáticamente) y ocultando la
  selección nativa del navegador vía `::selection { background: transparent }`
  (`PageCanvas.tsx` — `getLiveSelectionRange` + split de segmentos del
  overlay; `styles.css`).
- **Color de resaltado (marcador) y ciclo de MAYÚSCULAS/minúsculas
  ("Aa", estilo Word Mayús+F3)** ahora disponibles tanto en la barra
  flotante (solo la selección) como en el ribbon fijo (todo el bloque
  cuando no hay selección activa) — mismo criterio "selección si existe,
  si no todo el bloque" que ya usaban negrita/cursiva/subrayado/color/
  tamaño/fuente. Requirió:
  - Nuevo campo persistido `TextProps.highlightColor` (resaltado BASE del
    bloque) además del ya existente `TextStyleSpan.highlightColor` (por
    selección) — distinto de `props.backgroundColor` (fondo de TODO el
    cuadro de texto).
  - Nuevo canal de puente ribbon↔selección
    (`registerActiveCaseHandler`/`tryApplyCaseToActiveTextSelection` en
    `activeTextFormatBridge.ts`) para el botón "Aa", ya que a diferencia de
    negrita/color/tamaño esta acción MUTA EL TEXTO en sí, no solo un
    atributo de estilo (`Partial<BaseTextStyle>`), y el puente existente
    solo transporta parches de estilo.
- Corregido además un byte nulo (`\0`) real encontrado en
  `PageCanvas.tsx` (dentro de una plantilla de cadena, `measureWordCached`)
  — corrupción de una edición anterior, sin efecto funcional pero
  reemplazada por el espacio correcto.
- Verificado en vivo end-to-end (interacción real de mouse/teclado, no solo
  eventos sintéticos): indicador de selección escalando correctamente de
  16px a 26px+, resaltado del ribbon aplicado a bloque completo, ciclo de
  mayúsculas aplicado a selección y a bloque completo, Tabla de Contenidos
  generada correctamente sigue detectando encabezados por selección tras
  estos cambios.

## [Unreleased] — 2026-07-07

### Seguridad
- **CSP (Content-Security-Policy)** implementado (`router.cpp` + `nginx.conf`),
  cerrando el ítem que había quedado pendiente el 2026-07-05. Orígenes
  externos auditados (Google Fonts, Tailwind CDN, WMS gubernamentales);
  `img-src` permite `https:` sin allowlist de host por el campo real de
  "WMS personalizado (URL manual)" en `MapViewer.tsx`. Verificado con
  rebuild/redeploy real y `curl -I` contra `beemetry-web`.
- **Autenticación híbrida JWT** (access token corto + refresh token opaco
  server-side, rotación estricta, denylist de revocación por `jti`) — ver
  ADR-029 revisado.

### Rendimiento (React)
- **9 componentes memoizados** en 3 rondas (`PageCanvas`, `LeftLibrary`,
  `SensorWidget`, `MiningKpiWidget`, `TableBlock`, `MiningDashboard`,
  `AdvancedSensors`, `TelemetryDashboard`, `VideoDiagram`, `AlarmCenter`),
  cada uno con justificación verificada de por qué el memo es real (no
  cosmético) — ver `GAP_ANALYSIS_2026-07-04.md` § Ronda 3. 3 componentes
  muertos detectados (`AdvancedTableBlock`, `DynamicSensorField`,
  `CoverPage.tsx` nunca se importan).

### Informes (ADR-012)
- **Snapshot congelado de KPI/sensor al firmar**: `ReportStudioV2/App.tsx`
  captura el valor en vivo de cada widget kpi/sensor citado justo antes de
  confirmar la transición a `signed`, escribiéndolo en
  `element.props.snapshot`. Hallazgo real durante la implementación:
  `ReadOnlyViewer.tsx` y `exportEngine.ts` (DOCX) no tenían NINGÚN caso para
  `element.type === 'sensor'` — ese bloque desaparecía silenciosamente al
  exportar o ver en solo lectura (el export PDF reusa `ReadOnlyViewer`, ADR-016).
  Corregido en ambos.

### Rebrand (ADR-000, ADR-033)
- `PLATFORM_NAME` → `Beemetry` (antes `AURIXA`) en `platformBrand.config.ts`
  y todos los textos hardcodeados encontrados (`App.tsx`, `FormulaEngineEmbed.tsx`,
  `CoverPage.tsx`, `exportEngine.ts`).
- Target CMake `mapas_backend` → `beemetry_backend` (+ `entrypoint.sh`,
  `docker-compose.e2e-verify.yml`); `package.json` → `beemetry-frontend`.
- Los 14 `container_name` de `docker-compose.yml` renombrados de `aurixa-*`
  a `beemetry-*`. Los nombres de *servicio* (`web`, `frontend`, `db`, etc.)
  y el alias de red `backend` (usado por `nginx.conf` para el proxy) no
  cambiaron — verificado que el rename de `container_name` no tiene ningún
  acoplamiento funcional con enrutamiento/`depends_on`/healthchecks antes de
  aplicarlo. Stack completo (14 servicios) reconstruido y redesplegado,
  todos `healthy` tras el rename.
- Docs de negocio (`Referencias/`, SOW, cronogramas) deliberadamente NO
  tocados — son material histórico, per la regla del propio ADR-000.

## [Unreleased] — 2026-07-03 a 2026-07-05

### Seguridad (crítico)
- **Corregidos 2 IDOR** en gestión de usuarios (`GET /api/auth/users`,
  `POST /api/auth/users/maintenance`, `GET /api/auth/users/maintenance/audit`):
  el tenant ya no se toma de parámetros controlados por el cliente, siempre
  de la sesión autenticada. Verificado con ataque cruzado real de 2 tenants.
- **Auditoría append-only con hash encadenado** (`platform_audit_log`):
  trigger que bloquea `UPDATE`/`DELETE` incluso para el rol propietario de la
  tabla, cadena de hash SHA-256 verificable vía `fn_audit_log_verify_chain()`.
- **Comando/inyección**: `shellQuote()` aplicado a los 4 puntos que invocaban
  `std::system()` con datos externos (surveillance, biometría, GDAL).
- **Headers de seguridad HTTP** (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`) aplicados a toda respuesta de la API y a los assets
  estáticos del frontend. CSP completo queda pendiente (requiere auditar
  orígenes externos ya en uso antes de aplicar una política estricta).

### Datos y rendimiento
- **`mineria_lecturas` convertida a hypertable TimescaleDB** (chunks de 7
  días, compresión >30 días) — migración con integridad verificada byte a
  byte contra un dump real de producción.
- **Lecturas de dashboards/KPIs enrutadas a la réplica read-only**
  (`aurixa-db-replica`), aislando el primario de la carga de lectura.
- **Memory safety**: los 11 archivos backend con acceso a Postgres migrados
  de `PGresult*` crudo + `PQclear()` manual a `storage::PgResult` (RAII) —
  elimina la clase de fuga de memoria en cualquier `return`/`throw` temprano
  entre `PQexec` y `PQclear`.

### Workflow e informes (ADR-015, 017, 018)
- **Máquina de estados canónica** (`draft → in_review → approved → signed →
  archived`, con `rejected → draft`) validada server-side en cada
  transición — antes el cliente podía enviar cualquier string sin
  validación. Migración de datos legacy (`published` → `archived`) +
  `CHECK` constraint en `reports.status`.
- **Firma documental** (ADR-018): el estado `signed` ahora registra quién
  firmó (nombre/cargo resueltos server-side, nunca confiados del cliente) y
  cuándo, en columnas nuevas de `reports` — antes solo se cambiaba el string
  de estado sin ningún registro de aprobación humana.
- **Comentario de transición** (p.ej. motivo de rechazo) ahora llega al
  servidor y queda en la auditoría con hash encadenado — antes solo vivía en
  el navegador del usuario.
- **Versionado autoritativo en servidor** (ADR-015): cada guardado
  confirmado (autosave o manual) genera una revisión real en
  `report_content_revision`; el historial de versiones en la UI ya no se
  pierde al recargar la página.
- **Export PDF server-side** (ADR-016): nuevo sidecar Chromium headless que
  reutiliza el mismo componente de solo-lectura que ve el usuario —
  fidelidad visual garantizada, sin motor de render duplicado.
- **Serialización de bloques cover/toc** en el modelo de documento (antes no
  se guardaban al persistir el informe).

### Frontend / UX
- Barra de menú retráctil aplicada a **todos los menús** (no solo Informe
  Técnico), maximizando el área de trabajo.
- Corregido parpadeo de cámara/video en el modal de captura de imágenes.
- Corregido bug de sincronización: `handleOpenEdit` ahora carga el estado de
  workflow y la firma real al reabrir un informe existente (antes mostraba
  el estado residual de la sesión previa).
- Corregido bug de timezone en el filtro de fecha de "Mis Informes": excluía
  silenciosamente los informes creados "hoy" para usuarios en timezone
  UTC-negativo (incluye Perú, la región de despliegue real).
- Vocabulario de estados unificado en `ReportsAdminModal` (antes mostraba
  "Borrador" para cualquier informe firmado o rechazado).
- `PageCanvas` memoizado (`React.memo`): evita re-renderizar todas las
  páginas del documento al editar una sola.

### Documentación de código
- Comentarios Doxygen (`@brief`) agregados a los headers de lógica de
  negocio (auth, KPIs, informes, sensores, cámaras, motor de fórmulas,
  pool de conexiones).

## Cómo verificar este changelog
Cada ítem de esta lista fue probado contra contenedores reales (`aurixa-db`,
`aurixa-api`, `aurixa-web`) — no solo compilado. Ver `GAP_ANALYSIS_2026-07-04.md`
para la evidencia detallada (queries, respuestas HTTP, capturas) de cada fix.
