# ADR-180 — Descarte del SDK biométrico comercial Dermalog por licencia con costo adicional

**Status**: accepted (decisión de negocio) — sin impacto en producción, el sistema real ya no depende de este SDK

**Fecha**: 2026-09-12

**Autores**: Luder Armas (decisión de negocio)

**Ámbito**: ia, seguridad, biometría

**Relación**: cierra formalmente SPEC-008 T16 (certificación Dermalog con
hardware real, S11/R5) — retira ese pendiente en vez de reprogramarlo.
Mismo patrón de decisión que [ADR-166](166-decomiso-insightface-secundario-adopcion-seetaface6.md)
(descarte de un proveedor biométrico por licencia). No reabre ni contradice
[ADR-089](089-biometria-dermalog-cli-integration.md) (integración CLI
original) ni [ADR-105](105-deepface-silentface-proveedor-biometrico-primario.md)
(proveedor primario vigente) — formaliza la decisión de no seguir
avanzando hacia una licencia comercial de Dermalog.

## Contexto

Dermalog (Idemia/Dermalog Face SDK) se integró en ADR-089 (2026-08-05) como
proveedor biométrico "principal y mandatario" vía un wrapper CLI
(`vendor/dermalog/`, `BiometricProvider::DermalogCli`), pensado para
cumplir requerimientos de certificación hardware. El 2026-08-12, ADR-105
ya lo degradó a proveedor **secundario explícito**: el proveedor local por
defecto pasó a ser DeepFace + Silent-Face-Anti-Spoofing (MIT, sin costo),
con Dermalog reservado solo para invocarse ante fallos de infraestructura,
bajo condiciones fail-closed, y **solo si estuviera realmente configurado**
(`BEEMETRY_DERMALOG_REQUIRED=false` por defecto en `docker-compose.yml`;
el volumen `DERMALOG_SDK_HOST_DIR` apunta a un directorio vacío por
defecto — sin el binario licenciado real, ese proveedor nunca se activa
en la práctica).

El pendiente que quedaba abierto era `SPEC-008 T16`: certificar el sistema
contra hardware Dermalog real, programado para el sprint S11 (release R5).
Evaluando el costo de avanzar con esa certificación, se encontró que
requiere **licencia comercial con costo adicional** — el SDK vendorizado en
el repositorio (`vendor/dermalog/`: cabeceras de los "loaders", tutoriales,
script de instalación) es solo la capa de integración/wrapper; el binario
real del SDK y su licencia de uso comercial nunca se adquirieron y
requieren un contrato pago con Dermalog/Idemia.

## Decisión

1. **Se descarta la adquisición de la licencia comercial de Dermalog.** No
   se justifica el costo frente a que el sistema real de producción ya
   opera completo y verificado sobre proveedores sin costo de licencia
   (DeepFace+Silent-Face-Anti-Spoofing como primario, ADR-105; SeetaFace6
   como alternativa local, ADR-104) — mismo criterio de costo/beneficio ya
   aplicado en ADR-166 para InsightFace/InspireFace.
2. **SPEC-008 T16 (certificación Dermalog hardware) se retira de los
   pendientes** — no se reprograma a otro sprint, se cierra como no
   aplicable: sin licencia comercial no hay hardware que certificar.
3. **El wrapper CLI (`vendor/dermalog/`, `BiometricProvider::DermalogCli`,
   `BEEMETRY_DERMALOG_REQUIRED`) se conserva en el código, inactivo por
   defecto**, no se elimina en este ADR — es solo la capa de integración
   (no el SDK licenciado en sí), ya fail-closed y ya sin ningún flujo real
   de producción que dependa de ella (ADR-105 ya lo relegó a fallback
   opcional). Su eliminación completa, si se decide más adelante, es un
   cambio de código separado y de bajo riesgo dado que ya está inactivo.
4. **No cambia nada del sistema biométrico real en producción** — DeepFace
   +Silent-Face-Anti-Spoofing sigue siendo el proveedor primario (ADR-105),
   sin ningún cambio de comportamiento para ningún usuario.

## Consecuencias

### Positivas
- Cierra un pendiente que llevaba desde S11/R5 sin fecha real de avance
  (dependía de una decisión de compra que nunca se tomó) — deja de
  aparecer como riesgo/pendiente de SPEC-008.
- Evita un gasto de licencia comercial sin un caso de negocio que lo
  justifique, dado que el sistema ya funciona completo sin él.
- Consistente con la decisión ya tomada en ADR-166 para el mismo tipo de
  situación (proveedor biométrico secundario con costo de licencia,
  descartado en favor de una alternativa ya integrada sin costo).

### Negativas / Trade-offs
- Si en el futuro un cliente o regulación exige específicamente
  certificación con hardware Dermalog/Idemia (a diferencia de una
  validación funcional con cámara real ya lograda, ver ADR-119/162), esta
  decisión tendría que revisarse — no es una prohibición permanente, es
  una decisión de costo/beneficio vigente a la fecha, sin ese requisito
  concreto sobre la mesa.
- `vendor/dermalog/` sigue ocupando espacio en el repositorio sin
  cumplir ninguna función activa — aceptable como registro histórico de
  la integración, limpieza de código queda como trabajo futuro opcional.

## Alternativas descartadas

### Reprogramar T16 a una fecha posterior en vez de retirarlo
Descartada — no hay ninguna señal de que la licencia se vaya a comprar en
el futuro cercano; dejarlo "pendiente sin fecha" indefinidamente es peor
para la trazabilidad que cerrarlo explícitamente como descartado, con la
puerta abierta a reabrirlo si cambia el contexto de negocio (punto 4 de
Consecuencias).

## Referencias
- [ADR-089](089-biometria-dermalog-cli-integration.md) (integración CLI original)
- [ADR-105](105-deepface-silentface-proveedor-biometrico-primario.md) (proveedor primario vigente, sin costo)
- [ADR-104](104-seetaface6-proveedor-biometrico-local.md) (alternativa local, sin costo)
- [ADR-166](166-decomiso-insightface-secundario-adopcion-seetaface6.md) (mismo patrón de decisión: descarte por licencia comercial)
- `vendor/dermalog/` (wrapper CLI, conservado inactivo)
- `docker-compose.yml` (`BEEMETRY_DERMALOG_REQUIRED=false`, `DERMALOG_SDK_HOST_DIR`)
- `specs/008-biometria-facial-login/tasks.md` (T16 retirado)
