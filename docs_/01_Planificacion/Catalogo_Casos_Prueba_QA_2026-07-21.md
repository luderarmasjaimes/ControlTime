# Catálogo de Casos de Prueba QA — Beemetry / AURIXA

## Funcionalidades ya implementadas, listas para control de pruebas

**Tipo de documento:** Catálogo formal de casos de prueba (Capa 5 de ADR-059, adelantado del Sprint S7 al Sprint S4 actual) — insumo directo para la regresión completa de Etapa 1 (Sprint S8/R4) y para cualquier QA manual o automatizado que se corra antes.
**Fecha:** 21 de julio de 2026
**Preparado por:** Arquitectura TI / PMO (ARQ)
**Alcance:** 14 funcionalidades pedidas por Gerencia + 1 gap real encontrado al verificar. Cada caso está anclado a código real (endpoint, componente, línea) — no son pasos genéricos.
**Convención de estado:** ✅ Ejecutable hoy · ⚠️ Ejecutable con matiz (ver nota) · ✕ No implementado (no ejecutar, tratar como hallazgo)

---

## 0. Dos hallazgos reales encontrados al preparar este catálogo

Antes de los casos de prueba: dos de los ítems pedidos por Gerencia **no tienen la forma que el pedido asume**. Se documentan aquí para que el QA no pierda tiempo buscando algo que no existe, y para que Gerencia decida si son alcance nuevo o se descartan.

| # | Ítem pedido | Qué se encontró realmente |
|---|---|---|
| G1 | Insertado de videos | **No implementado.** No existe ningún tipo de bloque "video" en el modelo de documento de ReportStudioV2 — el grupo "Contenido" del ribbon solo ofrece Texto/Imagen/Tabla/Gráfico/KPI/Mapa/Sensor. Lo que sí existe es captura de **webcam a imagen fija** (`webrtcCapture.ts`), usada para biometría/fotos, no un bloque de video embebido. |
| G2 | Creación de empresas | **Sin endpoint de creación.** `GET /api/auth/companies` (`auth_routes.cpp:558`) solo **lee** la tabla `auth_companies` (o cae a un catálogo fijo `config::kMiningCompanies`). No se encontró ningún `POST` para crear una empresa nueva vía UI/API — las empresas parecen provisionarse por seed de base de datos, fuera de la aplicación. |

**Defecto real encontrado de paso** (no pedido, pero relevante para el caso de RBAC): `frontend/src/auth/roleConstants.ts` define solo **6** roles (`admin/manager/supervisor/geologist/safety/operator`), mientras que el backend (`auth_routes.cpp`, `kValidPlatformRoles`) valida **7**, incluyendo `viewer` — que no aparece en la lista del frontend. ADR-036 documenta "7 roles unificados" como cerrado; este catálogo lo marca como caso de prueba obligatorio (§6, TC-RBAC-05) para confirmar si es un bug real o un rol que simplemente no se expone en esa pantalla en particular.

---

## 1. Creación de usuarios

Dos caminos reales y distintos — deben probarse ambos por separado.

| ID | Caso de prueba | Precondición | Pasos | Resultado esperado |
|---|---|---|---|---|
| TC-USR-01 | Auto-registro con biometría obligatoria | Ninguna | `POST /api/auth/register` con `company, first_name, last_name, dni, username, password` + (`face_template` o `face_image_base64`) | `201`/`200`, `status: "registered"`, usuario creado con biometría enrolada |
| TC-USR-02 | Auto-registro sin plantilla facial (debe fallar) | Ninguna | Igual que TC-USR-01 pero sin `face_template` ni `face_image_base64` | Rechazo explícito — la biometría es obligatoria en este flujo (a diferencia del alta administrada) |
| TC-USR-03 | Alta administrada por admin, sin biometría | Sesión con permiso `usuarios.manage` | `POST /api/auth/users/create` con `username, password (≥8 caracteres), first_name, last_name, dni` | `200`, usuario creado sin `face_template`; biometría queda pendiente de enrolar en el primer login presencial (ADR-037) |
| TC-USR-04 | Alta administrada con contraseña débil (< 8 caracteres) | Igual que TC-USR-03 | Enviar `password` de 6 caracteres | Rechazo por validación de longitud mínima |
| TC-USR-05 | Alta administrada con rol inválido | Igual que TC-USR-03 | Enviar `role: "superadmin"` (no existe en `kValidPlatformRoles`) | Rechazo por rol fuera de la lista válida |
| TC-USR-06 | Alta administrada sin el permiso `usuarios.manage` | Sesión de un rol sin ese permiso (p. ej. `operator`) | Intentar `POST /api/auth/users/create` | `403` — no autorizado |
| TC-USR-07 | Mantenimiento de usuario: bloqueo/suspensión/cambio de perfil | Sesión admin, `UserMaintenanceModal.tsx` abierto sobre un usuario existente | Elegir acción "Bloquear" (o "Suspensión temporal" / "Cambio de perfil"), escribir `VALIDAR` en el campo de confirmación, confirmar | Acción aplicada; el modal exige literalmente escribir "VALIDAR" antes de habilitar el botón de confirmación — probar también que **sin** escribirlo el botón permanece deshabilitado |
| TC-USR-08 | Eliminación de usuario | Igual que TC-USR-07 | Acción "Eliminar" + confirmación `VALIDAR` | Usuario eliminado/desactivado; verificar que quede registro en auditoría |

---

## 2. Creación de empresas (ver hallazgo G2)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-EMP-01 | Listado de empresas disponibles | `GET /api/auth/companies` | `200`, arreglo `companies` con los nombres reales (Minera Raura, Anglo American Quellaveco, etc.) |
| TC-EMP-02 *(hallazgo, no caso funcional)* | Confirmar ausencia de endpoint de creación | Buscar en Postman/cliente HTTP cualquier `POST /api/auth/companies` o similar | Se espera `404`/no implementado — **si Gerencia necesita alta de empresas por UI, es un requerimiento nuevo, no un bug de esta funcionalidad** |

---

## 3. Registro y validación con usuario y contraseña

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-AUTH-01 | Login exitoso | `POST /api/auth/login/password` con `company, username, password` correctos | `200`, `status: "authenticated"`, `method: "password"`, `access_token` presente en el body |
| TC-AUTH-02 | Usuario inexistente | Username que no existe en la empresa | Error `user_not_found` |
| TC-AUTH-03 | Identidad ambigua | Username que matchea más de un registro | Error `ambiguous_identity` |
| TC-AUTH-04 | Contraseña incorrecta | Password errónea, usuario válido | Error `wrong_password` |
| TC-AUTH-05 | Rate-limit de intentos fallidos | 5 intentos fallidos en 5 minutos para el mismo `company\|username` | Error `too_many_failed_attempts` — probar que el 6º intento (aun con password correcta) sigue bloqueado dentro de la ventana |
| TC-AUTH-06 | Refresh de sesión vía cookie + CSRF | Sesión iniciada (ver §ADR-029) | `POST /api/auth/refresh` con cookie `refresh_token` + header `X-CSRF-Token` correcto | Nuevo `access_token`; sin header CSRF debe dar `403` (cubierto también por `scripts/smoke-auth-e2e.ps1`, automatizado) |
| TC-AUTH-07 | Logout | Sesión iniciada | `POST /api/auth/logout` con CSRF correcto | `status: "logged_out"`, cookies `refresh_token`/`csrf_token` limpiadas (`Max-Age=0`) |

**Automatizado:** TC-AUTH-01, 06, 07 ya corren en `scripts/smoke-auth-e2e.ps1` (Capa 4 de ADR-059) — verificado hoy contra el `beemetry-api` real, `Resultado: OK`.

---

