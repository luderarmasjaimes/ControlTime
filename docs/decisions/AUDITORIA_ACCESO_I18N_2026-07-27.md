# Auditoría ADR — acceso, i18n, biometría y seguridad (2026-07-27)

## Alcance

Revisión cruzada de las correcciones de login/registro, país/idioma,
validación fiscal, avatar, diálogos de interfaz, CSRF, smoke E2E e
identificadores. El objetivo es distinguir compatibilidad, contradicción
documental, implementación en fuente y despliegue efectivo.

## Matriz de compatibilidad

| Cambio | ADR propietario | ADR relacionados | Veredicto |
|---|---|---|---|
| País→idioma ES/EN/FR/PT-BR | 075 | 035, 040, 042 | Compatible: amplía presentación, no topología ni IDs internos |
| Documento fiscal por país | 075 | 066, 067 | Compatible: validación estructural; no certifica vínculo tributario/tenant |
| Login/tenant de contratista | 066 | 067, 075 | Compatible: `company` sigue siendo la minera; razón social contratista no reemplaza tenant |
| Avatar local 4K bajo demanda | 074 | 001, 004, 025, 027, 029, 037, 041 | Compatible: procesamiento local, self-only; EPP y gate legal siguen diferidos |
| Diálogos propios accesibles | 073 | 022, 040, 075 | Compatible: cambia presentación, conserva resolución de conflictos offline |
| Refresh HttpOnly + CSRF | 029 | 041, 058, 060 | Compatible; nombre vigente es `csrf_token_v2`, no el legacy `csrf_token` |
| UUID compacto DB-safe | 076 | 029, 037, 060, 075 | Implementado, probado y desplegado |
| Secretos CSPRNG | 076 | 029, 043 | Implementado con `RAND_bytes`: refresh/`jti`/API keys de 256 bits |
| Password Argon2id versionado | 077 | 029, 037, 043, 058, 060 | Implementado; rehash legacy oportunista y transición inventariada |
| Alta administrada de empresa | 078 | 037, 066, 067, 075 | Admin-only, deduplicada, con tenant real y auditoría |

## Contradicciones documentales corregidas

1. ADR-029/058 conservaban `csrf_token` como nombre vigente. El runtime usa
   `csrf_token_v2` con `Path=/`; la cookie legacy se vence explícitamente.
2. El índice de ADR-073 describía solo `SaveTitleModal`, aunque ya se
   eliminaron confirmaciones y avisos nativos del resto de la aplicación.
3. El índice afirmaba que `CHANGELOG.md` no se actualizaba desde 2026-07-05;
   ya contiene la entrega 2026-07-27.
4. La corrección de longitud de `makeId()` estaba incluida dentro de la
   evidencia de ADR-075, pero afectaba identidad y secretos. ADR-076 separa
   la decisión transversal.
5. ADR-043 documentaba el salt como pendiente, pero no definía una migración
   que resolviera también el uso de `std::hash`. ADR-077 implementa ese
   camino sin invalidar masivamente las cuentas existentes.
6. El Router IA solo cargaba la matriz histórica de `specs/REGISTRY.md` y
   omitía ADR vigentes declarados en SPEC-006/008. El parser ahora fusiona
   la sección `Decisiones vigentes complementarias` y resuelve sus archivos
   desde `docs/decisions` sin renumerar los 12 ADR históricos.

## Estados verificables

- Fuente frontend: TypeScript y build de producción OK; Vitest 25/25.
- Fuente backend: imagen nueva compilada; `ctest` 100 %, 0 fallos.
- E2E ejecutado después del despliegue: registro, contraseña, rostro,
  auditoría/CSV, refresh+CSRF y logout.
- Fiscal desplegado: 8/8 casos PE/BR/US/CA.
- Contenedores actuales: 16 servicios activos y saludables; backend y
  frontend usan las imágenes nuevas.
- PostgreSQL: alta nueva en Argon2id (longitud 97) y migración oportunista
  legacy→Argon2id demostrada. Inventario real actualizado al 2026-07-29:
  14 Argon2id, 40 legacy.
- Prueba física de cámara/avatar con un usuario autorizado: pendiente de QA
  manual; no cambia el estado de código de ADR-074/075.
- Plataforma IA: 10/10 pruebas; Router y motor de decisión devuelven para
  SPEC-006 los ADR vigentes 029/043/058/066/067/073/075/076/077 además de
  los históricos aplicables.

## Resultado

No se encontró conflicto irresoluble entre las decisiones implementadas.
ADR-076 y ADR-077 quedaron cerrados en código, pruebas, despliegue y evidencia
operativa. Persisten solo validaciones externas/manuales: prueba física de
cámara con persona autorizada y pentest independiente. La retirada futura
del verificador legacy depende de que el inventario llegue a cero.
