# ADR-122 — Postulaciones de CV por WhatsApp: extracción y scoring con IA local

**Status**: implemented (pendiente de pruebas end-to-end contra WhatsApp
Business real y de aplicar `db_scripts/69_*.sql` a la base de datos en
ejecución -- ver "Estado de implementación").

## Actualización 2026-08-21: política de retención de postulaciones rechazadas

A pedido explícito del developer, se resuelve el pendiente que este ADR
dejaba abierto en "Consecuencias > Neutras" (política de retención/borrado
de postulaciones rechazadas): **se retiene indefinidamente por ahora, sin
purga automática**. Es una decisión explícita y revisable, no un default por
omisión -- si más adelante RRHH/legal fija un plazo concreto, corresponde
una actualización fechada de este mismo bloque (o un ADR de seguimiento) con
el plazo y el mecanismo de purga, no editar este texto. Hasta entonces,
`cv_submission`/`cv_candidate_profile` (`db_scripts/69`) no llevan ningún job
de expiración ni columna de fecha límite de retención -- el dato sensible
(nombre, edad, teléfono, dirección, pretensión salarial, historial laboral)
permanece en la base de datos sin límite de tiempo hasta nueva decisión.

**Fecha**: 2026-08-20

**Autores**: EC

**Ámbito**: soporte, ia, plataforma

**Relación**: extiende el bot de WhatsApp de ADR-112 y la categoría `rrhh` de
ADR-115 (que ya dejó `rrhh` como quinta categoría de soporte, pero sin ningún
flujo de documentos); reutiliza el presupuesto de VRAM de Ollama dimensionado
en ADR-118; responde directamente al precedente de ADR-121 (rechazo de IA
local para *generar* coordenadas GPS); usa como precedente de "escanear un
documento y extraer campos" a ADR-094 (lectura de DNI por cámara).

## Contexto

RRHH necesitaba que los postulantes a un puesto pudieran enviar su CV (Word o
PDF) directamente al bot de WhatsApp ya existente, y que el sistema: (1)
reenviara el CV por correo a RRHH, (2) extrajera con IA local todos los datos
relevantes del candidato (nombres, apellidos, teléfonos, WhatsApp, centro de
estudios, edad, residencia, pretensiones económicas, años de experiencia,
cargo al que postula, experiencia laboral con empresa y funciones, cursos de
capacitación, dominio de inglés lectura/escritura/conversación, y cualquier
otra información relevante), (3) calificara al candidato de 0 a 100 como
señal de triaje, y (4) guardara todo en base de datos, notificando a RRHH por
correo (con el CV adjunto) y por WhatsApp, además de un panel interno para
consultar candidatos.

Ninguna pieza de esto existía: el bot de WhatsApp no procesaba mensajes tipo
`document` en absoluto (`dispatchInboundMessages` solo distinguía `text` e
`interactive`); el backend nunca había enviado un correo con adjunto (el único
`sendEmail` existente, en `alarm_notifier.cpp`, arma un cuerpo RFC822
`text/plain` sin ninguna capacidad de MIME multipart); y no había extracción
de texto de PDF/Word en ningún punto del stack (`ai_engine` es 100%
visión por computador -- biometría facial y lectura de DNI -- sin ninguna
librería de parsing de documentos ofimáticos).

## Decisión

### Canal: solo WhatsApp, sub-flujo nuevo dentro de la categoría `rrhh`

Se descartó agregar un formulario web público separado (ver "Alternativas
descartadas"). El menú de RRHH (antes: directo al `COLLECTING` genérico de
nombre/empresa/consulta) gana un submenú (`sendRrhhSubmenu`,
`whatsapp_menu.cpp::kRrhhEnviarCv`/`kRrhhOtraConsulta`) que bifurca entre
"Enviar mi CV" (nuevo estado `RRHH_CV_UPLOAD`) y "Otra consulta" (el
`COLLECTING` de siempre, sin cambios). En `RRHH_CV_UPLOAD`, el motor del bot
(`whatsapp_bot_engine.cpp`) espera el *siguiente* mensaje como `type ==
"document"` -- cualquier otra cosa reprompt con instrucciones, nunca deja al
usuario sin respuesta (mismo principio ya aplicado en `finalizeCollectingFlow`
y documentado en ADR-115).

### Recepción del documento: parseo de webhook + descarga vía Graph API

