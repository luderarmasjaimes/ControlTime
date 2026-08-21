# ADR-117 — Canal del chatbot: HomeMinero (web) y preparación para MovilMinero (campo)

**Status**: partial *(actualizado 2026-08-21 — ver bloque de actualización
abajo: el backend ya lee/valida/persiste `channel`; sigue sin existir la app
MovilMinero)*. Texto original sin editar a continuación.

**Status original (2026-08-19)**: proposed (preparación de esquema); sin app
MovilMinero, sin parámetro `channel` todavía aceptado por el backend — ver
"Estado de implementación". Este ADR planifica, no promete una arquitectura
ya construida.

## Actualización 2026-08-21 (auditoría general del árbol de trabajo)

Verificado por grep directo sobre `backend/src/support/support_routes.cpp`
en el árbol de trabajo actual (sin commitear al momento de esta nota): el
handler de `POST /api/support/chat/message` ya lee `channel` del body
(default `"HomeMinero"` si no viene), lo valida contra
`{"HomeMinero", "MovilMinero"}` (`400 invalid_channel` si no coincide), y lo
pasa a `persistChatMessagePg(...)` tanto para el turno del usuario como para
la respuesta del asistente. El endpoint de búsqueda admin
(`filter.channel = qv("channel")`) también lo acepta como filtro. Es decir:
la sección "Estado de implementación" de más abajo, que decía "ningún handler
... lee, valida o persiste un campo `channel`", quedó desactualizada — ese
wiring ya se hizo (junto con el cierre de ADR-116, que era su prerequisito
declarado). Lo único que sigue sin existir, sin cambios respecto al texto
original, es la app MovilMinero en sí — la sección "Diferencias esperadas"
sigue siendo enteramente prospectiva. No se edita el resto del ADR original
por convención de este log (ver `docs/decisions/README.md`, sección
"Convención").

**Fecha**: 2026-08-19

**Autores**: EC

**Ámbito**: soporte

**Relación**: agrega la columna `channel` a `support_chat_message`, la tabla
introducida por ADR-116; no reemplaza ni modifica ningún canal existente.

## Contexto

El chatbot de soporte (widget web + IA, ADR-112/116) va a ser consumido por
más de una aplicación de la empresa: la plataforma web actual, cuyo nombre
interno es **"HomeMinero"**, y un futuro sistema de soporte en campo,
**"MovilMinero"** — pensado inicialmente como una app en un teléfono
inteligente convencional, con una migración posterior a un terminal
transportable de grado militar para trabajo de campo en condiciones
adversas (polvo, vibración, cobertura intermitente).

**MovilMinero no existe todavía como aplicación** — no hay repositorio, no
hay UI, no hay cronograma de esta sesión. Este ADR no construye esa app ni
compromete una fecha; su único alcance es dejar el backend preparado para
distinguir el canal de origen de cada mensaje cuando esa app exista, sin
tener que migrar el esquema de datos retroactivamente en ese momento.

## Decisión

### `channel` en el body de la API de chat, con default retrocompatible

`POST /api/support/chat/message` y `POST /api/support/chat/stream` aceptan un
campo opcional `channel` en el body (`"HomeMinero"` | `"MovilMinero"`).
Default `"HomeMinero"` si el campo no viene — así ningún cliente existente
(el widget web actual, que hoy no manda este campo) se rompe ni cambia de
comportamiento por este ADR. El valor se persiste en
`support_chat_message.channel` (`db_scripts/63`, ver ADR-116), con `CHECK
(channel IN ('HomeMinero', 'MovilMinero'))` — a diferencia del `intent` de la
misma tabla (sin restricción, ver ADR-116), aquí sí se restringe porque el
conjunto de canales válidos es una decisión de producto cerrada, no algo que
cambie con la misma frecuencia que los intents del chatbot.

El widget web actual (`SupportChatWidget.tsx`) siempre manda `"HomeMinero"`
explícitamente en vez de depender del default silencioso — un futuro tercer
canal que también omita el campo no debe confundirse retroactivamente con
HomeMinero por accidente de default.

### Diferencias esperadas HomeMinero vs. MovilMinero (esqueleto, no implementado)

Esta sección es deliberadamente prospectiva: documenta las diferencias que
se anticipan hoy para cuando exista la app MovilMinero, sin implementar
ninguna de ellas en este ADR. Sirve de punto de partida para el ADR que
formalice esa app cuando se construya, no como especificación cerrada.

- **Entrega de la respuesta**: HomeMinero usa streaming SSE
  (`POST /api/support/chat/stream`) con la pestaña del navegador abierta — el
  usuario ve la respuesta token a token en vivo. MovilMinero, como app móvil,
  probablemente no puede depender de mantener una conexión SSE abierta todo
  el tiempo (la app no siempre está en foreground, el sistema operativo puede
  suspenderla) — es candidato a necesitar notificaciones push para avisar que
  la respuesta está lista, en vez de (o además de) streaming en vivo.
