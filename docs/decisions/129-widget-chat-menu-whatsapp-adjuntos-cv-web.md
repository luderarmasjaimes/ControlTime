# ADR-129 — Widget de chat: menú de WhatsApp real, adjuntos (docx/pptx/pdf/jpg/png), CV desde web, QR/OCR de imágenes

**Status**: implemented, verificado por build/tests (ver "Evidencia y referencias"); prueba end-to-end contra WhatsApp real pendiente de las mismas credenciales de producción de Meta que ya bloqueaban esa verificación en ADR-112/113.

**Fecha**: 2026-08-21

**Autores**: EC

**Ámbito**: soporte, ai_engine

**Relación**: extiende el widget de chat web (`SupportChatWidget.tsx`), el bot conversacional de WhatsApp (ADR-112/113/114), las postulaciones de CV por WhatsApp (ADR-122), la persistencia del chat web (ADR-116/117) y los adaptadores de plantillas de documento (ADR-070/083/112).

## Contexto

Pedido explícito de la sesión, en cuatro partes:

1. Los chips "Copiar al lienzo / Resumir / Ampliar / Ideas" aparecían bajo el
   saludo inicial del widget (antes de cualquier consulta real a la IA).
2. El botón "WhatsApp" del widget disparaba **un único mensaje de
   escalamiento genérico** de inmediato (`handleEscalateToWhatsapp`,
   `mining_chatbot_service.cpp`) y mostraba "Se notificó a un asesor humano"
   sin condición — mientras que el bot **real** de WhatsApp (ADR-112) ya
   tiene un menú de 9 opciones con sub-flujos de calificación. Se pidió que
   el widget mostrara ese mismo menú, y que el mensaje de "se notificó a un
   asesor humano" solo apareciera tras llegar a una opción que de verdad
   requiere contacto humano (comercial, reclamos, emergencia, hablar con un
   agente) — no en cualquier punto del flujo.
3. Ensanchar el campo de texto, habilitar dictado por voz, corrector
   ortográfico, y adjuntar archivos (docx/pptx/pdf/jpg/png, con alerta para
   cualquier otro tipo) en el input principal del chat.
4. Los adjuntos docx/pptx/pdf debían poder alimentar la evaluación de CV de
   RRHH (pipeline ya construido en ADR-122); las imágenes jpg/png debían
   poder usarse para "consultas a la IA" sobre su contenido (lectura de QR,
   extracción de texto) dentro de la misma conversación; y todo debía quedar
   en base de datos, consultable después desde una interfaz admin con RBAC
   y aislamiento por tenant.

Hallazgos clave al investigar antes de construir:

- `POST /api/support/tickets` ya existía **reservado explícitamente para
  este uso** ("creación directa, sin pasar por el bot de WhatsApp...
  reservado para uso futuro desde web", comentario original en
  `support_routes.cpp`) — no hizo falta un endpoint nuevo para crear
  tickets desde el menú del widget.
- `pyzbar` (QR/barras) y `pytesseract` (OCR) **ya eran dependencias
  instaladas** en `ai_engine` (usadas hoy solo por `dni_scan.py`, acotado al
  formato fijo del DNI peruano) — no hizo falta agregar ni libzbar ni
  tesseract-ocr al `Dockerfile.ai`, solo un endpoint nuevo, genérico, que
  las reutiliza.
- `/extract_cv_text` (ai_engine) soportaba Word/PDF pero no PowerPoint —
  `python-pptx` es una dependencia pura-Python (sin paquetes de sistema
  nuevos), de bajo riesgo agregar.
- `cv_submission` (ADR-122) estaba moldeada 100% al canal WhatsApp
  (`phone_e164`/`line_id` `NOT NULL`, sin `channel`/`user_id`) — mismo
  problema que ya había resuelto `support_ticket`/`support_chat_message` con
  una columna `channel`.

## Decisión

### El botón "WhatsApp" del widget abre un menú, no dispara un mensaje

`SupportChatWidget.tsx` gana un estado `waFlow` (`WaFlowState`) que
reemplaza la lista de mensajes mientras está activo — mismo patrón ya usado
por el asistente de documentos (`wizard`/`DocWizardPanel`). `WA_ROOT_MENU`
espeja las 9 opciones y el texto de `menuRootBodyText()`
(`whatsapp_menu.cpp`) para que la experiencia sea consistente entre
canales. Cada opción resuelve a una de cuatro acciones:

- `stay_chat` (Soporte técnico, Consultas a la IA): cierra el menú, sigue
  en la conversación con Ollama — no hay nada que registrar todavía.