`whatsapp_webhook_routes.cpp::dispatchInboundMessages` gana la rama
`type == "document"` (antes inexistente), extrayendo `document.id`/
`filename`/`mime_type` a los nuevos campos de `InboundWhatsappMessage`
(`whatsapp_bot_engine.hpp`). Un nuevo cliente, `whatsapp_media_client.hpp/.cpp`,
descarga el archivo real en dos pasos de la Graph API de Meta, reusando el
mismo bearer token que `whatsapp_client.cpp` ya usa para *enviar* mensajes
(una WABA, un token -- recibir media no es un permiso aparte): (1)
`GET /{version}/{media_id}` resuelve una URL firmada de corta duración + el
`file_size`/`mime_type` reales (nunca se confía en lo que reportó el webhook
sin volver a chequearlo); (2) `GET` a esa URL, con el mismo bearer token,
trae los bytes.

El tope de tamaño (`BEEMETRY_WHATSAPP_CV_MAX_BYTES`, default 10 MB --
`AppConfig::gWhatsappCvMaxBytes`) se aplica en **tres capas** en vez de una
sola, porque ninguna de las tres es, por sí sola, completamente confiable:
(a) contra el `file_size` reportado por la Graph API, *antes* de descargar
(evita gastar ancho de banda en un archivo que de todos modos se va a
rechazar); (b) contra los bytes reales ya descargados (`body_limit` de Beast,
por si el reporte de tamaño no fuera fiable); (c) de nuevo en `ai_engine`
(`CV_EXTRACT_MAX_BYTES`, defensa en profundidad). El tipo MIME (solo PDF,
`.docx`, y el legado `.doc`) se valida igual de dos veces: contra lo que
reportó el webhook (filtro temprano) y contra lo que confirma la Graph API
tras descargar (`isAllowedCvMimeType` en `whatsapp_bot_engine.cpp`).

### Extracción de texto: `ai_engine` (`/extract_cv_text`), sin LLM

Nueva ruta Flask `POST /extract_cv_text` en `ai_engine/eye_analyzer.py` (mismo
sidecar que ya sirve `/scan_document` para DNI, ADR-094), usando
`python-docx` para `.docx` y `pdfplumber` para `.pdf` (nuevas dependencias en
`requirements.txt`). Esta ruta **solo** convierte bytes a texto plano -- no
interpreta contenido, no llama a ningún LLM. La orquestación del prompt y la
validación de la respuesta se mantienen en el backend C++
(`cv_extraction_client.cpp`), por el mismo criterio que ya separa
`ai_engine_client.cpp` (habla solo con el sidecar Python) de
`text_spell_service.cpp`/`mining_chatbot_service.cpp` (hablan solo con
Ollama): mantener en un único lugar del backend la disciplina de
construcción de prompt, selección de modelo y validación de la respuesta,
en vez de una segunda implementación divergente de la misma orquestación en
Python.

### Extracción de campos + score: Ollama (`qwen2.5:7b`), con guardas anti-alucinación explícitas

`cv_extraction_client.cpp::extractCvFieldsWithOllama` llama a
`${BEEMETRY_OLLAMA_URL}/api/generate` con `format: "json"`, `temperature:
0.1` y el modelo `qwen2.5:7b` (`BEEMETRY_OLLAMA_CV_MODEL`) -- el de "máxima
capacidad" ya desplegado en este stack (ADR-118), preferido explícitamente
sobre `gemma2:2b` (el modelo del chat interactivo) porque una postulación no
es una tarea interactiva: la latencia importa menos que la fidelidad de la
extracción. El prompt instruye explícitamente **no inventar** ningún dato
(`null`/`[]` si el campo no aparece en el texto) y pide, en una sola llamada,
los campos exactos pedidos por RRHH más `score` (0-100) y `score_rationale`.

El `score` se define explícitamente, en el propio prompt y en la copy del
panel, como **señal de triaje para priorizar revisión humana, nunca una
decisión automática de contratar o descartar** -- ver "Consecuencias" para
por qué esta distinción es la pieza central de este ADR.

Antes de aceptar cualquier campo, dos validaciones (`extractCvFieldsWithOllama`):

1. **Estructural**: `score` debe ser un entero en `[0,100]`; si no, la
   respuesta entera se descarta (`ok=false`).
2. **Presencia contra el texto fuente** (`looksPresentInSource`): para
   `nombres`/`apellidos`/`cargo_postulado`, se verifica que la primera
   palabra del valor extraído aparezca (sin distinguir mayúsculas) en el
   texto que realmente se le dio al modelo. Si no aparece, el campo se anula
   y queda registrado en `cv_candidate_profile.extraction_warnings` -- nunca
   se confía en un campo string sin poder verificarlo contra la fuente. Es
   el mismo mecanismo, con el mismo espíritu, que
   `apa7ResponseLooksValid`/`containsSubstr` ya usa en
   `text_spell_service.cpp` para detectar si el LLM alteró un año o un
   título en vez de solo darle formato.