- **Tamaño de payload**: una conexión de campo, con peor cobertura que una
  oficina u oficina de mina con WiFi, probablemente necesita límites de
  payload más chicos y/o compresión más agresiva que HomeMinero — no medido
  ni decidido todavía, señalado como pregunta abierta.
- **Modo offline-first**: el terminal "grado militar" mencionado por el
  usuario final sugiere una necesidad futura de cola de reintento (outbox)
  para mensajes enviados sin conectividad — mismo patrón conceptual que
  ADR-110 (operaciones de campo offline, `proposed`, sin aprobar) ya propuso
  para telemetría, pero **no** se decide ni se implementa acá: se señala
  como una decisión pendiente explícita para cuando exista la app, no como
  una promesa de este ADR.
- **Autenticación**: no evaluado en este ADR. HomeMinero usa la sesión JWT
  de la plataforma (ADR-029); si MovilMinero es una app separada, necesitará
  su propia decisión de identidad (¿misma sesión de plataforma, o un flujo de
  auth de app móvil independiente?) — fuera de alcance aquí.

## Estado de implementación (verificado contra el código, 2026-08-19)

- **Aplicado**: la columna `support_chat_message.channel` existe con su
  `CHECK` y su default (`db_scripts/63_support_web_chat_message.sql`, mismo
  archivo que introduce la tabla de ADR-116).
- **Pendiente, verificado por grep directo sobre
  `backend/src/main.cpp`/`mining_chatbot_service.cpp`/`support_routes.cpp` al
  escribir este ADR**: ningún handler de `POST /api/support/chat/message` o
  `/stream` lee, valida o persiste un campo `channel` del body — la columna
  existe en la tabla, pero nada la escribe todavía porque, como documenta
  ADR-116, la persistencia del chat web en sí (con o sin `channel`) sigue sin
  conectarse. Cerrar el wiring de ADR-116 es prerequisito de este ADR: no
  tiene sentido persistir `channel` antes de persistir el mensaje.
- **No existe**: la app MovilMinero, en ninguna forma (repositorio, mockup,
  especificación funcional). Nada de este ADR debe leerse como que esa app
  está en desarrollo activo — solo que el backend, cuando se construya la
  persistencia del chat web, quedará preparado para no requerir una migración
  de esquema el día que MovilMinero exista.

## Consecuencias

### Positivas
- Cuando se construya la persistencia de ADR-116, aceptar `channel` es un
  cambio incremental sobre esa misma migración, no un rework — el esquema ya
  está listo.
- El default retrocompatible garantiza que ningún cliente actual necesite
  cambiar para seguir funcionando exactamente igual.

### Negativas / Trade-offs
- Este ADR fija dos valores de canal (`HomeMinero`, `MovilMinero`) en un
  `CHECK` de base de datos antes de que exista una especificación funcional
  real de MovilMinero — si el diseño de esa app cambia de nombre o de forma
  sustancial antes de construirse, este `CHECK` necesitará una migración
  para ajustarse (costo aceptado a cambio de no dejar el campo sin ningún
  tipo de restricción).
- La sección "Diferencias esperadas" es explícitamente especulativa — un
  riesgo real es que quien lea este ADR en el futuro la confunda con
  decisiones ya tomadas. Se marcó cada punto como "no decidido"/"pregunta
  abierta" a propósito para mitigar esa lectura errónea.

### Neutras
- No se creó ningún ADR nuevo para "MovilMinero" como producto — cuando esa
  app se construya, corresponde su propio ADR (arquitectura de la app,
  autenticación, offline-first real) que referencie a este como el punto de
  partida del lado del backend, no que lo reemplace.

## Alternativas descartadas

### No agregar `channel` todavía, esperar a que exista MovilMinero
Habría evitado especular sobre una app que no existe, pero habría dejado
`support_chat_message` sin ese campo justo cuando ADR-116 la está creando —
agregarlo después habría significado una migración de esquema adicional más
el trabajo de backfill de las filas ya escritas sin canal. Se prefirió pagar
el costo pequeño de una columna con default ahora, dentro de la misma
migración que ya está en curso.

### Modelar `channel` como una tabla `chat_channel` separada en vez de un `CHECK` de dos valores
Habría sido más extensible (agregar un canal nuevo no requeriría migración de
esquema), pero es sobre-ingeniería para dos valores conocidos y una tercera
app que ni siquiera tiene especificación — se prefirió el `CHECK` simple,
mismo criterio de "no generalizar prematuramente" que ADR-114/116 ya
aplicaron en sus propias decisiones de esquema.

## Evidencia y referencias

- `db_scripts/63_support_web_chat_message.sql` (columna `channel`, `CHECK`,
  default `'HomeMinero'`)
- ADR-116 (`support_chat_message`, prerequisito de persistencia)
- ADR-110 (`operaciones-campo-offline-integracion-erp`, `proposed` —
  precedente conceptual de outbox/offline-first para telemetría, referenciado
  como patrón, no reutilizado directamente)
- ADR-029 (identidad de plataforma — autenticación de MovilMinero queda fuera
  de alcance de este ADR, ver "Diferencias esperadas")