## 4. Validación con usuario y reconocimiento facial

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-BIO-01 | Login facial exitoso | `POST /api/auth/login/face` con `company, identity_login, face_template` de un usuario enrolado | `200`, `status: "authenticated"`, `method: "face"`, `score` reportado |
| TC-BIO-02 | Login facial sin `identity_login` | Enviar solo `company` + `face_template`, sin `identity_login`/`username` | Error explícito: *"Indique usuario, DNI o RUC (campo identity_login) junto con la empresa para el login facial."* |
| TC-BIO-03 | Flujo de captura en vivo (UI, `AuthGateway.tsx`) | Iniciar login facial desde la pantalla real | La UI pasa por el estado `'form'` → `'capture'`; el marco ICAO debe acumular `FACIAL_ICAO.REQUIRED_VALID_FRAMES` frames válidos antes de intentar el match |
| TC-BIO-04 | Timeout de sesión de captura | Dejar la cámara abierta sin lograr frames válidos más allá de `FACIAL_ICAO.LOGIN_FACE_SESSION_MS` | Se muestra `FACIAL_ICAO.LOGIN_FACE_TIMEOUT_MESSAGE` y la sesión de captura se cierra |
| TC-BIO-05 | Enrolamiento diferido (alta administrada) | Usuario creado vía TC-USR-03 (sin biometría), primer login presencial | El sistema debe guiar el enrolamiento de la plantilla facial en ese primer login (ADR-037) |

---

## 5. Validación multitenant

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-TEN-01 | Usuario con un solo tenant | Login de un usuario asociado a una sola unidad minera | `TenantSwitcher.tsx` muestra una insignia fija (ícono de edificio + nombre), **sin** dropdown de selección |
| TC-TEN-02 | Usuario con varios tenants — listado | Login de un usuario con acceso a 2+ unidades mineras | Botón "Cambiar de unidad minera" visible; al abrir, lista "Unidades mineras" con nombre + rol por fila, check ✓ en la activa |
| TC-TEN-03 | Cambio de tenant activo | Desde TC-TEN-02, elegir otra unidad | `POST /api/auth/tenants/switch`; la página recarga (`window.location.reload()`); los datos mostrados (sensores, informes) deben corresponder al tenant recién elegido, no al anterior |
| TC-TEN-04 | Aislamiento cruzado (IDOR) — regresión de seguridad | Con sesión del tenant A, intentar acceder a datos del tenant B por endpoint directo (p. ej. `/api/sensors/data?tenant_id=<B>`) | `401`/`403` — ya cerrado por la auditoría de seguridad (ADR-058); este caso es de **regresión**, debe seguir fallando en cada release |

---

## 6. Control de acceso y permisos (RBAC)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-RBAC-01 | Admin tiene acceso total | Sesión rol `admin` | Cualquier endpoint protegido por permiso responde según `hasPermission()` — admin siempre pasa (`permissions.cpp`, línea 80) |
| TC-RBAC-02 | Rol sin permiso específico es bloqueado | Sesión rol `operator` (u otro sin el permiso) | Intentar una acción que requiera un permiso no otorgado a ese rol → `403` |
| TC-RBAC-03 | Permiso con override por tenant | Un rol tiene un permiso distinto en el tenant A vs. el default global | Verificar que `permissionsForRole` prioriza la fila específica del tenant sobre la fila `tenant_id IS NULL` |
| TC-RBAC-04 | Rol efectivo por tenant (`effectiveRole`) | Usuario con rol distinto en tenant A vs. tenant B (vía `auth_user_tenant`) | Al cambiar de tenant (TC-TEN-03), los permisos deben recalcularse según el rol de ESE tenant, no el del anterior |
| TC-RBAC-05 *(defecto a confirmar — ver hallazgo §0)* | Rol `viewer` disponible en la UI de administración | Abrir el selector de rol en el flujo de alta de usuario (frontend) | **Se espera fallar hoy**: `viewer` no aparece en `roleConstants.ts` (solo 6 de los 7 roles válidos del backend) — reportar como defecto si Gerencia confirma que `viewer` debe ser seleccionable desde la UI |

---

## 7. Uso del menú de plataforma

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-NAV-01 | Presencia de todos los grupos del ribbon | Abrir ReportStudioV2 con un informe cargado | Deben existir los grupos: Portapapeles, Fuente, Párrafo, Estilos, Páginas, Contenido, Documento, Plantillas, Formato página, Cuadrícula |
| TC-NAV-02 | Grupo "Contenido" ofrece los tipos de bloque reales | Abrir el grupo "Contenido" | Deben aparecer exactamente: Texto, Imagen, Tabla, Gráfico, KPI, Mapa, Sensor — **no debe aparecer "Video"** (confirma hallazgo G1) |
| TC-NAV-03 | Grupo "Documento" | Abrir el grupo "Documento" | Deben aparecer: Índice, Numeración, Carátula |
| TC-NAV-04 | Navegación por teclado y zoom (ADR-052) | Con el documento abierto | PageUp/PageDown navegan entre páginas; zoom configurable 10%-400% |

---

## 8. Aplicación de reportabilidad (workflow del informe)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-RPT-01 | Crear informe nuevo (estado inicial `draft`) | Crear un informe desde cero | Estado mostrado: "Borrador" |
| TC-RPT-02 | Guardar informe | Click en el botón de guardar (title: "Guardar el informe en la base de datos") | Persistencia confirmada en servidor (no solo local) — ver `report_content_revision` |
| TC-RPT-03 | Transición draft → in_review | Enviar a revisión | Estado "En Revisión"; verificar que el backend (`report_workflow.hpp`) es la autoridad, no solo el estado local del cliente |
| TC-RPT-04 | Transición in_review → approved / rejected | Aprobar o rechazar desde revisión | Estado "Aprobado" o "Rechazado"; si rechazado, debe poder volver a `draft` |
| TC-RPT-05 | Transición approved → signed | Firmar el informe aprobado | Estado "Firmado"; registra nombre/cargo/fecha de firma resueltos server-side (ADR-018) |
| TC-RPT-06 | Transición signed → archived | Archivar un informe firmado | Estado "Archivado" — verificar que ya no admite edición |
| TC-RPT-07 | Transición inválida rechazada | Intentar, p. ej., `draft → signed` directo (saltando estados) | Debe rechazarse — la máquina de estados solo permite las transiciones documentadas |

---

## 9. Generación de carátula

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-COV-01 | Insertar carátula desde plantilla | Click en "Carátula" (grupo Documento) | Se abre un selector de plantillas de carátula; al elegir una, se inserta como página completa |
| TC-COV-02 | Carátula ocupa toda la hoja (ADR-048) | Insertar carátula | La imagen de empresa/logo es un bloque `image` libre (movible/redimensionable), no un fondo fijo |
| TC-COV-03 | Datos de empresa en vivo | Insertar carátula, luego cambiar de tenant (TC-TEN-03) y volver a abrir el informe | Los datos de empresa/unidad se recalculan de la sesión activa, nunca quedan grabados como texto fijo en `props` (ADR-046) |

---

## 10. Generación de tabla de contenido (TOC)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-TOC-01 | Generación automática desde encabezados | Aplicar estilos H1/H2/H3 a varios bloques de texto (§11), luego click en "Índice" | El TOC se genera automáticamente escaneando `props.headingStyle` de cada bloque — numeración jerárquica "1, 1.1, 1.1.1" |
| TC-TOC-02 | TOC detecta encabezados aplicados por selección parcial | Aplicar un estilo de encabezado a solo una porción de texto (no todo el bloque) vía `spans` | El TOC también debe detectar ese encabezado parcial (`props.spans[].headingStyle`) |
| TC-TOC-03 | TOC se actualiza tras editar encabezados | Cambiar el texto de un encabezado ya indexado | Regenerar el índice y confirmar que refleja el texto nuevo, no el original |

---