**Por qué esto no repite lo que ADR-121 rechazó**: ADR-121 descartó usar el
LLM local para *generar* coordenadas GPS a partir de una dirección --una
tarea puramente generativa, sin nada contra qué verificar el resultado, donde
"alucinar una ubicación" es indistinguible de acertarla hasta que alguien la
audita manualmente en el mapa. La extracción de campos de un CV es
**extractiva**: el LLM no inventa hechos nuevos, saca datos que ya están en
un texto que el propio pipeline le entregó, y ese mismo texto está disponible
para verificar (parcialmente, vía `looksPresentInSource`) lo que devolvió.
Es un riesgo distinto y menor, pero no cero -- de ahí las dos validaciones de
arriba, y por qué el score nunca se trata como una decisión autónoma.

### Ninguna postulación se pierde en silencio

Si la descarga, la extracción de texto o el scoring fallan en cualquier
punto, la postulación queda igual persistida (`cv_submission.status`
transita a `'extraction_failed'` en vez de abortar) y RRHH es notificado
igual, con un resumen que indica explícitamente "no se pudo procesar
automáticamente, revisar el archivo adjunto manualmente"
(`cvSummaryText` en `whatsapp_bot_engine.cpp`). Mismo principio de "nunca
fallar en silencio" que ya rige el resto de este bot (ADR-115: fallback de
línea por defecto ante `phone_number_id` desconocido; confirmación explícita
ante fallo de creación de ticket).

### Persistencia: dos tablas nuevas, mismo patrón que el resto del módulo `support`

`db_scripts/69_cv_postulaciones_rrhh.sql` agrega `cv_submission` (una fila
por documento recibido: archivo original en `bytea`, texto crudo, estado del
pipeline) y `cv_candidate_profile` (1:1, los campos extraídos + score +
`score_rationale` + `extraction_warnings`), siguiendo exactamente el patrón
de `support_storage_pg.cpp`/`db_scripts/59` (`gen_random_uuid()`,
`CHECK` para enums, `jsonb` para lo flexible, `COMMENT ON TABLE/COLUMN`). El
archivo se guarda como `bytea` en Postgres, no en un object store: no existe
ningún object storage en este stack, el volumen esperado (postulaciones) es
bajo, y el tope de 10 MB por archivo mantiene las filas dentro de un tamaño
razonable.

### Notificación a RRHH: correo con adjunto (nuevo) + WhatsApp (reutilizado) + panel (nuevo)

- **Correo**: `mining_iot::sendEmailWithAttachment` (nueva función pública en
  `alarm_notifier.hpp/.cpp`, junto al `sendEmail` de texto plano que ya
  existía para alarmas) construye un cuerpo `multipart/mixed` real (parte
  `text/plain` con el resumen + parte con el CV en base64,
  `Content-Disposition: attachment`) sobre el mismo transporte ya probado
  (`curl` en modo SMTP crudo vía `BEEMETRY_SMTP_HOST/PORT`, contra `mailpit`
  en desarrollo). El nombre de archivo, al venir de WhatsApp, es entrada NO
  confiable insertada en una cabecera MIME -- se sanitiza
  (`sanitizeMimeFilename`) antes de usarse, mismo tipo de riesgo de
  inyección de cabeceras que `isSafeEmail` ya mitiga para la dirección.
  Destino configurable vía `BEEMETRY_HR_CV_EMAIL_TO`.
- **WhatsApp**: se reutiliza sin código nuevo de envío el mecanismo que
  `finalizeCollectingFlow` ya usa para la categoría `rrhh`
  (`effectiveContactNumber("rrhh", cfg.gWhatsappRrhhToE164)` +
  `sendText`/`sendWhatsappTextMessage`).
- **Panel**: `GET /api/support/admin/candidates` (búsqueda/filtro paginado) y
  `GET /api/support/admin/candidates/{id}(/file)?` (detalle y descarga del
  CV original), nuevo archivo `cv_routes.cpp/.hpp`, con el mismo bloque de
  autorización que `handleSearchTickets` (sesión + `soporte.view`/
  `soporte.manage`, o `department == 'rrhh'`, ADR-115) -- sin permiso nuevo.
  Frontend: `CandidatesRrhhView.tsx`, calcado de `SupportAdminView.tsx`
  (mismo patrón de filtros + tabla paginada + detalle).

