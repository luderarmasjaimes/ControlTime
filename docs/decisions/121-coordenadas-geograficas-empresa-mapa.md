# ADR-121 — Coordenadas geográficas de la empresa en `auth_companies` (centra Mapas en la mina real)

**Status**: implemented (2026-08-20)

**Fecha**: 2026-08-20

**Ámbito**: mapas, auth

## Contexto

`MapViewer.tsx` (pantalla "Mapas") centraba el mapa en un `INITIAL_VIEW`
hardcodeado con las coordenadas de Toquepala, sin importar la empresa/tenant
logueado. Un usuario de una empresa distinta (p. ej. Alpayana) veía siempre
la mina de otra compañía al abrir Mapas — el componente nunca consultaba la
sesión.

El repo ya tenía un resolutor de coordenadas por empresa
(`frontend/src/config/miningLocations.ts` + tabla `mining_site_locations`,
`db_scripts/29`), pero solo estaba conectado al capturador de mapas de Report
Studio (`MapCaptureModal.tsx`), no a la pantalla Mapas — y esa tabla está
indexada por **texto libre** (`company_name`, sin FK), lo que la hace frágil
(match por variante de nombre) y explica por qué Alpayana ni siquiera
aparecía en su lista precargada.

`auth_companies` (CRUD real de empresas desde ADR-085/086) tampoco tenía
coordenadas. Se evaluó y descartó extender `mining_site_locations` (sin FK
real) y resucitar la tabla `sites` (`db_scripts/04`, tiene `tenant_id` FK
pero cero rutas backend la usan — código muerto). También se descartó usar
la "IA local" del proyecto (Ollama/LanguageTool, documentada solo para
corrección/reescritura de texto — spec 011) para inventar coordenadas GPS a
partir de una dirección: un LLM puede alucinar una ubicación, y una
coordenada de mina equivocada tiene consecuencias operativas reales.

## Decisión

1. Columnas nuevas `latitude`, `longitude`, `location_zoom` en
   `auth_companies` (`db_scripts/68`), nullable, sin default — retrofit sobre
   empresas ya existentes. "Sin coordenadas todavía" es un estado válido y
   explícito, nunca `(0,0)` como sentinela.
2. `GET /api/map/company-location`, autenticado (cualquier usuario logueado,
   sin permiso especial — cada quien necesita ver el mapa de su propia
   empresa), resuelve por `session->tenantId` contra `auth_companies`.
3. Alta/edición de coordenadas vía los endpoints existentes
   `POST`/`PUT /api/auth/companies`, extendidos con `latitude`/`longitude`/
   `location_zoom` opcionales (deben viajar en pareja), gateados por
   `empresas.manage` igual que el resto del CRUD (ADR-085/086).
4. UX de captura (decisión explícita del negocio, no negociable en el
   diseño): buscador de dirección → proxy backend a Nominatim/OSM
   (`GET /api/map/geocode`, host fijo, HTTPS, `User-Agent` identificable,
   throttle de 1 req/s, gateado también por `empresas.manage`) que **solo
   recentra aproximadamente** el mapa, + marcador arrastrable/clicable de
   Leaflet (`CompanyLocationPicker.tsx`) para el ajuste fino manual — nunca
   coordenadas generadas por IA.
5. `MapViewer.tsx` reemplaza el centro fijo (renombrado `FALLBACK_VIEW`) por
   un fetch a `/api/map/company-location` al montar, en un efecto separado
   del de creación del mapa (no bloquea el render inicial); si la empresa aún
   no tiene coordenadas o el fetch falla, se queda en el fallback de
   Toquepala sin error. El botón "Home" apunta al mismo destino resuelto.

## Consecuencias

- Empresas nuevas o ya existentes sin coordenadas deben cargarlas
  manualmente vía el picker — no hay backfill automático, no hay fuente
  confiable para inferirlas retroactivamente.
- El centrado inicial y el botón "Home" de Mapas dependen de que alguien con
  `empresas.manage` haya cargado el dato; hasta entonces, el comportamiento
  es idéntico al de antes de este ADR (Toquepala fijo).
- Nominatim impone 1 req/s en su política de uso — mitigado con throttle
  server-side (`429` inmediato, sin cola ni sleep bloqueante).
- No se tocó el panel "Integración WMS Oficial" de Mapas (INGEMMET
  Geocatmin) — se verificó operativo, solo empieza con el toggle apagado por
  diseño; fuera de alcance de este ADR.
- `mining_site_locations` y la tabla `sites` quedan sin cambios — no se
  migraron ni se resucitaron, la nueva fuente de verdad para el centrado de
  Mapas es exclusivamente `auth_companies`.

## Alternativas descartadas

- **Extender `mining_site_locations`**: seguiría indexada por texto libre de
  nombre de empresa, sin FK a `tenant_id` — el mismo problema de fragilidad
  que ya afecta al capturador de Report Studio.
- **Resucitar la tabla `sites`**: tiene el FK correcto pero cero rutas
  backend la usan hoy; adoptarla hubiera exigido construir ese CRUD desde
  cero en vez de extender el CRUD de empresas ya real y probado
  (ADR-085/086).
- **Geocodificación vía IA local (Ollama)**: descartada explícitamente — un
  LLM no es una fuente confiable de coordenadas GPS exactas, alucina.
- **Geocodificación 100% automática sin ajuste manual**: descartada por
  precisión — Nominatim puede acertar la ciudad/dirección pero no
  necesariamente el punto exacto de la mina; se mantiene el marcador
  arrastrable como paso obligatorio de facto para el ajuste fino.

## Referencias

- `frontend/src/components/Special/MapViewer.tsx` (`FALLBACK_VIEW`, fetch de
  ubicación al montar)
- `frontend/src/components/Special/CompanyLocationPicker.tsx` (picker nuevo)
- `frontend/src/components/ReportStudioV2/components/views/CompanyManagementView.tsx`
- `frontend/src/auth/authApi.ts` (`fetchCompanyLocation`, `geocodeAddress`)
- `backend/src/map/map_routes.cpp` (`handleCompanyLocation`)
- `backend/src/map/geocode_proxy.cpp` / `geocode_proxy_security.cpp` (proxy nuevo)
- `backend/src/auth/auth_storage_pg.cpp` / `auth_routes.cpp` (CRUD de empresas extendido)
- `db_scripts/68_company_mine_coordinates.sql`
- ADR-085/086 — CRUD administrado de empresas que este ADR extiende
- `backend/src/map/wms_proxy.cpp` / `wms_proxy_security.cpp` — mismo patrón
  de proxy defensivo (HTTPS-only, host fijo, anti-SSRF) que sigue el proxy
  de geocodificación