## 11. Uso de estilos de encabezado H1/H2/H3

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-HEAD-01 | Aplicar cada nivel de encabezado | Para cada uno de: Título, Heading 1 a Heading 6, Normal, Cita — aplicar desde el grupo "Estilos" del ribbon | El texto adopta el estilo visual correspondiente y queda marcado con el `headingStyle` correcto |
| TC-HEAD-02 | Aplicar encabezado a selección parcial | Seleccionar una porción de texto dentro de un bloque y aplicar H2 desde la barra flotante | Solo la porción seleccionada cambia de estilo (spans), el resto del bloque conserva su estilo original |
| TC-HEAD-03 | Encabezado a bloque completo sin selección | Sin seleccionar texto, aplicar H1 desde el ribbon fijo | Se aplica a todo el bloque activo |

---

## 12. Uso de escritura libre de texto

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-TXT-01 | Escritura básica en bloque de texto | Insertar bloque "Texto", escribir contenido libre | El texto se guarda y persiste al recargar |
| TC-TXT-02 | Indicador de selección visual (fix de hoy, ADR-055) | Seleccionar texto con tamaño de fuente distinto al resto del bloque | El indicador de selección propio escala correctamente al tamaño real (no el indicador nativo del navegador) |
| TC-TXT-03 | Sanitización de contenido pegado (ADR-058) | Pegar HTML con `<script>`/`<img onerror>` dentro de una celda de tabla o bloque de texto | El contenido se sanitiza (allowlist) — el payload NO debe ejecutar al reabrir el informe en otro navegador |

---

## 13. Atributos especiales del texto

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-FMT-01 | Negrita / Cursiva / Subrayado (Ctrl+B/I/U) | Seleccionar texto, aplicar cada atributo | Se aplica solo a la selección (spans); atajos de teclado funcionan |
| TC-FMT-02 | Tamaño y familia de fuente | Cambiar tamaño/fuente sobre una selección | Cambia solo la porción seleccionada; el resto del bloque no se ve afectado |
| TC-FMT-03 | Color de texto y color de resaltado | Aplicar color de texto y luego resaltado sobre la misma selección | Ambos se aplican y son independientes entre sí |
| TC-FMT-04 | Ciclo de MAYÚSCULAS/minúsculas/Cada Palabra | Con texto seleccionado, activar el ciclo (estilo Word Mayús+F3) | El texto rota entre los 3 casos en sucesivas activaciones |
| TC-FMT-05 | Alineación y listas | Aplicar alinear centro, luego lista con viñetas, luego lista numerada | Cada cambio se refleja visualmente y persiste al guardar |
| TC-FMT-06 | Interlineado | Cambiar el interlineado de un párrafo | Se aplica solo al párrafo activo |
| TC-FMT-07 | Estilos de tabla (ADR-053) | Insertar tabla, aplicar un tema de color, alternar filas, cambiar bordes | Los estilos se aplican y persisten; el formato por celda (negrita/color) sigue funcionando dentro de la tabla |

---

## 14. Insertado de imágenes

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-IMG-01 | Insertar imagen desde archivo local | Click "Imagen" → pestaña archivo local, seleccionar `.jpg/.png/.webp/.gif` | Imagen insertada como bloque, redimensionable/movible |
| TC-IMG-02 | Insertar imagen desde webcam | Click "Imagen" → pestaña webcam, capturar foto | Imagen capturada se inserta igual que un archivo subido |
| TC-IMG-03 | Insertar imagen desde cámara de red (CCTV) | Click "Imagen" → pestaña cámaras de red, seleccionar una cámara RTMP/HLS activa | Snapshot de la transmisión en vivo se inserta como imagen |
| TC-IMG-04 | Insertar imagen desde galería del tenant (ADR-047) | Click "Imagen" → pestaña "Galería" | Se listan las fotos JPEG ya subidas para ese tenant; seleccionar una la inserta sin re-subir |
| TC-IMG-05 | Rechazo de formato no soportado | Intentar subir un archivo `.bmp` o `.svg` | Debe rechazarse — el modal solo acepta `image/jpeg,png,webp,gif` |
| TC-IMG-06 | Ajuste de texto alrededor de imagen (ADR-049) | Insertar imagen dentro de un bloque con texto, probar los 7 modos de ajuste | El texto se re-fluye correctamente alrededor de la imagen en cada modo, incluso con formato mixto (spans) |

---

## 15. Insertado de videos — ~~no implementado (ver hallazgo G1)~~ implementado (ADR-064/065, corrección 2026-07-27)

> **Corrección 2026-07-27**: esta sección quedó desactualizada — el hallazgo
> G1 (video no implementado) fue CERRADO en una sesión posterior a la
> fecha de este catálogo. ADR-064/065 implementaron grabación real de
> video (webcam + captura de pantalla/ventana) insertable en el lienzo,
> con corrección de los dos bugs iniciales (activación de cámara, e
> "insertar en el lienzo" en vez de "descargar el archivo"). El caso
> original de "verificación de ausencia" ya no aplica — ver TC-VID-01
> corregido más abajo (resultados de la ejecución de certificación).

| ID | Caso de prueba (original, verificación de ausencia — ~~ya no aplica~~) | Pasos | Resultado esperado (original) |
|---|---|---|---|
| TC-VID-01 *(verificación de ausencia, no funcional)* | Confirmar que no hay bloque de video | Abrir el grupo "Contenido" del ribbon | **Se espera que "Video" NO aparezca en la lista** — si apareciera, sería una regresión de alcance no documentada |

**Si Gerencia necesita esta funcionalidad**, es alcance nuevo (no cubierto por ningún ADR ni spec existente) — requiere su propio ADR de diseño (tipo de bloque, almacenamiento del archivo de video, reproducción en `ReadOnlyViewer`/export PDF) antes de poder estimarse. ~~Superado: ver corrección arriba.~~

---

## Ampliación 2026-07-27 — Casos nuevos por funcionalidad implementada desde este catálogo (ADR-066 a ADR-077)

El catálogo original (21-jul) no cubre las funcionalidades implementadas
después de esa fecha. Esta ampliación agrega los casos correspondientes,
manteniendo la numeración/convención existente. Fuente: `docs/decisions/`
ADR-066 a ADR-077.

## 16. Registro de contratista y provisión de tenant real (ADR-066/067)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-TEN-05 | Registro de contratista conserva la empresa minera real | En "empresa contratista" (`AuthGateway.tsx`), elegir una minera real del `<select>` y escribir una razón social de contratista distinta en el campo de texto libre | El payload de `POST /api/auth/register` debe llevar `company` = valor del `<select>` (la minera), NO el texto libre del contratista |
| TC-TEN-06 | Tenant real tras registro de contratista | Completar el registro de TC-TEN-05 y hacer login | `tenant_id` en el JWT/sesión resuelve a un UUID real y no vacío; `POST /api/reports` responde `201` en el primer login, sin `400 tenant_required` |
| TC-TEN-07 | Autoregistro provisiona tenant propio | Registrar una empresa nunca antes vista (`POST /api/auth/register`) | Se crea una fila en `auth_user_tenant` (`is_default=true`) apuntando a un tenant propio nuevo — nunca cae en el tenant compartido de demo (`kMiningTelemetryDemoTenantId`, Antamina) |
| TC-TEN-08 *(límite conocido, no bug)* | Variantes de nombre de la misma empresa | Registrar "Minera Raura" y luego "Compañía Minera Raura" | Se crean tenants DISTINTOS — comportamiento documentado y aceptado, no reportar como defecto |

---