- `doc_wizard` (Generación de documentos): cierra el menú y abre el
  asistente de plantillas ya existente.
- `rrhh_submenu` (Recursos Humanos): sub-flujo de dos opciones (Enviar CV /
  Otra consulta), igual que `sendRrhhSubmenu` en el bot real (ADR-122).
- `describe` (Comercial, Reclamos, Emergencia, Agenda, Hablar con agente):
  pide una descripción breve y llama a `POST /api/support/tickets`
  (`createSupportTicket`, ya existía) con la categoría/prioridad
  correspondiente.

**Solo** Comercial, Reclamos, Emergencia y Hablar-con-agente traen
`escalate: true` — al crear el ticket, esos cuatro además llaman a
`escalateSupportChatToWhatsapp()` (el mismo endpoint de un solo botón que
ya existía) y **solo entonces** se muestra "Se notificó a un asesor humano
por WhatsApp", con el código de seguimiento del ticket. Agenda y
RRHH-otra-consulta quedan registrados (visibles en el panel admin) pero sin
ese mensaje — exactamente el criterio pedido explícitamente en la sesión.

### Adjuntos: un endpoint genérico + dos pipelines especializados

`POST /api/support/chat/attachment` (nuevo, `support_routes.cpp`) acepta
docx/pptx/pdf/jpg/png (cuerpo binario crudo + `filename` en query string,
mismo patrón que `tenant_assets_routes.cpp::uploadLogo`), valida la
extensión contra una lista blanca server-side (nunca confía en el
Content-Type declarado por el cliente) y persiste en la tabla nueva
`support_chat_attachment` (`db_scripts/70`), escopada por
`tenant_id`/`user_id`/`conversation_id`. La descarga
(`GET .../attachment/{id}`) está restringida al `tenant_id` de la sesión
que pide (mismo criterio anti-IDOR que el resto de activos del tenant).

Dentro de ese mismo endpoint, si el archivo es jpg/png, se llama
**síncronamente** a un cliente nuevo (`image_analysis_client.cpp`) que
sube la imagen a un endpoint nuevo de ai_engine, `/analyze_image`
(`eye_analyzer.py`): `pyzbar` para QR/código de barras + `pytesseract`
(español+inglés) para texto visible. El resultado (`ocr_text`/`qr_codes`)
se guarda junto al adjunto y se devuelve en la respuesta; el frontend lo
incrusta como contexto en el siguiente prompt a Ollama (mismo patrón que
los chips Resumir/Ampliar/Ideas: el modelo de chat es de solo texto, así
que "ver" la imagen ocurre de forma determinística ANTES del prompt, no
dentro del LLM) — así el usuario puede "preguntar sobre la imagen" en la
misma conversación aunque el modelo nunca reciba los píxeles.

Para docx/pptx/pdf, el endpoint genérico solo persiste el archivo (no hay
"lectura" genérica útil sin saber para qué es el documento). El pipeline de
**evaluación de CV** es un flujo aparte y deliberado: `POST
/api/support/cv/submit` (nuevo), alcanzable solo desde el sub-paso
"Recursos Humanos → Enviar mi CV" del menú de WhatsApp del widget, reusa
100% del pipeline de ADR-122 (`extractCvTextFromAiEngine` +
`extractCvFieldsWithOllama` + `cv_candidate_profile`) con una función de
inserción nueva (`insertWebCvSubmissionPg`, `channel='web'`,
`phone_e164`/`line_id` NULL, `user_id` de la sesión — `db_scripts/71`
relaja el esquema de `cv_submission`, mismo criterio ya usado para
`support_ticket.channel`). Un adjunto docx/pptx/pdf del botón genérico
**no** se reinterpreta como CV — solo el sub-flujo RRHH dispara ese
pipeline, para no asumir que cualquier documento adjunto en un chat de
soporte es una postulación de empleo.

`/extract_cv_text` (ai_engine) gana un tercer parser, `_extract_cv_text_from_pptx`
(`python-pptx`, agregado a `requirements.txt`), para que un CV en
PowerPoint también se pueda extraer — mismo criterio de "solo texto plano,
sin interpretar" que los otros dos parsers.

### Todo queda en base de datos, con RBAC y aislamiento por tenant

