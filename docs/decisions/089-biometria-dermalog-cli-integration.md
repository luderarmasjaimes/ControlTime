# ADR-089 — Integración Comercial Biométrica con Dermalog Face SDK

> **Actualización 2026-09-11 — el rol de InsightFace como motor secundario se
> retira por ADR-166.** Investigando la licencia de InspireFace (ADR-144) se
> encontró que el propio InsightFace/`buffalo_l` que este ADR introdujo como
> fallback tiene la misma restricción de licencia no comercial en sus
> modelos pre-entrenados — código MIT, modelos sin uso comercial gratuito.
> ADR-166 decomisiona InsightFace y adopta SeetaFace6Open (ADR-104, BSD) en
> su lugar. El texto original de abajo (arquitectura "Dual Provider") se
> conserva como registro histórico de la decisión original.

**Status**: partially superseded by ADR-105

**Ámbito**: ia, seguridad, biometría

> **Actualización 2026-08-18 — parcialmente superseded por ADR-105.** La
> decisión original de usar Dermalog como proveedor «principal y mandatario»
> dejó de estar vigente el 2026-08-12. El proveedor local por defecto es
> DeepFace + Silent-Face-Anti-Spoofing; Dermalog queda como secundario explícito
> y solo puede utilizarse ante fallos de infraestructura bajo las condiciones
> fail-closed de ADR-105. Se conserva el texto original inferior como registro
> histórico. La integración comercial y su mecanismo CLI siguen vigentes.

| Campo | Valor |
|---|---|
| **Estado** | **Parcialmente superseded por ADR-105 (2026-08-12)** |
| **Fecha** | 2026-08-05 |
| **Decisor(es)** | Arquitecto TI + Especialista IA |
| **Sustituye a** | ADR-005 (InsightFace/ONNX) |

## Contexto
Aunque originalmente se definió (ADR-005) el uso de InsightFace y redes neuronales ONNX propias para la validación y login biométrico, requerimientos de cumplimiento normativo y certificaciones hardware exigieron la integración de una solución comercial (Idemia/Dermalog).

## Decisión
- El motor C++ utilizará el SDK de Dermalog a través del proveedor `BiometricProvider::DermalogCli` como el **validador principal y mandatario**.
- El SDK de Dermalog se inyecta en tiempo de ejecución vía volúmenes de Docker (`DERMALOG_SDK_HOST_DIR`) y es invocado mediante un subproceso (`dermalog-face-cli`).
- **Respaldo Automático (Fallback):** Si el binario de Dermalog falla o el proveedor no está disponible, el sistema C++ ejecutará un fallback automático y transparente hacia el contenedor Python local (`ai_engine`) para utilizar la red neuronal abierta **InsightFace (ArcFace)**, garantizando que el sistema nunca pierda la capacidad biométrica.
- La validación es totalmente consumible vía API REST (con soporte CORS), permitiendo clientes frontend externos enviar imágenes Base64.

## Consecuencias
- La arquitectura pasa a ser de "Dual Provider" (Comercial Primario + OpenSource Fallback).
- Se requiere mantener el contenedor Python `ai_engine` activo como red de seguridad.
