# ADR-108 — Línea base de telemetría 25.000 eventos/s y escalamiento por topología

**Status**: implemented para 25.000 eventos/s; 100.000 eventos/s no aprobado

**Fecha**: 2026-08-18

**Ámbito**: core-iot, datos, resiliencia

**Relación**: SPEC-001, SPEC-020; refina ADR-008, ADR-023, ADR-032 y ADR-034.

## Contexto

Las decisiones tempranas expresaban metas de 10.000 sensores y crecimiento
horizontal, pero no fijaban una frontera demostrada con criterios repetibles.
El 11 y 12 de agosto se ejecutaron pruebas de capacidad, falla de base y replay.
El resultado aprobado no es 100.000 eventos/s: es una línea base sostenida de
25.000 eventos/s con la topología y configuración ensayadas.

## Decisión

1. La capacidad oficialmente demostrada del stack es **25.000 eventos/s por
   unidad edge**, durante 60 s, con 1.500.000/1.500.000 eventos persistidos,
   p99 149,8 ms y máximo 226,2 ms en el caso idempotente final.
2. La topología recomendada para esa tasa es 250 agregadores con 100 sensores
   por agregador. No se equipara «sensor» a conexión TLS individual: el ensayo
   con 2.500 conexiones elevó el p99 de conexión a 4,783 s.
3. El pipeline aprobado usa 3 consumidores/conexiones, 6 particiones,
   producción idempotente, reintentos/backoff, ACK agrupado, staging y
   deduplicación. Las lecturas no deben competir con la escritura primaria.
4. La prueba de caída de base debe recuperar el backlog completo sin reiniciar
   procesos; el replay debe terminar con cero inserciones duplicadas.
5. **Queda prohibido comunicar 50k, 75k o 100k eventos/s como capacidad
   validada.** La corrida de 100k fue detenida de forma segura: la configuración
   anterior incumplió p99 y perdió 230 eventos durante la caída de BD.
6. Para reclamar 100k se exige: separación de roles/procesos, clúster de al
   menos 3 brokers, almacenamiento NVMe separado, sizing de retención, pruebas
   25→50→75→100k y soak de 1 h y 24 h, además de recuperación y replay sin
   pérdida. El resultado generará un nuevo ADR, no una edición optimista.

## Consecuencias

- Existe una cifra gerencial auditable y una frontera explícita de lo no
  validado.
- La escala LATAM de ADR-035 se obtiene agregando edges y hubs; este ADR no
  autoriza concentrar toda la carga regional en un solo nodo.
- Cambios de particiones, consumidores, ACK o persistencia requieren repetir
  la suite de capacidad antes de conservar la declaración de 25k.

## Evidencia

- `docs/PRUEBA_CAPACIDAD_TELEMETRIA_25K_2026-08-12.md`
- `docs/PRUEBA_CAPACIDAD_TELEMETRIA_100K_2026-08-11.md`
- `specs/020-telemetria-25k-tiempo-real/`

## Alternativas descartadas

- **Promediar resultados parciales**: oculta p99 y pérdida bajo falla.
- **Declarar 100k por extrapolación**: no hay evidencia experimental.
- **Una conexión por sensor**: no corresponde a la topología de campo
  recomendada y degrada el establecimiento TLS.