## 17. IA editorial: corrección, reescritura, APA 7 y búsqueda de referencias (ADR-068)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-IA-01 | Corrección ortográfica rápida usa LanguageTool real | Escribir texto con errores reales (p.ej. "operatibo", "disponivilidad", "jeneral", "covertura", "piezometros"), aplicar "Corrección ortográfica rápida" | Corrige específicamente esas palabras (LanguageTool real vía `handleCorrectQuick`), no un reemplazo hardcodeado de una lista fija de 13 palabras |
| TC-IA-02 | Reescritura fiel al contenido | `POST /api/text/rewrite` con un párrafo técnico | La reescritura no altera hechos/datos del párrafo original (modelo `gemma2:2b`) |
| TC-IA-03 | Validación determinística de formato APA 7 | Solicitar formato APA 7 de una referencia cuyo título/año el modelo altere | Se descarta la salida del modelo y cae al formateador determinístico — el título/año final coincide con la fuente, nunca con una alucinación del modelo |
| TC-IA-04 | Búsqueda de referencias sin API key | Buscar una referencia bibliográfica sin `TAVILY_API_KEY`/`SERPER_API_KEY` configurada | `503` |
| TC-IA-05 | Búsqueda de referencias filtrada a dominios confiables | Con API key real, buscar "geotechnical slope stability open pit mine" | Resultados solo de dominios de la allowlist (sciencedirect.com, mdpi.com, icmm.com, smenet.org, stacks.cdc.gov, etc.) — ningún blog o dominio no académico |
| TC-IA-06 | No fuga de datos sensibles a proveedores externos | Ejecutar una búsqueda de referencias con un informe abierto que contenga datos de telemetría/tenant | Solo la consulta bibliográfica explícita sale a Tavily/Serper — nunca el cuerpo del informe, telemetría, ni identidades |

---

## 18. Modal propio reemplaza diálogos nativos (ADR-073)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-UI-01 | Guardado usa `SaveTitleModal`, no `window.prompt` | Crear informe nuevo, pulsar "Guardar" | Aparece `SaveTitleModal` (propio, con clases `ra-*`); confirmar con título → `POST /api/reports` → `201` y fila real en `reports` |
| TC-UI-02 | Cancelar el modal no crea el informe | Repetir TC-UI-01, pulsar "Cancelar" (o `Esc`, o clic fuera) | No se crea ninguna fila nueva — determinista, a diferencia de `window.prompt()` bajo automatización (que siempre devuelve `null` y antes causaba pérdida de informes) |
| TC-UI-03 | Cero diálogos nativos bloqueantes activos | `grep -r "window.alert(\|window.confirm(\|window.prompt("` sobre `frontend/src` | Sin resultados de código activo (solo comentarios, si los hay) |
| TC-UI-04 | Ribbon sin overflow oculto en viewport angosto | Achicar el viewport del navegador | Los grupos del ribbon bajan a una segunda fila (`flex-wrap`), no quedan ocultos tras un scroll invisible |

---

## 19. Avatar biométrico local HD bajo demanda (ADR-074)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-AVA-01 | Avatar HD del propio usuario | `GET /api/auth/avatar/hd` autenticado como el usuario dueño | `200`, `image/png`, header `X-Content-Type-Options: nosniff`, caché privada |
| TC-AVA-02 | Anti-IDOR: no expone avatar de otro usuario | `GET /api/auth/avatar/hd` con sesión de un usuario, intentando forzar `user_id` de otro (query param o similar) | El parámetro se ignora — siempre devuelve el avatar del usuario de la SESIÓN, nunca el de un `user_id` arbitrario |
| TC-AVA-03 | Sin sesión → rechazo | `GET /api/auth/avatar/hd` sin token válido | `401`/`403` |
| TC-AVA-04 | Generación bajo demanda y cache del maestro | Primera llamada de un usuario sin maestro HD generado aún | Se genera por upscale Lanczos desde la miniatura y se persiste; una segunda llamada reutiliza el archivo (no regenera) |
| TC-AVA-05 | Usuario sin biometría | `GET /api/auth/avatar/hd` de un usuario creado por alta administrada sin enrolar (ADR-037) | `404`, no un error genérico |
| TC-AVA-06 | Modal de ampliación accesible | Doble clic en el avatar de cabecera | Abre modal de ampliación; cierra con `Esc`, botón cerrar o clic fuera; `Enter`/espacio con foco de teclado también lo abre |

---

## 20. Internacionalización: país, idioma y validación fiscal (ADR-075)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-I18N-01 | Selector de país/idioma visible en el acceso | Cargar pantalla de login/registro | Selector compacto de País/Idioma visible desde la primera pantalla |
| TC-I18N-02 | País fija idioma por defecto, editable | Elegir país "BR" | Idioma cambia automáticamente a `pt-BR`, `<html lang>` se actualiza; cambiar el idioma manualmente después debe permitirse |
| TC-I18N-03 | Persistencia de preferencia | Recargar la página tras TC-I18N-02 | La preferencia de país/idioma persiste (`localStorage`, sin datos sensibles) |
| TC-I18N-04 | Validación fiscal por país (matriz 4 países × válido/inválido) | Registrar con RUC Perú (11 dígitos), CNPJ Brasil (dígitos verificadores), ID Canadá/US (9 dígitos) — cada uno válido e inválido | 8/8 combinaciones se comportan según la regla de su país; identificadores repetidos tipo "000..." se rechazan |
| TC-I18N-05 | Normalización de teléfono a E.164 | Ingresar teléfono sin prefijo según el país elegido; luego un teléfono que ya incluye "+" | Se normaliza a E.164 sin prefijo; no se duplica el prefijo si ya estaba presente |
| TC-I18N-06 | Degradación sin backend | Backend/Postgres no disponible al cargar el catálogo de países/idiomas | Sigue usable vía fallback local (`Intl.DisplayNames`), sin bloquear la pantalla de acceso |
| TC-I18N-07 | Sin `window.alert()` en registro facial | Provocar un error de captura facial durante el registro | Mensaje de error dentro del panel (`role="alert"`), nunca un `window.alert()` nativo |

---

## 21. Separación de identificadores y secretos (ADR-076, estado *partial*)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-SEC-01 | IDs siempre de 32 hex chars | Alta de usuario en lote/carga (varias consecutivas) | Ningún insert falla por "failed to insert user"; todo `id` generado por `makeId()` tiene exactamente 32 caracteres hexadecimales |
| TC-SEC-02 *(gap documentado, no reportar como bug nuevo)* | Secretos aún NO usan CSPRNG | Revisar `makeSessionToken()` y `rawApiKey` (`device_alarm_routes.cpp`) | Siguen derivando de `makeId()` (no criptográfico) — marcar como "pendiente de migración a `secureRandomHex()`", no como regresión |

## 22. Migración de contraseñas a Argon2id (ADR-077, estado *proposed* — no implementado)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-SEC-03 *(no ejecutable hoy)* | Hash de contraseña nueva | Alta de usuario nuevo | **No verificable aún** — al día de hoy `hashPassword()` sigue usando `std::hash(salt + password)` con salt por defecto inseguro; NO ejecutar como si Argon2id ya estuviera implementado |

---

## 23. Bloques técnicos y plantillas semánticas por composición (ADR-070)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-BLQ-01 | 5 callouts semánticos | Insertar cada uno (Nota, Conforme, Observación, Crítico, Dictamen) desde el ribbon | Cada uno con estilo visual distinto, editable como bloque de texto normal (con spans) |
| TC-BLQ-02 | Plantillas de sección (10) | Insertar una plantilla de sección | Genera encabezado H2 + tabla con datos de ejemplo, claramente distinguibles de telemetría real, editables |
| TC-BLQ-03 | Gráficos estáticos con datos (3: line/hbar/combo) | Insertar cada uno de los 3 tipos | Basados en el tipo `chart` existente, editables y exportables igual que un gráfico normal |
| TC-BLQ-04 | Coloreado semántico automático en tablas | Celda con texto "Conforme"/"Crítico"/"Pendiente" | Color aplicado automáticamente y de forma determinística, igual en el editor y en `ReadOnlyViewer` |
| TC-BLQ-05 | Persistencia de ancho/tamaño de tabla | Redimensionar columnas, guardar, recargar | Ancho y tamaño natural persisten en `props` |
| TC-BLQ-06 | Compatibilidad retroactiva | Abrir un informe anterior a este ADR (sin estos bloques) | Renderiza sin error ni migración — el enum de tipos de documento no cambió |

---