## Consecuencias

### Positivas
- RRHH obtiene un flujo de postulación de punta a punta sin que un humano
  tenga que leer manualmente cada CV para extraer los datos básicos --
  el score y el resumen le permiten priorizar revisión, no reemplazarla.
- El diseño reutiliza cinco patrones ya probados en el repo (motor de
  estados de WhatsApp, cliente multipart C++→Python, cliente Ollama con
  `format:"json"` + validación, endpoint de búsqueda con RBAC
  departamental, panel admin de lista+detalle) en vez de inventar
  arquitectura nueva -- minimiza el código genuinamente nuevo a lo que no
  tenía precedente: MIME multipart saliente, descarga de media de WhatsApp,
  y el prompt/validación de extracción de CV en sí.
- Ninguna postulación se pierde en silencio ante un fallo de IA -- el CV
  original y el aviso a RRHH siempre llegan, incluso si la extracción
  automática falla.
- Procesamiento 100% on-prem (`ai_engine` + Ollama local): ningún tercero ve
  el contenido del CV.

### Negativas / Trade-offs
- **Contención de VRAM (ADR-118)**: `qwen2.5:7b` (~5.5 GB) ya comparte el
  presupuesto de 8 GB de VRAM con `gemma2:2b` (~2.3 GB, chatbot) y
  `ai_engine` (~0.2-0.3 GB). Una extracción de CV que llegue mientras el chat
  está "caliente" con `gemma2:2b` puede forzar un intercambio de modelo,
  pagando la penalidad de recarga que ADR-118 midió en vivo (~12-17 s la
  primera vez tras inactividad). No es un problema nuevo -- `qwen2.5:7b` ya
  se cargaba/descargaba por la feature de APA7 -- pero suma un segundo
  consumidor ocasional del mismo modelo; si la contención real resulta
  significativa en producción, revisar `keep_alive`/capacidad de GPU.
- El chequeo de presencia anti-alucinación (`looksPresentInSource`) es
  deliberadamente simple (substring de la primera palabra) -- reduce falsos
  positivos de alucinación evidente, pero no garantiza que cada campo
  aceptado sea 100% fiel; sigue siendo responsabilidad de RRHH revisar el CV
  original antes de decidir, nunca confiar ciegamente en el score.
- El procesamiento (descarga + extracción ai_engine + generación Ollama)
  ocurre de forma síncrona dentro del mismo turno del webhook, igual que ya
  hace `IA_CHAT` con `handleChatMessage` -- para un CV largo con `qwen2.5:7b`
  esto puede tardar bastante más que un turno de chat típico. Se acepta el
  mismo riesgo que ya asume `IA_CHAT` (posible reintento de Meta ante un
  webhook lento) en vez de introducir una cola de trabajo asíncrona nueva;
  la deduplicación por `wa_message_id` (`isWaMessageAlreadyLoggedPg`) ya
  protege contra reprocesar un reintento como una segunda postulación.

### Neutras
- Queda pendiente, y se deja planteada aquí sin resolver en código, la
  política de retención/borrado de postulaciones rechazadas -- el dato es
  sensible (nombre, edad, teléfonos, dirección, pretensión salarial,
  historial laboral) y su tiempo de conservación es una decisión de negocio,
  no técnica.
- El contenido extraído de un CV (nombres, pretensiones económicas, etc.) no
  debe aparecer en logs de aplicación en texto plano más allá de un id/estado
  -- a diferencia del número de teléfono, que este bot sí loguea hoy con
  fines de depuración operativa. El código de este ADR respeta esa
  distinción (`std::cerr` en `whatsapp_bot_engine.cpp`/`cv_extraction_client.cpp`
  solo referencia `submission.id`/códigos de error, nunca campos extraídos).

## Alternativas descartadas

### Formulario web público en vez de (o adicional a) WhatsApp
Se descartó como canal único: el usuario final confirmó que el flujo debía
vivir en el chatbot de WhatsApp ya existente, que además ya tiene una
categoría `rrhh` de primera clase (ADR-115) con número de contacto
configurable. Un formulario web público habría sido una superficie de
autenticación/anti-spam completamente nueva (WhatsApp ya resuelve
"quién es el remitente" mediante el número de teléfono) sin reutilizar nada
del bot existente.

