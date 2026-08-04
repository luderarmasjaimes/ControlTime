# ADR-001 — Despliegue soberano on-prem (VPS Linux, Lima)

**Status**: implemented (verificado 2026-07-06: `docker-compose.yml` — todos los servicios son contenedores auto-hospedados, sin referencias a SDKs de AWS/GCP/Azure ni servicios gestionados)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: plataforma

## Contexto

El cliente es una operación minera que exige que su información crítica resida en territorio nacional, con baja latencia y mínima dependencia de la nube internacional. El SOW lo eleva a principio: "soberanía de la información crítica". El producto debe operar aun con conectividad variable (campo, socavón) y garantizar continuidad. Esto condiciona toda la topología: dónde corren los datos, los modelos de IA y la cartografía.

## Decisión

Todo el stack se despliega **on-premise sobre VPS Linux en Lima**, orquestado con Docker, como un conjunto de ~8 servicios: TimescaleDB, backend C++ (gateway), formula_engine, sidecar de IA (Python), Ollama (LLM local), LanguageTool (corrección es-PE), mbtileserver (mapas) y frontend React/Nginx. **Ningún dato crítico sale a la nube externa.** La integración con fuentes externas autorizadas (histórico) es controlada y unidireccional hacia adentro.

### Reglas duras
- Los modelos de IA (LLM, corrección, CV) corren localmente; no se permite llamar a APIs de IA en la nube para dato operativo (ver ADR-024, ADR-004).
- La cartografía es offline (MBTiles), no tiles de un proveedor online (ver ADR-026).
- Backups y almacenamiento de objetos son soberanos (MinIO, ver ADR-009).

## Consecuencias

### Positivas
- Cumple la promesa dura de soberanía + dato en territorio nacional.
- Baja latencia local habilita el presupuesto <20 ms (ver ADR-023).
- Independencia de la disponibilidad de la nube externa = continuidad operativa.

### Negativas / Trade-offs
- Mayor responsabilidad operativa propia (parches, DR, monitoreo) — se cubre con SYS + hardening en Etapa 2.
- Escalado horizontal limitado vs nube elástica — aceptable: la carga es acotada y conocida (10k sensores).

### Neutras
- Requiere RFQ de datacenter (Cirion/GTD/Equinix/etc.), ya en curso en los docs de negocio.

## Alternativas descartadas

### Nube pública (AWS/GCP/Azure)
Elástica y de menor carga operativa, pero viola la promesa de soberanía y agrega dependencia y latencia. El propio SOW marca la "desconexión de AWS" como objetivo.

### Híbrido (core on-prem + analítica en nube)
Tentador para ML pesado, pero parte del dato crítico saldría del territorio; se descarta para v0.1. Reevaluable solo con base legal y de negocio explícita.

## Referencias
- `Referencias/docs/00_SOW/SOW_Maestro_AURIXA_2026_v4.md` § 4
- `Referencias/docs/02_Arquitectura/Arquitectura_Solucion_AURIXA_v36.md`
- ADR-002 (gateway C++), ADR-004 (políglota), ADR-024 (IA local)
