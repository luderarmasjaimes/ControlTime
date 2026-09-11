# ADR-110 — Operaciones de campo offline-first e integración gobernada con ERP

> **Actualización 2026-09-11 — rebaseline aprobado por Gerencia, cierra la
> decisión pendiente del corte gerencial del 2026-09-10.** Se confirma
> explícitamente: (1) Operaciones de Campo es un **proyecto derivado**,
> separado del alcance/cronograma v36.1 de la plataforma minera AURIXA/
> Beemetry (S1-S13, R1-R6) — necesita su **propio product owner y
> presupuesto**, no se absorbe en los sprints restantes, mismo criterio que
> ya adelantaba `specs/022/spec.md` ("requiere reprogramación posterior a
> R6"). (2) Su construcción se considera para **etapas posteriores** de la
> plataforma minera, sin fecha de inicio todavía. (3) **Dirección de
> arquitectura confirmada por Gerencia, refuerza el punto 1 de la Decisión
> propuesta de abajo**: en vez de que este proyecto derivado (u otras
> aplicaciones futuras que lo requieran) reimplemente su propio backend,
> debe **reutilizar el backend de Beemetry como componentes de servicios
> web** — la robustez ya construida y verificada (base de datos, RBAC
> multitenant, procesamiento en tiempo real a 25k/s sostenidos, ADR-108) se
> expone vía API en vez de duplicarse. Esto no es una decisión nueva de
> arquitectura — ya era el diseño de ADR-110 punto 1 ("Toda integración
> entra por la API Beemetry; el cliente nunca accede a BD ni ERP
> directamente") — esta actualización eleva ese punto de diseño técnico a
> decisión de negocio explícita, y aclara que el mismo backend puede
> servir a Operaciones de Campo y a aplicaciones futuras distintas, no solo
> a esta.
>
> **Lo que NO queda resuelto por esta actualización**: la lista completa de
> "Decisiones pendientes antes de aceptar" de este ADR (formato del PDF,
> dispositivos/MDM, matriz de datos ERP↔Beemetry, ventana offline,
> consentimiento/privacidad, piloto minero y KPIs) sigue abierta — son
> decisiones operativas del proyecto derivado, para cuando tenga su propio
> product owner, no decisiones que este documento resuelva por adelantado.
> El estado de ejecución de SPEC-022 sigue en 0% — aprobar el proyecto como
> derivado no es lo mismo que empezar a construirlo.

**Status**: proposed; pendiente de aprobación de producto y arquitectura

**Fecha**: 2026-08-18

**Ámbito**: field-operations, integración, ia

**Relación**: SPEC-014, SPEC-017, SPEC-019, SPEC-022; ADR-022, ADR-025,
ADR-026, ADR-045 y ADR-103.

## Contexto

Las presentaciones de MineriaCampo describen instalación y lectura de
piezómetros, formularios por etapa, evidencias fotográficas, coordenadas,
PDF por equipo y retorno al ERP; también proponen PDA robusta, OCR, voz,
visión EPP y asistencia local. No existe implementación de aplicación móvil
en este repositorio ni una decisión que separe datos maestros, ejecución de
campo y escritura al ERP. Sin esa frontera, el prototipo corre riesgo de
acceso directo a Odoo, duplicidad y pérdida al quedar sin señal.

## Decisión propuesta

1. Construir una aplicación de campo separada, inicialmente web móvil y luego
   cliente PDA/Flutter si la validación operativa lo exige. Toda integración
   entra por la API Beemetry; el cliente nunca accede a BD ni ERP directamente.
2. El ERP es fuente autoritativa de proyecto, equipo y certificado de
   calibración. Beemetry es fuente autoritativa de asignación, estado de
   formularios, evidencias, coordenadas, firma y bitácora de ejecución.
3. Cada formulario (operatividad, saturación, post-saturación, coordenadas y
   post-instalación) conserva estado `pending/saved/completed`; el informe por
   dispositivo solo se cierra cuando las reglas configuradas se cumplen.
4. El cliente mantiene almacenamiento local cifrado y un outbox idempotente.
   La sincronización es reintentable y visible; los conflictos se resuelven
   con versión/ETag y auditoría, no con «última escritura gana» silenciosa.
5. La escritura hacia ERP reutiliza el gateway/outbox de ADR-103. Fotografías,
   documentos y PDFs se almacenan como artefactos versionados; el ERP recibe
   identificadores y estados, no blobs sin gobierno.
6. OCR, STT, detección EPP, predicción y asistente local se habilitan por
   capacidades independientes. Ninguna salida IA cierra un trabajo o una
   alarma crítica sin regla determinista y confirmación humana definida.
7. ADR-025 (EPP deferred) continúa vigente: SPEC-017 queda planificada pero no
   reactivada hasta aprobar dataset, privacidad, umbrales y validación en sitio.
8. Los porcentajes de ROI incluidos en material conceptual no se consideran
   resultados del proyecto hasta contar con línea base y medición piloto.

## Decisiones pendientes antes de aceptar

- Formato contractual del PDF, firmantes y regla de aprobación/corrección.
- Dispositivos, sistema operativo, MDM, cifrado y borrado remoto.
- Matriz de datos ERP↔Beemetry, códigos maestros y manejo de bajas.
- Ventana offline, tamaño máximo de evidencia y política de conflictos.
- Consentimiento/privacidad para voz, rostro, ubicación y fotografía.
- Piloto minero, responsables y KPIs de tiempo, retrabajo y sincronización.

## Consecuencias

La propuesta evita crear una segunda plataforma inconexa y permite entregar
por fases. Hasta que los puntos anteriores se aprueben, operaciones de campo
debe reportarse como **0% de implementación de producto**, aunque exista
diseño conceptual en PowerPoint.

## Referencias

- `MineriaCampo/flujo_app_beemetry_svc.pptx`
- `MineriaCampo/Presentacion_Integrada_Aurixa_MineriaCampo.pptx`
- `specs/022-operaciones-campo-offline-erp/`