### Orquestar el prompt de Ollama desde Python (`ai_engine`) en vez de C++
Habría significado una segunda implementación de la plomería HTTP hacia
Ollama, divergente de la que ya mantienen `mining_chatbot_service.cpp` y
`text_spell_service.cpp`, y habría alejado la extracción de campos del lugar
donde ocurre su validación y persistencia. Se prefirió mantener `ai_engine`
acotado a lo que su nombre indica -- un sidecar de visión por computador y
extracción de texto plano -- y toda la orquestación de IA generativa en el
backend, donde ya vive.

### Tratar el score como filtro/gate automático (auto-descartar candidatos bajo un umbral)
Nunca se implementó ni se consideró seriamente: dado el precedente de
ADR-121 sobre el riesgo de que un LLM local produzca un resultado
incorrecto sin que nadie lo note, automatizar una decisión de descarte sobre
la carrera de una persona real habría sido inaceptable. El score es,
explícitamente, una señal de apoyo -- nunca una puerta.

## Estado de implementación (verificado contra el código, 2026-08-20)

- **Construido**: esquema (`db_scripts/69_cv_postulaciones_rrhh.sql`);
  extracción de texto (`ai_engine/eye_analyzer.py::extract_cv_text`,
  `requirements.txt` con `python-docx`/`pdfplumber`); cliente de extracción +
  scoring (`cv_extraction_client.hpp/.cpp`); persistencia
  (`cv_storage_pg.hpp/.cpp`); descarga de media de WhatsApp
  (`whatsapp_media_client.hpp/.cpp`); flujo completo del bot
  (`whatsapp_bot_engine.cpp`, estados `RRHH_MENU`/`RRHH_CV_UPLOAD`,
  `whatsapp_menu.hpp/.cpp` con cobertura Catch2 en
  `test_whatsapp_bot_menu.cpp`); correo con adjunto
  (`alarm_notifier.hpp/.cpp::sendEmailWithAttachment`); panel admin
  (`cv_routes.hpp/.cpp`, registrado en `main.cpp`); configuración nueva
  (`AppConfig::gAiEngineCvExtractTimeoutMs`/`gWhatsappCvMaxBytes`/`gHrCvEmailTo`).
- **Pendiente**: aplicar `db_scripts/69_*.sql` a mano contra la base de datos
  en ejecución (los scripts 29+ no se montan automáticamente en
  `docker-entrypoint-initdb.d/`, gap ya documentado del proyecto -- este
  script sí se agregó al mount de `docker-compose.yml` para instalaciones
  nuevas, pero una base ya corriendo necesita `psql -f
  db_scripts/69_cv_postulaciones_rrhh.sql`); prueba end-to-end contra un
  número real de WhatsApp Business (parseo de webhook real, descarga de
  media real, calidad de extracción de `pdfplumber` contra CVs reales con
  tablas/columnas); afinar `BEEMETRY_OLLAMA_CV_NUM_CTX`/timeouts con datos
  reales de longitud de CV en vez de los valores iniciales conservadores;
  frontend (`CandidatesRrhhView.tsx`, registro en `App.tsx`) -- ver commits
  asociados a este ADR para su estado específico.

## Referencias

- `db_scripts/69_cv_postulaciones_rrhh.sql`
- `ai_engine/eye_analyzer.py` (`/extract_cv_text`), `ai_engine/requirements.txt`
- `backend/src/support/cv_extraction_client.hpp/.cpp`
- `backend/src/support/cv_storage_pg.hpp/.cpp`
- `backend/src/support/cv_routes.hpp/.cpp`
- `backend/src/support/whatsapp_media_client.hpp/.cpp`
- `backend/src/support/whatsapp_bot_engine.cpp` (`RRHH_MENU`, `RRHH_CV_UPLOAD`,
  `processCvSubmission`, `cvSummaryText`)
- `backend/src/support/whatsapp_menu.hpp/.cpp` (`kRrhhEnviarCv`,
  `kRrhhOtraConsulta`, `resolveRrhhSubmenuChoice`)
- `backend/src/mining/alarm_notifier.hpp/.cpp` (`sendEmailWithAttachment`)
- `backend/src/config/app_config.hpp/.cpp`
- `frontend/src/components/ReportStudioV2/components/views/CandidatesRrhhView.tsx`
- ADR-112 (bot de WhatsApp), ADR-115 (categoría/departamento `rrhh`),
  ADR-118 (presupuesto de VRAM de Ollama), ADR-121 (rechazo de IA local para
  *generar* coordenadas -- distinción explícita con este ADR), ADR-094
  (precedente de "escanear documento, extraer campos" con DNI)
