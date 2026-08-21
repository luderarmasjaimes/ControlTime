# ADR-111 — Portabilidad del stack: export/import y perfil mínimo de telemetría

**Status**: implemented como utilidad; aceptación operativa pendiente

**Fecha**: 2026-08-18

**Ámbito**: plataforma, despliegue, continuidad

**Relación**: SPEC-015, SPEC-020, SPEC-023; complementa ADR-033 y ADR-035.

## Contexto

Existen scripts PowerShell/Bash para exportar imágenes Docker, volúmenes y
dumps lógicos, restaurarlos en otra máquina y arrancar un perfil mínimo de
telemetría 25k. La capacidad no tenía ADR/SPEC y podía confundirse con backup
DR o despliegue productivo automatizado, aun cuando archivos del host, secretos
y modelos requieren copia manual y no existe evidencia de restore integral.

## Decisión

1. Adoptar `export-stack`/`import-stack` como paquete de **portabilidad y
   recuperación asistida**, con implementaciones equivalentes PowerShell/Bash.
2. PostgreSQL se transporta mediante dump lógico; la réplica se reconstruye.
   TimescaleDB usa `timescaledb_pre_restore/post_restore`.
3. Imágenes y volúmenes se exportan de manera optativa. Redpanda no se incluye
   por defecto porque es buffer, no sistema de registro permanente.
4. `.env`, certificados, SDK/modelos biométricos, datos y secretos del host no
   se incorporan automáticamente. Deben inventariarse, transferirse cifrados y
   validarse por canal separado.
5. `start-telemetry-core.ps1` es un perfil de prueba/capacidad; detener servicios
   opcionales no es procedimiento productivo normal.
6. No se denominará «DR aprobado», «backup completo» ni «despliegue
   automatizado» hasta cerrar SPEC-023: checksum/firma, cifrado, restore en host
   limpio, smoke/CTests, medición RTO/RPO, rollback y CI.

## Consecuencias

- Reduce dependencia de una laptop y hace visible qué no está respaldado.
- Añade un camino concreto hacia DR, pero no cierra SPEC-015.
- Los paquetes pueden contener datos sensibles; deben cifrarse y contar con
  retención, custodia y borrado definidos antes de uso real.

## Evidencia

- `scripts/export-stack.ps1`, `scripts/import-stack.ps1`
- `scripts/export-stack.sh`, `scripts/import-stack.sh`
- `scripts/start-telemetry-core.ps1`

## Alternativas descartadas

- Copiar volúmenes Postgres en crudo: menos portable y riesgoso entre versiones.
- Incluir secretos en el paquete: amplía el impacto de una filtración.
- Tratar la existencia del script como prueba DR: no mide restauración ni RTO.
