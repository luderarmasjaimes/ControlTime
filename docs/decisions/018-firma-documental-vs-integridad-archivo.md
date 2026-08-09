# ADR-018 — Firma documental (aprobación humana) ≠ integridad de archivo (SHA-256)

**Status**: implemented, alcance v0.1 (verificado 2026-07-06: `signed_by_name/role/at` se resuelven server-side de forma atómica al transicionar a `signed`; verificación SHA-256 sigue diferida por diseño)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Contexto

El `.miningreport` ya incluye una `signature` que es un **SHA-256 del envelope** (integridad: detecta si el archivo fue alterado). Pero un informe técnico minero también requiere una **firma de aprobación humana**: quién aprueba/firma, con qué cargo, en qué fecha — lo que el estado `signed` del workflow (ADR-017) representa. Hoy se confunden: existe la firma de integridad, pero no un bloque de firma de aprobación en el documento.

## Decisión

Separamos dos conceptos distintos y los modelamos por separado:

1. **Integridad de archivo** (`signature` del envelope): SHA-256 del payload del `.miningreport`, `signedAt`, para detectar manipulación. Es criptográfica y automática.
2. **Firma documental de aprobación**: un **bloque/registro de firma** con `nombre`, `cargo`, `rol`, `fecha de firma`, asociado a la transición a `signed` (ADR-017) y a la identidad RBAC del firmante (ADR-029). Es un acto humano auditado.

### Alcance v0.1 (prioridad)

Como ambos conceptos están separados, en **v0.1 se prioriza la firma documental de aprobación humana** (quién aprueba, cargo, fecha) por su valor operativo y de responsabilidad. El **hash de integridad y su verificación criptográfica completa** (recalcular/validar al abrir, firmado robusto) se difieren a una **versión futura** — el SHA-256 básico ya existe en el código, pero el flujo de verificación de integridad no es prioridad de v0.1. La **firma digital con PKI/certificado** también es futura (ligada al análisis legal, ADR-025).

### Reglas duras
- El estado `signed` requiere una firma documental registrada (no basta el hash).
- La firma documental se asienta en auditoría (ADR-030) y queda inmutable en la versión firmada (ADR-015).
- El hash de integridad se recalcula al exportar/guardar y se valida al abrir.

## Consecuencias

### Positivas
- Distingue "el archivo no fue alterado" de "una persona responsable lo aprobó" — ambos necesarios para un informe con valor legal/operativo.
- Trazabilidad de responsabilidad (quién firmó) para seguridad operativa.

### Negativas / Trade-offs
- Más modelo (firma como dato de negocio) — necesario; no es opcional para un informe firmable.
- La firma documental v0.1 es de aprobación interna (no firma digital con PKI/certificado); la firma digital legal queda como evolución futura, ligada al análisis legal (ver ADR-025).

### Neutras
- Compatible con la máquina de estados (ADR-017) y la identidad RBAC (ADR-029).

## Alternativas descartadas

### Usar solo el SHA-256 como "firma"
Confunde integridad con aprobación; no dice quién aprobó. Insuficiente para un informe responsable. Rechazado.

### Firma digital con PKI desde v0.1
Robusta legalmente, pero exige infraestructura de certificados y análisis legal por país (igual que biometría). Se difiere; v0.1 usa firma de aprobación interna auditada.

## Referencias
- `Referencias/frontend/src/components/ReportStudioV2/lib/miningReportFormat.js` (signature SHA-256)
- ADR-015 (versionado), ADR-017 (workflow), ADR-029 (RBAC), ADR-030 (auditoría), ADR-025 (legal)