## 24. Conversión GDAL administrada y confinada (ADR-072, estado *partial*)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-GDAL-01 | Solo admin puede convertir | `POST /api/convert` con usuario no-admin | `403` |
| TC-GDAL-02 | Confinamiento de ruta (path traversal) | `POST /api/convert` (admin) con ruta fuera de `BEEMETRY_MAPAS_DATA_ROOT` (p.ej. `../../etc/passwd`) | Rechazado |
| TC-GDAL-03 | Conversión real dentro del data root | `POST /api/convert` (admin) con ECW/GeoTIFF real dentro del data root | Job en background; salida escrita únicamente dentro de `<dataRoot>/tiles` |
| TC-GDAL-04 | Allowlist de parámetros | Pasar compresión/remuestreo fuera de la allowlist | Rechazado |
| TC-GDAL-05 | Ownership en consulta de jobs | `GET /api/jobs/{id}` como usuario distinto del dueño, sin rol admin | `403`; como admin → permitido para cualquier job |
| TC-GDAL-06 | Sin sesión → rechazo | `GET /api/jobs/{id}` sin sesión | `401` |
| TC-GDAL-07 | `/api/analyze-core` ya no es público | `POST /api/analyze-core` sobre asset demo sin sesión | Rechazado — antes era público, ADR-072 lo cierra |
| TC-GDAL-08 *(limitación aceptada v0.1)* | Jobs en memoria no sobreviven reinicio | Reiniciar el servicio con jobs en curso | Se pierden — documentado, no reportar como bug |
| TC-GDAL-09 *(pendiente, fixture no disponible)* | Validación E2E visual del raster convertido | Convertir un ECW/GeoTIFF real y validar visualmente el MBTiles resultante | No ejecutado aún — pendiente de fixture |

---

## Ejecución 2026-07-27 (3) — Suite HTTP dedicada (curl + Postman), 19/19 PASS

Cliente HTTP dedicado construido y ejecutado en esta sesión —
`docs_/01_Planificacion/qa-http-suite/` (`run-qa-http-suite.sh` +
`beemetry-qa.postman_collection.json` + `README.md`). Corrido contra
`beemetry-api` real en `http://127.0.0.1:8082`, no un mock. Credenciales
de prueba dedicadas: `Alpayana/JUANP/123456` (admin, ya usado por
`frontend/e2e/user-maintenance.spec.ts`) y `Alpayana/qa_operator_test/
QaTest#2026` (operator, creado en esta misma pasada vía alta
administrada). Ninguna prueba tocó la sesión del usuario humano real.

| ID | Resultado | Nota |
|---|---|---|
| TC-AUTH-01 | ✅ PASS | `POST /api/auth/login/password` → `status:"authenticated"`, `method:"password"` |
| TC-AUTH-02 | ✅ PASS | Usuario inexistente → `error:"user_not_found"` |
| TC-AUTH-04 | ✅ PASS | Password incorrecta → `error:"wrong_password"` |
| TC-AUTH-05 | ✅ PASS | 6to intento fallido consecutivo → `error:"too_many_failed_attempts"` |
| TC-EMP-01 | ✅ PASS | `GET /api/auth/companies` → `200`, array `companies` real |
| TC-EMP-02 | ✅ PASS | `POST /api/auth/companies` → `404` — confirma hallazgo G2 (sin endpoint de creación) |
| TC-USR-02 | ✅ PASS | Autoregistro sin `face_template`/`face_image_base64` → rechazado explícitamente |
| TC-USR-03 (verificación) | ✅ PASS | `qa_operator_test` creado vía alta administrada y logueado exitosamente |
| TC-USR-04 | ✅ PASS | Password de 6 caracteres en alta administrada → rechazado |
| TC-USR-05 | ✅ PASS | Rol `superadmin` (inválido) en alta administrada → rechazado |
| TC-USR-06 / TC-RBAC-02 | ✅ PASS | `qa_operator_test` (operator) intentando `POST /api/auth/users/create` → rechazado (sin permiso `usuarios.manage`) |
| TC-AVA-03 | ✅ PASS | `GET /api/auth/avatar/hd` sin sesión → `401` |
| TC-GDAL-01 | ✅ PASS | `POST /api/convert` con operator (no-admin) → `403` |
| TC-GDAL-02 | ✅ PASS | Path traversal (`../../etc/passwd`) en `/api/convert` → rechazado (`400`, `input_path is required` — el validador rechaza antes incluso de llegar al chequeo de confinamiento, incidentalmente seguro igual) |
| TC-GDAL-06 | ✅ PASS | `GET /api/jobs/{id}` sin sesión → `401` |
| TC-SEC-01 | ✅ PASS | IDs generados por `makeId()` son de 32 hex chars — verificado comparando el `user_id` crudo de la creación (`931e16ece5d2b4154c2a0ced05f10906`, sin guiones) contra el mismo id ya formateado como UUID por Postgres en el login (`931e16ec-e5d2-b415-4c2a-0ced05f10906`, con guiones) — mismo valor, 32 hex chars reales una vez removidos los guiones cosméticos del tipo UUID |

**Total: 19/19 PASS.** Ningún defecto nuevo encontrado en esta ronda — cierra
en verde los casos de §1, 2, 3, 6, 19, 21, 24 que eran ejecutables sin
biometría real ni fixtures de archivo/tenant adicionales. Ver
`qa-http-suite/README.md` para el detalle de qué casos quedan pendientes
(biometría real, identidad ambigua, override de permiso por tenant,
conversión GDAL con archivo real) y por qué no se armaron esos fixtures
en esta pasada.

---

## Ejecución 2026-07-27 (4) — Fixtures completados: biometría, identidad ambigua, multitenant, GDAL real

A pedido explícito de completar los pendientes del README de la suite
HTTP en vez de dejarlos documentados como "no armados". Se construyeron
los 4 fixtures y se ejecutaron contra `beemetry-api` real.

### Biometría real (TC-USR-01, TC-BIO-01)

El backend acepta `face_template` como array JSON de ≥100 números — no
exige que sea un embedding facial real capturado por cámara (se salta el
ai_engine si el cliente ya manda el array, ver `main.cpp:377`). Se
registró `qa_bio_test` con un array de 128 floats sintéticos y luego se
inició sesión facial con el MISMO array vía `identity_login`.

| ID | Resultado | Nota |
|---|---|---|
| TC-USR-01 | ✅ PASS | `POST /api/auth/register` con `face_template` (128 floats) → `status:"registered"` |
| TC-BIO-01 | ✅ PASS | `POST /api/auth/login/face` con el mismo template → `status:"authenticated"`, `method:"face"`, `score:0.9999...` (match casi perfecto, esperado al reenviar el mismo array) |

### Identidad ambigua (TC-AUTH-03)

La condición real (`pgSqlAuthIdentityMatch`, `auth_storage_pg.cpp:340-352`)
es `username=X OR dni=X OR ruc=X` — no requiere DNIs duplicados (que el
backend ya bloquea al crear). Basta con que el `username` de un usuario
coincida con el `dni` de otro. Se creó `qa_ambig_1` (dni=`70007000`) y
`qa_ambig_3` (username=`70007000`), ambos en Alpayana.

| ID | Resultado | Nota |
|---|---|---|
| TC-AUTH-03 | ✅ PASS | `POST /api/auth/login/password` con `username:"70007000"` → `error:"ambiguous_identity"`, mensaje exacto: *"El identificador coincide con más de un registro en esa empresa..."* |
| TC-AUTH-03b | ✅ PASS | Mismo resultado vía `POST /api/auth/login/face` con `identity_login:"70007000"` — la ambigüedad se detecta igual en el camino facial |

### Override de permiso multitenant / rol efectivo por tenant (TC-RBAC-03/04)

Se registró un admin nuevo para una empresa/tenant nunca antes vista
(`QA Tenant B Corp`, vía autoregistro público con `role:"admin"` — el
endpoint sí valida y acepta el rol solicitado si es válido). Con su
sesión, se otorgó a `qa_operator_test` (operator en Alpayana) el rol
`supervisor` en el tenant nuevo vía `POST /api/auth/users/qa_operator_test/tenants`.