- `support_chat_attachment` (adjuntos genéricos): panel admin nuevo,
  pestaña "Adjuntos" en `SupportAdminView.tsx`, mismo RBAC que "Mensajes de
  chat" (`soporte.view`/`soporte.manage`, `GET
  /api/support/admin/chat-attachments`). Muestra el texto detectado
  (OCR/QR) y un enlace de descarga que reusa el mismo endpoint gateado por
  tenant.
- `cv_submission`/`cv_candidate_profile` (CV desde web): **cero UI nueva**
  — el panel de candidatos RRHH existente (ADR-122, `GET
  /api/support/admin/candidates`) ya hace `LEFT JOIN` sin asumir
  `phone_e164` no nulo, así que las postulaciones web aparecen ahí
  automáticamente, con el mismo RBAC (`soporte.view`/`soporte.manage` o
  `department='rrhh'`).
- `support_ticket` (categorías con/sin escalamiento): reusa el panel de
  tickets existente sin cambios — ya tenía `channel='web'` desde ADR-112.

### Widget: más espacio, voz, corrector

El ancho del widget pasa de 340 a 420px y la barra de herramientas se
reparte en dos filas (iconos arriba, input a todo el ancho abajo) en vez de
competir por espacio en una sola fila con 6 controles — es lo que de
verdad "ensancha" el campo de texto, más que un cambio de `flex` aislado.
Dictado por voz reusa el componente `VoiceDictation` ya existente
(idéntico al que usa el asistente de documentos); el corrector reusa
`textCorrectQuick` (mismo backend LanguageTool que ya usa el asistente de
documentos) — ninguno de los dos es infraestructura nueva, solo se
conectaron al input principal del chat, que hasta ahora no los tenía.

### Saludo inicial sin chips de acción (correctivo, ya aplicado en esta misma sesión)

`SupportChatMessage` gana `isWelcome?: boolean`; el mensaje que arma
`startChat()` lo marca `true`, y la condición que muestra los chips
Copiar/Resumir/Ampliar/Ideas ahora exige `!m.isWelcome` además de ser el
último turno del asistente — antes aparecían también bajo el saludo, sin
que hubiera ninguna respuesta real de la IA que copiar/resumir/ampliar.

## Consecuencias

### Positivas

- El widget web y el bot de WhatsApp ahora comparten el mismo lenguaje de
  menú (mismas 9 opciones, mismo criterio de cuándo se notifica a un
  humano) sin duplicar la lógica de decisión del bot — el widget llama a
  los mismos endpoints REST (`/support/tickets`, `/support/whatsapp/escalate`)
  que ya existían para ese propósito.
- El pipeline de CV (extracción + scoring con IA local) se reusa al 100%
  entre WhatsApp y web — cero código de scoring duplicado.
- La lectura de imágenes (QR/OCR) resuelve la limitación real de que el
  modelo de chat (`gemma2:2b`) no es multimodal, sin necesitar instalar un
  modelo de visión nuevo: la extracción es determinística (pyzbar/tesseract,
  ya instalados) y se incrusta como texto, mismo patrón ya validado por los
  chips Resumir/Ampliar/Ideas.
- Nada queda "al aire": cada adjunto, cada CV, cada ticket con o sin
  escalamiento tiene su fila en Postgres, escopada por tenant, visible
  desde un panel admin con el mismo RBAC que el resto del módulo de
  soporte.

### Negativas / Trade-offs

- `escalateSupportChatToWhatsapp()` sigue notificando siempre al **mismo
  número por defecto** (`AppConfig::defaultWhatsappLine()`, ver nota
  "Neutras" de ADR-113) sin importar si la categoría fue Comercial,
  Reclamos, Emergencia o Hablar-con-agente — el widget no tiene selector de
  línea/área como si lo tiene el bot de WhatsApp multi-línea (ADR-113).
  Enrutar la notificación por categoría a números distintos (como sí hace
  `outcomeForFlow` dentro del bot) queda para una iteración futura si se
  necesita; el ticket en sí SÍ queda correctamente categorizado en la base
  de datos.
- Igual que ADR-112/122, no se pudo verificar la entrega real de la
  notificación de WhatsApp contra un teléfono de producción en este
  entorno (token/credenciales de prueba) — se verificó todo lo demás
  (build, tipos, flujo end-to-end de creación de ticket) contra software
  real.
- La detección de imagen (QR/OCR) es best-effort y puede fallar en fotos de
  baja calidad o ángulos difíciles — el prompt a la IA lo deja explícito
  ("puede tener errores") en vez de prometer una lectura perfecta.
- El adjunto genérico (botón principal del chat) para docx/pptx/pdf no
  dispara ningún análisis de contenido — se guarda y queda descargable,
  sin extracción de texto. Ampliarlo (p.ej. resumen automático de un PDF
  adjunto) queda fuera de este ADR.

### Neutras

- `cv_submission.mime_type` amplía su `CHECK` para aceptar PowerPoint —
  migración idempotente (`db_scripts/71`), no rompe filas existentes.
- El botón de adjuntar y el sub-flujo de CV de RRHH usan inputs de archivo
  independientes (`fileInputRef` del chat principal vs `cvInputRef` de
  `WaFlowPanel`) — evita que un archivo elegido para uno termine
  procesándose por el otro pipeline por error de referencia compartida.

## Alternativas descartadas

### Reimplementar la máquina de estados del bot de WhatsApp en el frontend

El bot real (`whatsapp_bot_engine.cpp`) tiene sub-flujos de calificación
genéricos con persistencia de estado por conversación en Postgres
(`whatsapp_conversation`). Replicar esa máquina de estados completa en
React para el widget habría duplicado lógica ya probada (664 aserciones,
ADR-112) sin necesidad: el widget ya tiene su propio historial de chat
persistente (`support_chat_message`, ADR-116) y una sesión autenticada —
alcanza con un flujo de UI más simple (`WaFlowState`, 4 pasos) que llama a
los mismos endpoints REST que expone el backend para "uso futuro desde
web", sin necesitar estado de conversación server-side propio para el
menú.

### Modelo de visión (LLaVA/similar) en vez de QR/OCR determinístico

Daría respuestas más ricas ("qué hay en la foto") a costa de instalar y
servir un modelo multimodal nuevo (VRAM, latencia, mantenimiento) en un
stack que ya corre `gemma2:2b`/`qwen2.5:7b` en la misma GPU compartida
(ADR-118). Se descartó por alcance y porque QR/OCR determinístico ya cubre
los dos casos de uso pedidos explícitamente (lectura de QR, extracción de
texto) sin ese costo.

### Que cualquier docx/pdf adjuntado se interprete siempre como CV

Más simple de implementar (un solo pipeline para todos los docx/pdf), pero
asumiría que todo documento adjuntado en un chat de soporte general es una
postulación de empleo — incorrecto para un ingeniero de una unidad minera
adjuntando un informe de sensores. Se optó por mantener el pipeline de CV
accesible solo desde el sub-flujo RRHH explícito.

## Evidencia y referencias

- Backend: `backend/src/support/support_routes.cpp` (`handleUploadChatAttachment`,
  `handleDownloadChatAttachment`, `handleSubmitWebCv`,
  `handleSearchChatAttachments`), `support_storage_pg.hpp/.cpp`
  (`ChatAttachmentRecord`, `saveChatAttachmentPg`, `getChatAttachmentPg`,
  `searchChatAttachmentsPg`), `cv_storage_pg.hpp/.cpp`
  (`insertWebCvSubmissionPg`), `image_analysis_client.hpp/.cpp` (nuevo,
  agregado a `backend/CMakeLists.txt`).
- ai_engine: `eye_analyzer.py` (`_extract_cv_text_from_pptx`,
  `/analyze_image`), `requirements.txt` (`python-pptx`).
- Frontend: `frontend/.../components/support/SupportChatWidget.tsx`
  (`WA_ROOT_MENU`, `WaFlowState`, `WaFlowPanel`, `handleAttachFile`,
  `handleRrhhCvFile`, `runMainSpellcheck`, `isWelcome`),
  `frontend/.../lib/api.ts` (`createSupportTicket`, `uploadChatAttachment`,
  `submitWebCv`, `searchSupportChatAttachments`),
  `frontend/.../components/views/SupportAdminView.tsx` (pestaña "Adjuntos").
- `db_scripts/70_support_chat_attachment.sql`,
  `db_scripts/71_cv_submission_web_channel.sql` — aplicados manualmente
  contra la instancia de Postgres de esta sesión (`beemetry-db`, ver
  memoria de proyecto sobre aplicación manual de scripts 30+).
- **Build de verificación (2026-08-21)**: `backend/Dockerfile.verify`
  (mismo criterio que ADR-112/113) — `beemetry_backend` y
  `beemetry_backend_tests` compilan limpio con los archivos nuevos/
  modificados; `ctest`: 100% tests passed. `ai_engine`: `docker compose
  build ai_engine` con `python-pptx` + endpoint `/analyze_image` nuevos.
  Frontend: `npm run type-check` sin errores nuevos (los 2 errores
  preexistentes en `GeocatminWorkbench.tsx` son de un archivo no tocado por
  este ADR).
