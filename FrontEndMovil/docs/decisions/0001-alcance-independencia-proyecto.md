# ADR-0001 — Alcance e independencia del proyecto FrontEndMovil

**Status**: accepted
**Fecha**: 2026-09-20
**Autores**: Luder Armas (decisión de producto), con Claude Code
**Ámbito**: frontend-movil, gobernanza

## Contexto

La plataforma minera Beemetry/AURIXA (`D:\InformeCliente`) tiene hoy un único
frontend de escritorio (`frontend/`, React + TypeScript + Vite) que cubre
~25 módulos funcionales (dashboard, alarmas, telemetría, mapas, informes,
motor de fórmulas, administración, etc.) sobre un backend C++ propio
(`backend/`). Se pidió un frontend nuevo, para Android, que replique toda
esa funcionalidad con una interfaz reactiva nativa, viviendo en una carpeta
independiente (`D:\InformeCliente\FrontEndMovil`).

El repositorio principal ya tiene precedente sobre cómo tratar iniciativas de
"otro cliente para la plataforma" que no son el frontend web principal:

- [ADR-110](../../../docs/decisions/110-operaciones-campo-offline-integracion-erp.md)
  (repo principal) estableció, para la app de Operaciones de Campo
  (SPEC-022 — captura de piezómetros en sitio + integración ERP, un producto
  *distinto* a este), que "toda integración entra por la API Beemetry; el
  cliente nunca accede a BD ni ERP directamente" — el backend se reutiliza
  como servicio, nunca se reimplementa.
- [ADR-178](../../../docs/decisions/178-operaciones-campo-fuera-de-alcance-implementacion-futura-independiente.md)
  (repo principal) formalizó que esa misma iniciativa (Operaciones de Campo)
  queda **fuera del alcance, presupuesto y seguimiento** del proyecto
  principal — cualquier futura iniciativa relacionada con "una app" para la
  plataforma minera debe ser un **proyecto propio e independiente**, con su
  propio registro de decisiones, sin heredar ni competir por el alcance del
  proyecto principal.

Aunque FrontEndMovil no es Operaciones de Campo/SPEC-022 (este proyecto es un
cliente móvil para la plataforma minera *ya existente* — dashboard, alarmas,
mapas, informes, etc. — no una app de captura de campo con integración ERP),
el mismo criterio de gobernanza de ADR-178 aplica igual de bien: es una
iniciativa de cliente nueva, separada del frontend web, y así se le trata
desde el día uno — que es exactamente lo que ya se pidió (carpeta separada,
ADRs propios).

## Decisión

1. **FrontEndMovil es un proyecto independiente** del frontend web principal
   y de Operaciones de Campo/SPEC-022. Vive en `D:\InformeCliente\FrontEndMovil`,
   con su propia serie de ADRs (numeración propia `ADR-0001+`, sin relación
   con la numeración `ADR-NNN` del repo principal), su propio `README.md`, y
   su propio ciclo de vida de commits/releases.
2. **El backend Beemetry (`backend/`) es el único punto de integración
   compartido** con el resto de la plataforma — mismo criterio que ADR-110:
   toda funcionalidad de FrontEndMovil se implementa exclusivamente contra la
   API REST/WebSocket/SSE ya expuesta por ese backend (ver ADR-0003 para el
   contrato de autenticación). FrontEndMovil nunca accede directamente a la
   base de datos, a Odoo/ERP, ni a ningún otro servicio interno.
3. **No se modifica el repositorio principal** para construir este proyecto:
   no se tocan `docs/decisions/`, `specs/BACKLOG.md`, `specs/REGISTRY.md`, ni
   ningún archivo de `frontend/`/`backend/` fuera de lo estrictamente
   necesario para que el backend siga sirviendo a ambos clientes (si en algún
   momento se necesita un endpoint nuevo o un cambio de contrato, eso se
   propone como su propio ADR en el repo principal, igual que cualquier otro
   consumidor de la API).
4. **Alcance funcional**: replicar, en una app Android nativa, la totalidad
   de los módulos hoy disponibles en el frontend web (ver ADR-0002 a
   ADR-0006 para el cómo). No se agrega alcance nuevo de negocio (no es
   Operaciones de Campo, no es captura offline con ERP) — es el mismo
   negocio, la misma API, un cliente distinto.

## Consecuencias

### Positivas
- Cero riesgo de que este proyecto "contamine" las métricas, el backlog o
  los reportes gerenciales del proyecto principal (mismo problema que motivó
  ADR-178 para Operaciones de Campo).
- El backend ya fue diseñado (ADR-132 del repo principal) para convivir con
  múltiples frontends en el mismo host/dominio — este proyecto es, en los
  hechos, la primera aplicación real que ejercita ese diseño multi-frontend
  además del frontend web.
- Cambios al proyecto móvil (dependencias, versión de Flutter, arquitectura
  interna) nunca requieren coordinación con el ciclo de release del frontend
  web.

### Negativas / Trade-offs
- Cualquier cambio de contrato de API que el backend necesite para servir
  mejor a este cliente (por ejemplo, un endpoint más liviano para móvil)
  debe negociarse y documentarse en el repo principal como cualquier otro
  cambio de API — este proyecto no puede decidir unilateralmente el contrato
  del backend.
- Duplicación inevitable de cierta lógica de negocio (validaciones de forma,
  reglas de UI) entre el frontend web y este proyecto, al no compartir código
  (React vs. Flutter) — aceptado como costo del cambio de plataforma.

## Referencias
- `docs/decisions/110-operaciones-campo-offline-integracion-erp.md` (repo
  principal — patrón "toda integración por la API Beemetry")
- `docs/decisions/178-operaciones-campo-fuera-de-alcance-implementacion-futura-independiente.md`
  (repo principal — gobernanza independiente para iniciativas de cliente
  nuevas)
- `docs/decisions/132-bearer-en-memoria-cookies-namespaced-aislamiento-multifrontend.md`
  (repo principal — diseño de auth ya preparado para múltiples frontends)
- ADR-0002 (elección de stack), ADR-0003 (autenticación/sesión/biometría)