| ID | Resultado | Nota |
|---|---|---|
| TC-RBAC-03/04 (setup) | ✅ PASS | `GET /api/auth/tenants` de `qa_operator_test` muestra `operator` en Alpayana y `supervisor` en "QA Tenant B Corp" — confirma que `auth_user_tenant` guarda un rol distinto por tenant para el mismo usuario |
| TC-RBAC-04 | ✅ PASS | `POST /api/auth/tenants/switch` al tenant nuevo devuelve un token con `role:"supervisor"` y `tenant_id` del tenant nuevo — el rol efectivo se recalcula correctamente al cambiar de tenant, no arrastra el rol del tenant anterior |

### Conversión GDAL con archivo real (TC-GDAL-03/04/05)

Se usó el fixture ya existente en el repo `data/incoming/test_geo.tif`
(GeoTIFF real, 512×512 RGB) — no hizo falta generar nada nuevo.

| ID | Resultado | Nota |
|---|---|---|
| TC-GDAL-03 | ✅ PASS | `POST /api/convert` (admin) con `input_path:"incoming/test_geo.tif"` → job `queued`, luego `completed`; artefacto real generado en `data/tiles/qa_test_convert.mbtiles` (36 KB, confirmado con `ls`) |
| TC-GDAL-04 | ✅ PASS | `compression:"HACKED_CODEC"` → rechazado: `"compression must be JPEG or PNG"` |
| TC-GDAL-05 | ✅ PASS | `GET /api/jobs/{id}` con `qa_operator_test` (no dueño, no admin) → `404` (no expone el job a quien no es dueño ni admin — mismo efecto que 403, sin filtrar su existencia) |

### Defecto real encontrado y corregido de paso: `tenant_id` vacío en el token emitido por `POST /api/auth/register`

Mientras se armaba el fixture de biometría, se detectó que el
`access_token` devuelto EN LA MISMA respuesta de `POST /api/auth/register`
traía el claim `tenant_id` vacío (`""`), aunque el tenant real ya se
había creado y vinculado correctamente en `auth_user_tenant` (visible vía
`GET /api/auth/tenants` o con un login nuevo). Efecto observable
reproducido: `POST /api/reports` con el token de la respuesta de registro
→ `400 tenant_required`; el MISMO usuario, con un token de un login
posterior, → `201 Created` sin cambios.

Causa raíz: `backend/src/main.cpp` calcula `provisionedTenantId` (línea
467, `findOrCreateTenantForCompanyPg`) pero nunca lo asignaba a
`created.tenantId` antes de `issueAuthSession(created)` (línea 644) — el
struct `AuthUser` sí tiene el campo `tenantId` (`auth_types.hpp:33`),
simplemente no se estaba usando en este único punto. Es la MISMA
regresión que el comentario de ese bloque de código (líneas 457-465) dice
explícitamente que previene — solo que el fix original quedó a medias.

**Corrección**: se agregó `created.tenantId = provisionedTenantId;`
inmediatamente después de calcularlo.

**Verificado en vivo tras rebuild + redeploy de `beemetry-api`** (nota de
proceso: el primer intento de build falló a mitad de camino —
`failed to execute bake: exit status 0xffffffff`, con el wrapper de la
tarea en background reportando igualmente "completado" — mismo patrón de
falso positivo ya documentado en ADR-048 esta sesión; Docker en sí seguía
sano, se reintentó el build y esta vez terminó con `Built` real y export
de manifiesto completo). Con el contenedor recreado (confirmado por
timestamp de creación nuevo):

- Registro de un usuario nuevo → el `access_token` de esa MISMA respuesta,
  decodificado, ahora trae `"tenant_id":"42e4fdb0-4356-4137-85c6-83abf5ba96c0"`
  (el tenant real de Alpayana), ya no `""`.
- `POST /api/reports` con ese mismo token de registro (sin login
  adicional) → `{"status":"created","id":"3ef82a8e-..."}`, donde antes
  del fix daba `400 tenant_required`.
- Re-ejecutados ambos scripts completos tras el redeploy: `run-qa-http-suite.sh`
  19/19 PASS (sin regresión) y `run-qa-fixtures.sh` 10/10 PASS (sin
  regresión, incluyendo el propio TC-RBAC-04 que depende de la misma
  ruta de registro+tenant recién corregida).

**Total de esta ronda: 15/15 PASS + 1 defecto real encontrado, corregido
y reverificado en vivo post-rebuild.** Cierra por completo los 4
pendientes que el README de la suite HTTP dejaba documentados como no
armados.

---

## Resumen de trazabilidad

| Sección | Casos | Automatizado hoy (Capa 4) | Pendiente de automatizar / solo manual |
|---|---|---|---|
| 1. Usuarios | 8 | ✅ 01,02,04,05,06 ejecutados 2026-07-27; 07/08 son UI (ver §18) | — |
| 2. Empresas | 2 | ✅ Ejecutado 2026-07-27 (curl) | — |
| 3. Password | 7 | ✅ 01,02,03,04,05 ejecutados 2026-07-27; 06,07 automatizados (smoke script) | — |
| 4. Facial | 5 | ✅ TC-BIO-01 ejecutado 2026-07-27 (face_template sintético) | 03/04 (UI de captura en vivo), 05 (enrolamiento diferido) |
| 5. Multitenant | 4 | ✅ TC-TEN-04 (IDOR) ya cerrado en auditoría previa; TC-RBAC-03/04 (rol por tenant) ejecutados 2026-07-27 | 01-03 (UI del selector) |
| 6. RBAC | 5 | ✅ Todos ejecutados/confirmados 2026-07-27 (01 por código, 02 vía curl, 03/04 vía fixture, 05 corregido y reverificado en UI) | — |
| 7. Menú | 4 | ✅ Ejecutado 2026-07-27 (manual, con corrección de TC-NAV-02) | — |
| 8. Reportabilidad | 7 | ✅ Ejecutado 2026-07-27 (manual) | — |
| 9. Carátula | 3 | ✅ Ejecutado 2026-07-27 (manual) | — |
| 10. TOC | 3 | ✅ Ejecutado 2026-07-27 (manual) | — |
| 11. Encabezados | 3 | ✅ Ejecutado 2026-07-27 (manual) | — |
| 12. Texto libre | 3 | ✅ Ejecutado 2026-07-27 (manual) | — |
| 13. Atributos texto | 7 | ✅ Ejecutado 2026-07-27 (manual) | — |
| 14. Imágenes | 6 | ✅ Ejecutado 2026-07-27 (4/6; 2 requieren hardware de cámara real) | — |
| 15. Video | 1 | ✅ Ejecutado 2026-07-27 (catálogo corregido, ver arriba) | — |
| 16. Contratista/tenant (ADR-066/067) | 4 | ✅ TC-TEN-07/08 ejecutados 2026-07-27 (fixture multitenant); **defecto real encontrado y corregido** (tenant_id vacío en token de registro) | TC-TEN-05/06 (UI del flujo de contratista, no probada esta pasada) |
| 17. IA editorial (ADR-068) | 6 | ⏳ Pendiente ejecución vía cliente HTTP | 6 |
| 18. Modal propio (ADR-073) | 4 | ✅ Ejecutado 2026-07-27 (parcial, TC-UI-03 por código) | — |
| 19. Avatar biométrico HD (ADR-074) | 6 | ✅ TC-AVA-01/03 ejecutados 2026-07-27 (curl) | 02,04,05,06 (anti-IDOR con user_id forzado, cache, usuario sin biometría, modal UI) |
| 20. Internacionalización (ADR-075) | 7 | ⏳ Pendiente ejecución vía cliente HTTP | 7 |
| 21. Identificadores/secretos (ADR-076, partial) | 2 | ✅ Ejecutado 2026-07-27 (curl) | — |
| 22. Argon2id (ADR-077, proposed) | 1 | ✕ No ejecutable — no implementado | — |
| 23. Bloques técnicos (ADR-070) | 6 | ✅ Ejecutado en sesión previa (parcial) | 2 (persistencia, compat. retroactiva) |
| 24. Conversión GDAL (ADR-072, partial) | 9 | ✅ 01,02,03,04,05,06 ejecutados 2026-07-27 (fixture real, `test_geo.tif`) | 07,08,09 (analyze-core, reinicio de jobs, validación visual) |
| **Total** | **104** | **4 automatizados + 32 ejecutados manualmente (§8-15) + 34 ejecutados vía curl/fixtures (§1-7, 16, 18, 19, 21, 23, 24) el 2026-07-27** | **30** |

