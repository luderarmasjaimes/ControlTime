# ADR-056 — CSP dedicada para el Service Worker de tiles del mapa

**Status**: implemented (2026-07-18). Verificado E2E en vivo: base satelital
18/18 tiles OK, INGEMMET catastro 18/18, SENAMHI clima 18/18, MTC vial
18/18, IGN centros poblados 18/18 (antes del fix: 18/18 rotos en todas las
fuentes).
**Fecha**: 2026-07-18
**Autores**: EC
**Ámbito**: geo

## Contexto

Incidente real: el 100% de los tiles del mapa (base satelital de Google +
los 8 WMS gubernamentales del catálogo — INGEMMET, MINEM, OEFA, ANA,
SERNANP, SENAMHI, MTC, IGN) aparecían rotos en el navegador, mientras que
los mismos servidores respondían correctamente por `curl` desde la misma
máquina — descartando de entrada un problema de red o de los proveedores
externos.

**Causa raíz**: los `fetch()` que corren dentro de un Service Worker se
rigen por la Content-Security-Policy **del script del worker**, no por la
CSP de la página que lo registró. `tile-cache-sw.js` (cacheo offline de
tiles, ver ADR-026) intercepta las peticiones de tiles y las re-pide con un
`fetch()` interno propio del worker; la CSP general de la SPA
(`connect-src 'self' ws: wss:`, endurecida en la auditoría de seguridad
previa, ver ADR-043) mataba **cada** fetch externo al instante ("Failed to
fetch" en 0 ms) → tile roto. Como el fetch nunca tenía éxito, la caché
offline tampoco llegaba a poblarse nunca — era un fallo permanente desde que
se endureció la CSP, no un problema intermitente de red.

Al investigar el incidente se encontró además que el timeout fijo de 2.5s
del Service Worker (pensado para cortar rápido y caer a caché en modo
offline) se aplicaba también cuando **no había** copia en caché a la cual
caer — y que un `GetMap` de SENAMHI puede tardar ~3s por sí solo, y que la
ráfaga inicial de tiles de Leaflet (~18 tiles) contra el límite de 6
conexiones concurrentes por host del navegador encola los últimos tiles más
allá de ese timeout.

## Decisión

**CSP propia y acotada para el Service Worker de tiles**, separada de la CSP
general de la SPA: nueva `location = /tile-cache-sw.js` dedicada en
`nginx.conf`, servida con su propia cabecera
`Content-Security-Policy: default-src 'none'; connect-src 'self' https:`.
El permiso amplio (`connect-src https:`, necesario porque el campo "WMS
personalizado" del `MapViewer` admite cualquier GeoServer que el usuario
configure) queda acotado **solo** al script del worker — mismo criterio ya
usado para `img-src https:` en la CSP de la página. La CSP estricta del
resto de la SPA no cambia.

**Timeout adaptativo en el Service Worker**: el corte de red a 2.5s solo
aplica ahora cuando SÍ existe una copia en caché a la cual caer (ese es el
caso donde cortar rápido tiene sentido: mejor mostrar el tile viejo que
esperar). Sin respaldo en caché, el worker espera hasta 20s antes de darse
por vencido.

**Saneamiento del catálogo WMS** (`wmsCorporateCatalog.json` → v2,
re-probado en vivo el 2026-07-18, aprovechando la misma sesión de
diagnóstico):
- SENAMHI migrado de `/geoserver/wms` a `/geoserver/ows` — el alias `/wms`
  de ese servidor responde en >25s, mientras que `/ows` (mismo backend
  GeoServer, endpoint OGC estándar) responde con normalidad.
- El WMS público de MINAM (`geoservidor.minam.gob.pe`) fue dado de baja por
  la propia entidad (404 confirmado) — queda como plantilla manual en el
  catálogo en vez de un preset activo roto.
- La región INGEMMET pasa a ser la **primera** del catálogo, para que el
  preset por defecto que carga `MapViewer` al abrirse sea siempre una capa
  verificada funcionando — antes el preset por defecto caía en una
  plantilla vacía y el usuario veía "Complete URL y capa WMS" sin que nada
  cargara al primer intento.

## Consecuencias

### Positivas
- Los 9 tipos de tile del catálogo (base satelital + 8 WMS gubernamentales)
  vuelven a renderizar de forma verificable, no solo "por diseño".
- La caché offline de tiles (ADR-026) vuelve a poblarse — antes del fix
  nunca llegaba a tener éxito, así que el modo offline de mapas estaba roto
  de facto pese a que el código de caché en sí no tenía ningún bug.
- El criterio "CSP general estricta + excepción acotada donde el propio
  campo del producto exige flexibilidad (URL de WMS libre)" ya establecido
  para `img-src` se extiende de forma consistente al Service Worker.

### Negativas / Trade-offs
- Dos configuraciones de CSP a mantener en vez de una (la de la SPA y la del
  worker) — inherente a que ambas tienen necesidades reales distintas
  (`img-src` de tiles `<img>` vs. `fetch()` del worker), no una duplicación
  evitable.
- El timeout de 20s sin caché de respaldo es deliberadamente generoso para
  geoservidores de gobierno lentos — un usuario en una fuente WMS realmente
  caída (no solo lenta) puede esperar hasta 20s antes de ver el error, en
  vez de los 2.5s anteriores. Se acepta porque el escenario "sin caché
  previa" ya era el peor caso (no había nada mejor que mostrar de todas
  formas).

## Alternativas descartadas

### Relajar la CSP general de la SPA en vez de dar una propia al worker
Habría revertido parte del endurecimiento de ADR-043 (auditoría
pre-pentest) para toda la aplicación, no solo para el mecanismo de caché de
tiles — descartado por ampliar innecesariamente la superficie de ataque de
toda la SPA para resolver un problema acotado a un Service Worker.

### Quitar el Service Worker de caché de tiles en vez de arreglar su CSP
Elimina el incidente pero también el modo offline de mapas (ADR-026,
requisito de negocio ya entregado) — descartado.

## Referencias
- `frontend/nginx.conf` (`location = /tile-cache-sw.js`)
- `frontend/public/tile-cache-sw.js` (timeout adaptativo)
- `frontend/src/config/wmsCorporateCatalog.json` (v2, catálogo saneado)
- `frontend/src/components/Special/MapViewer.tsx` (preset por defecto)
- ADR-026 (cartografía offline — el Service Worker cuya CSP causó el
  incidente)
- ADR-043 (endurecimiento de seguridad pre-pentest — origen de la CSP
  general cuya interacción con el worker no se había probado en ese momento)
