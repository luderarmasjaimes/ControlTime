# ADR-168 — SPEC-025 (Soporte/WhatsApp) aprobado al alcance contractual; cuenta SMS comercial pendiente

> **Actualización 2026-09-11 (segunda pasada, mismo día) — aclaración
> explícita del developer sobre el alcance de la aprobación.** Aprobar
> SPEC-025 al alcance contractual (punto 1 de la Decisión de abajo)
> significa que el ámbito **es necesario para el proyecto**, no que ya esté
> listo para operar con clientes reales. Queda **pendiente contratar el
> servicio de Meta (WhatsApp Business Cloud API) en una cuenta de tipo
> comercial** — sin eso, el bot de WhatsApp (ADR-112 a 118, 122, 129) sigue
> exactamente en el estado que esos mismos ADR ya documentaban: "verificado
> por build/tests, entrega real a un teléfono pendiente de credenciales de
> producción de Meta". Mismo patrón que la cuenta Twilio comercial del
> punto 2 original — decisión de compra/presupuesto de Gerencia, no de
> código: `BEEMETRY_WHATSAPP_PHONE_NUMBER_ID`, `_ACCESS_TOKEN` y
> `_BUSINESS_ACCOUNT_ID` (`.env.example`) ya están listos para recibir esas
> credenciales sin cambios de C++. Se agrega como tercer pendiente
> explícito, junto a la cuenta SMS comercial y la ejecución del pentest
> externo (ADR-169), como parte de la misma tanda de decisiones del corte
> gerencial del 2026-09-10.

**Status**: accepted (decisión de alcance/producto); cuentas comerciales de Meta WhatsApp Business y de SMS pendientes de contratar

**Fecha**: 2026-09-11

**Ámbito**: soporte, plataforma

**Relación**: formaliza en el registro canónico 9 ADR ya implementados sin
SPEC propio (ADR-112 a 118, 122, 129); actualiza ADR-137
(`envio-informes-notificaciones-multicanal`) en la parte de canal `sms`.

## Contexto

El ámbito `soporte` (bot de WhatsApp Business, chat web, RRHH, CV de
postulantes) acumuló 9 ADR completos e implementados
(`docs/decisions/112` a `118`, `122`, `129`) sin que existiera nunca un
SPEC-025 formal en `specs/` ni una fila en `specs/REGISTRY.md`/
`specs/BACKLOG.md` — señalado como brecha en varias auditorías previas
(informe del 2026-08-30, §8: "Soporte/WhatsApp sin SPEC ni sprint formal").
Sin SPEC ni aprobación contractual, este trabajo quedaba fuera de las
métricas de avance oficiales (`scripts/project-status-metrics.ps1`) pese a
representar código real, compilado y verificado.

Por separado, la verificación en vivo del canal `sms` de ADR-137 (corte
2026-09-02) ya había encontrado que el canal estaba "confirmado genuinamente
sin proveedor configurado". El developer confirma ahora la causa completa:
sí existe una cuenta de Twilio, pero es la **cuenta trial gratuita**
documentada en `.env.example` — con dos limitaciones reales que la hacen
inutilizable para la plataforma completa: (1) solo envía SMS a números
**previamente verificados** en la consola de Twilio (no sirve para
usuarios/clientes reales sin ese paso manual previo), y (2) antepone
automáticamente *"Sent from your Twilio trial account -"* a cada mensaje.

## Decisión

1. **Se aprueba SPEC-025 (Soporte/WhatsApp) al alcance contractual del
   proyecto.** Los 9 ADR que ya lo implementan (112-118, 122, 129) quedan
   formalizados en `specs/REGISTRY.md` y `specs/BACKLOG.md` bajo esa
   numeración — ver los cambios de este mismo commit. No se reabre ni se
   reevalúa el contenido técnico de ninguno de los 9 ADR: la decisión es de
   alcance/contrato, no de arquitectura.
2. **Se confirma como requisito de negocio, no técnico**: para que el canal
   `sms` de ADR-137 sirva a la plataforma completa (no solo a números de
   prueba verificados manualmente), se necesita contratar una **cuenta
   Twilio de uso comercial** (o un proveedor SMS equivalente) — no la cuenta
   trial actual. Esta es una decisión de compra/presupuesto que requiere
   acción de Gerencia (alta de cuenta, método de pago, número real
   comprado) — no algo que se resuelva con un cambio de configuración o de
   código; el cliente SMS (`backend/src/notify/sms_client.hpp`, ya citado en
   `.env.example`) ya está listo para apuntar a una cuenta comercial sin
   cambios de C++, mismo patrón que ADR-087/Chequea.
3. Sin la cuenta comercial, el canal `sms` de notificaciones multicanal
   sigue en el mismo estado que documentó ADR-137: disponible en código,
   sin proveedor productivo real.

## Consecuencias

- Cierra la brecha de trazabilidad de `specs/REGISTRY.md`/`BACKLOG.md` para
  el ámbito `soporte` — 9 ADR que ya contaban como trabajo real ahora suman
  a las métricas oficiales de avance.
- No cambia el avance de ejecución medido por
  `scripts/project-status-metrics.ps1` en esta misma pasada: SPEC-025 se
  agrega sin tareas normalizadas en `tasks.md` todavía (fuera de alcance de
  este ADR construir ese archivo); su aporte al % de avance queda pendiente
  de que alguien formalice sus criterios de aceptación como tareas.
- Deja explícitamente pendiente, como acción de Gerencia (no de este ADR ni
  del developer en solitario): contratar la cuenta Twilio comercial (o
  equivalente) antes de considerar el canal `sms` listo para producción.

## Alternativas descartadas

- **Diferir la aprobación de SPEC-025 hasta tener SMS comercial resuelto**:
  descartada — el alcance de Soporte/WhatsApp (chat, RRHH, CV) no depende
  del canal SMS de notificaciones (ADR-137 es un ADR distinto, de
  ámbito `reports`/`plataforma`); atarlos habría retrasado sin necesidad la
  formalización de 9 ADR ya funcionando.
- **Contratar la cuenta comercial de Twilio directamente en esta sesión**:
  descartada — requiere datos de pago y una decisión de presupuesto real,
  fuera del alcance de lo que se puede ejecutar sin intervención directa de
  Gerencia.

## Referencias

- ADR-112 a 118, 122, 129 (`docs/decisions/`, ámbito `soporte`)
- ADR-137 (`envio-informes-notificaciones-multicanal`), canal `sms`
- `backend/src/notify/sms_client.hpp`
- `.env.example` (`BEEMETRY_TWILIO_*`, nota sobre limitaciones de la cuenta trial)
- `specs/REGISTRY.md`, `specs/BACKLOG.md`