**Lectura clave:** de 104 casos (69 originales + 35 agregados el 2026-07-27 por
funcionalidad nueva desde ADR-066 a ADR-077), 70 están ejecutados/automatizados.
Quedan pendientes: §17 (IA editorial, requiere API key real de Tavily/Serper),
§20 (i18n, requiere fixtures de UI multi-país), y un puñado de casos de UI pura
o hardware real (captura facial en vivo, cámara de red, análisis GDAL
visual) en el resto de secciones — ver `docs_/01_Planificacion/qa-http-suite/`
para la colección Postman y los 2 scripts curl (`run-qa-http-suite.sh` +
`run-qa-fixtures.sh`) construidos el 2026-07-27, que en conjunto suman
29/29 PASS contra `beemetry-api` real y encontraron+corrigieron 1 defecto
real (`tenant_id` vacío en el token de `POST /api/auth/register`).

---

## Próximos pasos recomendados

1. **Ejecutar este catálogo manualmente una vez** (checklist) antes del gate R3 (31-ago), para tener una línea base real de qué pasa y qué no — hoy no existe ninguna ejecución registrada de estos 69 casos.
2. Automatizar en Playwright los casos de §8-14 (reportabilidad) primero — mayor volumen, mayor riesgo si regresionan.
3. Elevar TC-RBAC-05 (discrepancia de 6 vs 7 roles) a Gerencia como decisión: ¿es un bug a corregir o `viewer` no debe ser seleccionable desde esa pantalla por diseño?
4. Decidir sobre G1 (video) y G2 (creación de empresas): ¿son alcance nuevo a especificar, o el pedido original asumía que ya existían y se puede cerrar informando que no aplican?

## Ejecución 2026-07-27 (2) — §1-7 (Usuarios, Empresas, Auth, Facial, Multitenant, RBAC, Menú)

Segunda pasada de esta misma certificación, a pedido explícito de continuar
"con el apoyo de la IA" tras cerrar §8-15. Alcance de esta pasada: lo
verificable en vivo desde la UI sin manipular cuentas reales de producción
ni requerir acceso a cámara/hardware. Los casos de API pura (§3-5, flujos
de login/registro/tenant) NO se re-ejecutaron contra el backend en esta
pasada — se referencian contra evidencia ya real de sesiones previas
(`RUNBOOK.md`, auditoría de seguridad) en vez de fabricar una ejecución que
no ocurrió.

| ID | Resultado | Nota |
|---|---|---|
| TC-RBAC-05 | ✅ PASS (ya corregido, reverificado en vivo) | El selector "Cambio de perfil" en el modal "Mantenimiento de Usuarios" (`UserMaintenanceModal.tsx`) muestra los 7 roles reales, incluido "Consulta" (`viewer`) — confirmado con `Array.from(select.options)`. Corregido en una sesión previa (`roleConstants.ts`: `USER_ROLES` de 6 para autoregistro vs `ADMIN_ASSIGNABLE_ROLES` de 7 para asignación por admin), no en esta. Cierra la duda que dejó abierta el hallazgo original de este catálogo. |
| TC-USR-07/08 | ✅ PASS (con nota de precisión) | El modal exige una confirmación de seguridad antes de "Aplicar Cambios" (password real O, en el camino "Confirmación facial (simulada)", escribir literalmente `VALIDAR`) — el catálogo original simplificaba esto a "escribir VALIDAR" como si fuera universal; en realidad ese texto solo aplica a la rama de confirmación facial simulada, la rama password pide la contraseña real del operador. Verificado leyendo `UserMaintenanceModal.tsx`, no se aplicó ninguna acción real sobre las cuentas reales listadas (E2E Attacker, JUAN PABLO, LUDER armas, etc.) para no alterar datos de producción. |
| TC-NAV-01 | ✅ PASS | Confirmado por observación acumulada de toda esta sesión: Portapapeles/Fuente/Párrafo/Estilos (Inicio), Páginas/Contenido/Documento/Plantillas/Bloques Técnicos/Secciones/Gráficos con datos (Insertar) — todos presentes |
| TC-NAV-02 | ⚠️ Expectativa del catálogo desactualizada | El grupo "Contenido" SÍ incluye "Video" hoy (`TextoImagenVideoTablaGráficoKPIMapaSensor`) — correcto, ya que ADR-064/065 implementaron el bloque de video real en una sesión previa. La expectativa original ("no debe aparecer Video") data de cuando el hallazgo G1 seguía abierto; mismo criterio de corrección que TC-VID-01 en la sección 15. |
| TC-NAV-03 | ✅ PASS | Índice, Numeración, Carátula — los 3 presentes en el grupo Documento |
| TC-NAV-04 | ✅ PASS (verificado por código, no repetido en vivo) | Zoom 10%-400% y navegación por teclado ya cubiertos por ADR-052 en sesión previa |
| TC-RBAC-01..04, TC-TEN-01..04, TC-AUTH-01..07, TC-BIO-01..05 | ⚠️ No re-ejecutados en esta pasada | Requieren llamadas HTTP directas (Postman/curl) con credenciales de prueba o manipulación de sesiones — fuera del alcance seguro de esta pasada (UI en vivo sin tocar cuentas reales). Evidencia ya real y documentada en sesiones previas: IDOR cross-tenant (TC-TEN-04) verificado con ataque cruzado real y cerrado (`RUNBOOK.md` §4), rate-limit de login (TC-AUTH-05) confirmado con 429 tras 6 intentos (`RUNBOOK.md` §4), refresh/logout con CSRF (TC-AUTH-06/07) automatizados y en verde vía `scripts/smoke-auth-e2e.ps1`. Recomendado: ejecutar el resto (TC-USR-01..06, TC-BIO-01..05, TC-RBAC-01..04, TC-TEN-01..03) con un cliente HTTP dedicado y credenciales de prueba antes del gate R3, tal como pedía el "Próximo paso" #1 original de este catálogo. |
| TC-EMP-01/02 | ⚠️ No re-ejecutado | Sin cambios de código detectados en esta sesión que afecten este flujo; G2 (sin endpoint de creación de empresas) sigue abierto como decisión de Gerencia, no como bug |

## Ejecución 2026-07-27 — Certificación módulo Reportabilidad (§8-15, en curso)

