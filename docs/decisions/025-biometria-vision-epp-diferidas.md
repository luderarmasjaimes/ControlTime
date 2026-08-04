# ADR-025 — Biometría y visión EPP diferidas (restricción legal + hardening)

## Actualización 2026-07-24 — alcance reconciliado con el runtime

La redacción original mezclaba dos capacidades que hoy tienen estados
distintos. El **login facial ya está activo** y documentado por ADR-029,
ADR-037 y el plan QA ADR-059/061; por tanto, no puede describirse como
"capacidad latente". Lo que permanece diferido en v0.1 es la **visión de
seguridad EPP** (casco/chaleco) y cualquier ampliación de biometría sin base
legal, consentimiento, retención y minimización aprobados.

Esta actualización no convalida automáticamente el tratamiento legal del
login facial existente: su paso a producción sigue condicionado al gate
legal y de privacidad. La regla vigente es no ampliar ni reutilizar
plantillas faciales para otros fines sin esa aprobación.

**Status**: deferred, confirmado (verificado 2026-07-06: cero detección de EPP/casco/chaleco en `backend/src/biometric/` o `ai_engine/` — los módulos biométricos existentes solo sirven el login facial, no visión de seguridad)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: ia

## Contexto

El código incluye un módulo biométrico (`biometric/`, sidecar Python `ai_engine` con análisis facial: EPP, EAR, liveness) y un pipeline de visión (`vision/`). El SOW lo ubica en Etapa 2. Pero hay una restricción más fuerte que la técnica: **persistir datos biométricos exige validar requisitos legales de protección de datos sensibles por país** (Perú/LATAM). Almacenar biométricos sin base legal es un riesgo de cumplimiento, no solo de roadmap.

## Decisión

> **Texto histórico superseded por la actualización 2026-07-24.**
> Originalmente se decidió: la **biometría facial y la visión EPP se difieren
> a la versión más futura del producto**, gateadas por **validación legal**,
> no solo por hardening:

- En v0.1 **no se persiste ningún dato biométrico**. El login es usuario/contraseña + RBAC (ADR-029).
- El módulo biométrico y el sidecar `ai_engine` quedan como **capacidad latente** (código presente, función no activa); el sidecar Python sí corre para IA no-biométrica (ADR-004).
- Activar biometría requiere, como precondición: (a) base legal validada por país, (b) política de retención/consentimiento, (c) cifrado y minimización de datos sensibles.

### Reglas duras
- Prohibido persistir biométricos en producción sin base legal validada (se vuelve anti-patrón).
- La visión EPP (clasificadores, liveness) no entra en v0.1.
- La optimización "EAR/liveness a ONNX C++" (doc de optimización) queda ligada a esta activación futura, no es trabajo de v0.1.

## Consecuencias

### Positivas
- Evita exposición legal por manejo de datos sensibles sin base.
- Reduce alcance de v0.1 a lo realmente necesario para el usuario geotécnico.

### Negativas / Trade-offs
- Se posterga una capacidad ya parcialmente construida — aceptable: el riesgo legal lo justifica.

### Neutras
- El código biométrico se conserva (no se borra); se reactiva cuando se cumplan las precondiciones.

## Alternativas descartadas

### Activar biometría en Etapa 2 (como el SOW)
El SOW la pone en hardening, pero no contempla la validación legal previa de datos sensibles. Se difiere más allá de Etapa 2 hasta tener base legal.

### Quitar el código biométrico
Innecesario y destructivo: es una capacidad futura válida. Se deja latente, no se elimina.

## Referencias
- `Referencias/backend/src/biometric/`, `src/vision/`, `backend/DERMALOG_INTEGRATION.md`
- `docs/specs/product-brief.md` (out of scope v0.1)
- ADR-004 (sidecars), ADR-027 (OpenCV), ADR-029 (RBAC), ADR-018 (firma)
