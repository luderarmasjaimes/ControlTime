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

## 15. Insertado de videos — no implementado (ver hallazgo G1)

| ID | Caso de prueba | Pasos | Resultado esperado |
|---|---|---|---|
| TC-VID-01 *(verificación de ausencia, no funcional)* | Confirmar que no hay bloque de video | Abrir el grupo "Contenido" del ribbon | **Se espera que "Video" NO aparezca en la lista** — si apareciera, sería una regresión de alcance no documentada |

**Si Gerencia necesita esta funcionalidad**, es alcance nuevo (no cubierto por ningún ADR ni spec existente) — requiere su propio ADR de diseño (tipo de bloque, almacenamiento del archivo de video, reproducción en `ReadOnlyViewer`/export PDF) antes de poder estimarse.

---

## Resumen de trazabilidad

| Sección | Casos | Automatizado hoy (Capa 4) | Pendiente de automatizar / solo manual |
|---|---|---|---|
| 1. Usuarios | 8 | TC-USR-01 (parcial, vía smoke script) | 02-08 |
| 2. Empresas | 2 | — | Ambos (TC-EMP-02 es un hallazgo, no un test) |
| 3. Password | 7 | TC-AUTH-01, 06, 07 | 02-05 |
| 4. Facial | 5 | — | Todos (requiere plantilla facial real) |
| 5. Multitenant | 4 | — | Todos |
| 6. RBAC | 5 | — | Todos (TC-RBAC-05 es defecto a confirmar) |
| 7. Menú | 4 | — | Todos |
| 8. Reportabilidad | 7 | — | Todos |
| 9. Carátula | 3 | — | Todos |
| 10. TOC | 3 | — | Todos |
| 11. Encabezados | 3 | — | Todos |
| 12. Texto libre | 3 | — | Todos |
| 13. Atributos texto | 7 | — | Todos |
| 14. Imágenes | 6 | — | Todos |
| 15. Video | 1 | — | Hallazgo, no test funcional |
| **Total** | **69** | **4** | **65** |

**Lectura clave:** de 69 casos, solo 4 están automatizados hoy (todos en el módulo de autenticación, vía `scripts/smoke-auth-e2e.ps1`). Los 65 restantes son candidatos para Playwright (ya configurado en el repo, `frontend/e2e/`, ver ADR-059 Capa 3) — priorizar reportabilidad (§8-14, 32 casos) por ser el módulo más grande y ya al 100% de sus ADR propios.

---

## Próximos pasos recomendados

1. **Ejecutar este catálogo manualmente una vez** (checklist) antes del gate R3 (31-ago), para tener una línea base real de qué pasa y qué no — hoy no existe ninguna ejecución registrada de estos 69 casos.
2. Automatizar en Playwright los casos de §8-14 (reportabilidad) primero — mayor volumen, mayor riesgo si regresionan.
3. Elevar TC-RBAC-05 (discrepancia de 6 vs 7 roles) a Gerencia como decisión: ¿es un bug a corregir o `viewer` no debe ser seleccionable desde esa pantalla por diseño?
4. Decidir sobre G1 (video) y G2 (creación de empresas): ¿son alcance nuevo a especificar, o el pedido original asumía que ya existían y se puede cerrar informando que no aplican?

## Referencias
- ADR-059 (Plan Maestro de Pruebas QA — este catálogo es su Capa 5, adelantada)
- ADR-060 (framework de tests backend)
- ADR-029, 036, 037, 038, 039, 040 (auth/RBAC/multitenant/navegación)
- ADR-010-021, 046-053, 055 (reportabilidad, cover/TOC/estilos/texto/imágenes)
- ADR-047 (galería de imágenes por tenant)
- `scripts/smoke-auth-e2e.ps1` (casos automatizados hoy)
- Código fuente citado en cada sección (endpoints y componentes reales, verificado 2026-07-21)