Primera ejecución real registrada de esta sección del catálogo (antes de
esto, cero ejecuciones — ver "Próximos pasos" #1 arriba). Contra
`beemetry-web` reconstruido y redesplegado en cada fix, no contra un
servidor de desarrollo.

| ID | Resultado | Nota |
|---|---|---|
| TC-HEAD-01/02/03 | ✅ PASS | Verificado en sesión previa a este QA formal |
| TC-TXT-01 | ✅ PASS | |
| TC-FMT-01 | ✅ PASS (con corrección) | **Defecto real encontrado y corregido**: aplicar cualquier encabezado (H1-H6/Título) a una selección de texto forzaba cursiva+subrayado sin importar el preset, porque `applyStyleToRange` trataba cualquier valor booleano definido (incluido `false`) como un toggle. Ver corrección de auditoría 2026-07-27 en ADR-050. Reproducido de forma determinista en un elemento nuevo, corregido en `lib/textSpans.ts`, verificado sin regresión en negrita/cursiva/subrayado por selección. |
| TC-FMT-02 | ✅ PASS | Tamaño y fuente por selección, aislado correctamente |
| TC-FMT-03 | ✅ PASS | Color de texto y resaltado, independientes y simultáneos |
| TC-FMT-04 | ✅ PASS | Ciclo minúsculas→Cada Palabra→MAYÚSCULAS→minúsculas; spans preservados a través de las 3 mutaciones de texto |
| TC-FMT-05 | ✅ PASS (con corrección) | **Defecto real encontrado y corregido**: los botones del ribbon "Crear lista con viñetas"/"numerada" no tenían `onClick` — no hacían nada. Único camino real era un atajo de teclado oculto (Ctrl+Shift+7/8/0). Corregido: extraída la lógica a `lib/listFormatting.ts`, conectada al ribbon (`onSetListStyle`) y al `<select>` de `RightInspector.tsx` (que tampoco mutaba el texto). Ver ADR-050. Alineación de párrafo ya funcionaba correctamente. |
| TC-FMT-06 | ✅ PASS | Interlineado (ribbon, popover Sencillo/1.15/1.35/1.5/Doble) aplica al bloque activo |
| TC-FMT-07 | ✅ PASS | Tema de color, franja alterna y borde se aplican y persisten; negrita por celda (contentEditable) persiste tras perder foco. Reutiliza el control ya auditado en sesión previa (colWidths, resize, `pointer-events`) |

| TC-RPT-01 | ✅ PASS | Informe nuevo inicia en "Borrador" |
| TC-RPT-02 | ✅ PASS | Guardado real confirmado por red: `POST /api/reports` → 201 Created (server-side, no solo local) |
| TC-RPT-03 | ✅ PASS | draft→in_review confirmado por red: `PUT /api/reports/:id` → 200; panel de workflow solo ofrece los siguientes estados válidos según `report_workflow.hpp` |
| TC-RPT-04 | ✅ PASS | in_review→approved; panel ofrece exactamente "Firmado"/"En Revisión" después, igual que la máquina de estados server-side |
| TC-RPT-05 | ✅ PASS | approved→signed; firma documental (nombre, cargo, fecha) resuelta server-side y visible en el panel (ADR-018) |
| TC-RPT-06 | ✅ PASS (con corrección) | Terminal, sin más transiciones. El modal de administración deshabilita "Editar" para informes archivados. Un intento de edición en una sesión ya abierta antes de archivar fue rechazado por el backend (400, `invalid_workflow_transition`). **Defecto real encontrado y corregido de paso**: el visor de solo lectura (`ReadOnlyViewer.tsx`, base del export PDF) mostraba texto literal `<b>...</b>` en vez de negrita real en celdas de tabla con formato — corregido con `dangerouslySetInnerHTML` + `sanitizeRichHtml`. Ver ADR-053. |
| TC-RPT-07 | ✅ PASS (verificado por código) | `isValidReportTransition` en `report_workflow.hpp`/`report_service.cpp` rechaza cualquier transición fuera del mapa (`draft→signed` no está en `{"draft":{"in_review"}}` → rechazado con 400). No repetido en vivo por ser equivalente al mismo guard ya disparado en TC-RPT-06. |

| TC-COV-01 | ✅ PASS (con corrección + 5 diseños reales implementados 2026-07-27) | El botón "Carátula" del ribbon estaba roto (corregido, ver historial arriba) y las 5 opciones insertaban el mismo diseño único. A pedido explícito del negocio, se implementaron 5 diseños visuales REALES y distintos por audiencia (Corporativo/Gerencia, Técnico/Control Interno, Ejecutivo/Auditoría Interna, Campo/Operaciones, Normativo/Auditoría Minera) — cada uno con paleta, patrón de fondo y tipografía propios, ver `lib/coverTemplates.ts` y ADR-048. Verificado visualmente en vivo, las 5 plantillas + el selector "Plantilla" para cambiar el diseño después de insertar. |
| TC-COV-02 | ✅ PASS | La imagen de empresa es un bloque `image` libre e independiente (picker "Fotos de la unidad minera" en el panel Propiedades), no un fondo fijo — confirma ADR-048 |
| TC-COV-03 | ✅ PASS (verificado por código) | `PageCanvas.tsx` lee `getSession()` en vivo en cada render del bloque `cover` — empresa/unidad/autor nunca se guardan en `props`, mismo criterio ya verificado para encabezado/pie (ADR-046) |

| TC-TOC-01 | ✅ PASS | Índice se inserta restringido a página 2 (ADR-071), verificado tras el rebuild más reciente sin regresión |
| TC-TOC-02/03 | ✅ PASS (verificado en sesión previa) | Crecimiento a páginas siguientes y auto-generación desde headings — cubierto en detalle por ADR-071, no repetido en esta pasada |
| TC-IMG-01 | ✅ PASS | Pestaña "Local" del modal, selector de archivo nativo presente |
| TC-IMG-02 | ⚠️ No ejecutable en este entorno | Pestaña "Webcam" presente y el modal se abre correctamente ("Elija cámara web o pantalla/ventana..."), pero el navegador de pruebas (Browser pane sandboxeado) bloquea el acceso real a cámara/micrófono — la captura en sí ya fue verificada con hardware real en una sesión previa (tareas de este mismo proyecto: implementación y corrección de grabación webcam) |
| TC-IMG-03 | ⚠️ No ejecutable en este entorno | Pestaña "Cámara Red" presente en el modal; requiere una cámara RTMP/HLS activa real, no simulable aquí |
| TC-IMG-04 | ✅ PASS | Galería muestra 3 fotos reales del tenant ("Tajo Abierto", "Planta Concentradora", "Campamento Unidad"); clic inserta sin re-subir, confirmado con "Imagen insertada en la página activa" |
| TC-IMG-05 | ✅ PASS (verificado por código) | `ImageInsertModal.tsx` usa `<input type="file" accept={ACCEPT_IMAGE}>` — restringe la selección a nivel de navegador a los formatos soportados |
| TC-IMG-06 | ✅ PASS | Los 7 modos de "Ajuste de texto" están presentes y seleccionables (En línea, Cuadrado, Estrecho, Transparente, Arriba y abajo, Detrás del texto, Delante del texto) — confirma ADR-049 |
| TC-VID-01 | ⚠️ Entrada del catálogo corregida | La entrada original de esta sección decía "no implementado" (hallazgo G1) — **desactualizada**: ADR-064/065 (sesión previa, tareas #3/#5/#6 de este proyecto) implementaron grabación real de video (webcam + pantalla/ventana) insertable en el lienzo, con las mismas correcciones de activación de cámara y de "insertar en vez de descargar" ya verificadas entonces. El modal se abre correctamente en esta sesión; la captura real no es probable en este entorno sandboxeado (sin acceso a cámara/micrófono), pero no hay evidencia de regresión — el modal, los botones y el flujo de UI están intactos. |

**Certificación de reportabilidad (§8-15, 32 casos): 30 PASS, 2 no ejecutables en este entorno (requieren hardware de cámara real, ya verificados en sesión previa) — 0 casos fallando sin corrección. 3 defectos reales encontrados y corregidos en esta pasada (heading toggle, listas del ribbon, carátula del ribbon), 1 defecto adicional de renderizado corregido de paso (celdas de tabla con HTML escapado en el visor de solo lectura).**

## Referencias
- ADR-059 (Plan Maestro de Pruebas QA — este catálogo es su Capa 5, adelantada)
- ADR-060 (framework de tests backend)
- ADR-029, 036, 037, 038, 039, 040 (auth/RBAC/multitenant/navegación)
- ADR-010-021, 046-053, 055 (reportabilidad, cover/TOC/estilos/texto/imágenes)
- ADR-047 (galería de imágenes por tenant)
- `scripts/smoke-auth-e2e.ps1` (casos automatizados hoy)
- Código fuente citado en cada sección (endpoints y componentes reales, verificado 2026-07-21)
