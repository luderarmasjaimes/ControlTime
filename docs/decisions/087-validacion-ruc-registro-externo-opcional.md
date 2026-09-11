# ADR-087 — Validación de RUC: excepción opcional y acotada a ADR-001 para consulta externa

> **Actualización 2026-09-11 — Gerencia confirma el requisito de negocio:
> validación externa real obligatoria para Perú.** Cierra, junto con la
> actualización de ADR-035, la decisión pendiente del corte gerencial del
> 2026-09-10. Confirmado: la empresa necesita validar que el RUC/empresa
> registrada en la plataforma sea real, vía el servicio web de SUNAT (o un
> proveedor que lo re-exponga, dado que SUNAT no publica API oficial
> gratuita — ver Contexto original de este ADR). **Esto confirma la
> política (sí, se requiere); no reemplaza el paso operativo que el punto 3
> de la Decisión original ya dejaba pendiente**: elegir un proveedor
> concreto (`peruapi.com`/`apis.net.pe`/otro) y proveer su token —
> `BEEMETRY_TAX_REGISTRY_ENABLED` sigue en `false` por defecto hasta que
> eso se resuelva; el código ya está listo para activarse sin otro cambio
> de C++.
>
> **Para el resto de LATAM (Brasil, Ecuador, Chile y demás países donde la
> empresa ya opera)**: se confirma que se buscarán mecanismos de validación
> externa equivalentes **cuando se implemente cada mercado**, no de forma
> inmediata ni simultánea. Hoy el checksum local ya cubre Perú, Brasil
> (CNPJ, este mismo ADR) y Ecuador/Chile/Costa Rica (ADR-102) — es
> validación de formato, no de registro real contra un padrón oficial. La
> validación externa tipo SUNAT para esos países queda como trabajo futuro,
> sin proveedor ni fecha todavía, a definir país por país cuando haya
> pedido de negocio concreto (mismo criterio que este ADR ya aplicó a
> Perú).

> **Actualización 2026-09-11 (segunda pasada, mismo día) — proveedor
> contratado y activado, verificado en vivo.** El developer proveyó un API
> key real de **Chequea** (`https://chequea.pe`, `GET
> https://api.chequea.pe/api/v1/ruc/{ruc}`, `Authorization: Bearer <token>`).
> Configurado en `.env` local (gitignored, nunca en un archivo versionado —
> `BEEMETRY_TAX_REGISTRY_TOKEN` es secreto real; `.env.example` documenta
> solo el host/path template, con el valor de token vacío). El esquema de
> respuesta de Chequea
> (`razonSocial`, `estado`, `condicion`, `direccion`) ya calzaba sin cambios
> con los nombres alternativos que `firstStringField()` ya probaba desde
> 2026-08-05 — cero cambios de parsing necesarios.
>
> **Bug real encontrado y corregido, nunca antes probado en vivo** (el
> propio ADR ya advertía: "la funcionalidad de consulta existe en código
> pero no está activa"): el primer intento devolvió `registry:"unavailable"`
> — `tax_registry_client.cpp` fijaba el contexto TLS a
> `ssl::context::tlsv12_client` (TLS 1.2 EXCLUSIVAMENTE, no "1.2 como
> mínimo"), y Chequea (detrás de Cloudflare) rechaza TLS 1.2 con un alert
> fatal `protocol_version` — confirmado aislando la causa con `openssl
> s_client -tls1_2` contra `api.chequea.pe` dentro del propio contenedor
> `beemetry-api`. Corregido a `ssl::context::tls_client` (negocia la
> versión más alta soportada por ambos lados), el mismo patrón que ya usan
> el resto de clientes HTTPS de este backend (`geocode_proxy.cpp`,
> `wms_proxy.cpp`, `whatsapp_client.cpp`) — `tax_registry_client.cpp` era
> el único que seguía fijado a 1.2. Rebuild (`docker compose build web`,
> limpio) y redeploy contra el `beemetry-api` real.
>
> **Verificado en vivo** contra `GET /api/auth/validate-company?ruc=20100070970&country=PE`
> (RUC público de ejemplo de la propia documentación de Chequea, sin datos
> de tenant real): `{"valid":true,"registry":"confirmed","registry_razon_social":"SUPERMERCADOS
> PERUANOS SOCIEDAD ANONIMA 'O ' S.P.S.A.","registry_estado":"ACTIVO"}` —
> antes del fix, el mismo request devolvía `registry:"unavailable"`. No se
> corrió el suite completo de CTest en esta pasada (cambio acotado a un
> cliente HTTPS aislado, sin tocar rutas de auth/biometría probadas); queda
> pendiente para la próxima verificación de build integral.
>
> Pendiente real, no resuelto acá: probar el camino `not_found` (RUC válido
> por checksum pero inexistente en el padrón) y el camino de rate-limit
> (`429`, plan Free de Chequea: 25.000 requests/mes, 300 rpm) contra tráfico
> real de registro.

**Status**: implemented (checksum extraído + fix del bug de nombre; cliente externo detrás de flag apagado por defecto, sin proveedor contratado — ver Decisión punto 3)
**Fecha**: 2026-08-05
**Autores**: EC
**Ámbito**: plataforma
**Relación**: excepción explícita y acotada a ADR-001 (`despliegue-soberano-on-prem`); extiende ADR-085 (POST/PUT de empresas ya validaban RUC por checksum, esto agrega la consulta opcional); cierra el Hallazgo A de `docs_/01_Planificacion/Auditoria_Registro_RUC_Tenant_2026-07-21.md`.

## Contexto

Gerencia pidió "realizar la validación del RUC Y EXTRAER LA INFORMACIÓN DE
LA EMPRESA DESDE LA PÁGINA DE LA SUNAT QUE DEBE DE TENER UN ENDPOINT DE
CONSULTA GRATUITA". Se investigó antes de implementar (no se asumió que
existiera): **SUNAT no publica una API REST oficial y gratuita** — el único
servicio real es el portal HTML `e-consultaruc.sunat.gob.pe`, pensado para
un navegador, no para integración programática. Los servicios "gratuitos"
que sí existen (`peruapi.com`, `apis.net.pe`, `consultaperuapi.com`,
`peruapis.com`, scrapers vía Apify) son todos **terceros no oficiales** que
re-exponen datos de SUNAT, típicamente con token y límite de uso.

Esto choca con **ADR-001** (`despliegue-soberano-on-prem`): "todo on-prem
... sin nube externa para dato crítico". Llamar a un tercero para verificar
un RUC es, en sentido estricto, una dependencia externa — aunque el dato
consultado (razón social/estado de una empresa) es público y no crítico
para la operación (a diferencia de telemetría o datos de cliente).

También se confirmó un bug real y ya documentado
(`Auditoria_Registro_RUC_Tenant_2026-07-21.md`, Hallazgo A): `GET
/api/auth/validate-company` recibía `company` y `ruc` por query pero solo
validaba el RUC — el nombre de empresa nunca se comparaba contra nada.

## Decisión

1. **El checksum local (correcto, no se toca)** se extrae de
   `auth_routes.cpp` a `backend/src/auth/tax_id.{hpp,cpp}`
   (`validateTaxIdChecksum`) sin cambiar el algoritmo: Perú (mod-11, pesos
   `{5,4,3,2,7,6,5,4,3,2}`, prefijos `10/15/17/20`), Brasil (CNPJ), US/CA.
   Se preserva textualmente el comportamiento de fallback preexistente
   (un RUC de 11 dígitos válida como PE aunque `country` declare otra
   cosa) — no es una regla nueva de este ADR, es el comportamiento que ya
   tenía el endpoint.
2. **Fix del Hallazgo A**: `GET /api/auth/validate-company` ahora compara
   `company` (si viene) contra `auth_companies` por `lower(btrim(name))` y
   devuelve `company_known`/`ruc_matches_company` — aditivo, no rompe al
   único consumidor real (`authApi.ts::validateCompany`, que solo lee
   `payload.valid`).
3. **Consulta externa: excepción explícita, opcional, apagada por
   defecto.** Nuevo cliente `backend/src/auth/tax_registry_client.{hpp,cpp}`
   habla con un proveedor de terceros configurable vía
   `BEEMETRY_TAX_REGISTRY_ENABLED` (default `false`),
   `BEEMETRY_TAX_REGISTRY_HOST`, `_PATH_TEMPLATE` (con placeholders
   `{ruc}`/`{token}`), `_TOKEN`, `_TIMEOUT_MS` (default 2500ms). **Nadie ha
   contratado un proveedor todavía** — el flag queda apagado y sin host
   configurado hasta que Gerencia elija uno (peruapi.com/apis.net.pe/otro)
   y provea su token; el código queda listo para conectarlo sin otro
   cambio de C++.
4. **Contrato de fallback, sin excepciones**: si el flag está apagado, el
   host no está configurado, o el proveedor no responde a tiempo
   (`available=false`), el comportamiento es **exactamente el de hoy**
   (solo checksum) — la consulta externa nunca bloquea un alta ni una
   edición. `GET /api/auth/validate-company` agrega `registry:
   "disabled"|"unavailable"|"not_found"|"confirmed"` al payload,
   estrictamente informativo.
5. **Reutiliza el patrón TLS ya probado** en `text_spell_service.cpp`
   (Beast+OpenSSL síncrono, verificación de certificado contra CAs del
   sistema) — no se agrega libcurl ni ninguna dependencia nueva.

## Consecuencias

- Se cierra el bug real de Hallazgo A sin esperar a que exista un
  proveedor SUNAT contratado.
- La excepción a ADR-001 queda **documentada y acotada** (dato público, no
  crítico, apagada por defecto, sin dependencia dura) en vez de ser una
  brecha implícita descubierta después por auditoría.
- Activar la consulta real es, a partir de ahora, una decisión de
  configuración (elegir proveedor + setear 4 variables de entorno), no un
  cambio de código.

### Negativas / Trade-offs
- Ningún RUC del seed de prueba (ADR-088) ni de la operación real de hoy
  está verificado contra el padrón real — la funcionalidad de consulta
  existe en código pero no está activa. Gerencia debe decidir y contratar
  un proveedor si quiere el dato verificado, no solo el checksum.
- Los proveedores disponibles no son SUNAT — son intermediarios; su
  disponibilidad/exactitud no está bajo control de esta plataforma. El
  `available=false` en cualquier falla es la mitigación de ese riesgo.

## Alternativas descartadas

- **No integrar nada (solo checksum)**: descartado porque Gerencia pidió
  explícitamente la consulta al padrón, y dejar el cliente listo (aunque
  apagado) cuesta lo mismo en código y ahorra una vuelta completa de
  desarrollo cuando se elija proveedor.
- **Integrar como obligatoria (bloqueante)**: descartado — rompería
  ADR-001 de verdad (dependencia dura de un tercero para una operación
  core de la plataforma) y dejaría el alta de empresas indisponible si el
  proveedor cae.
- **Scrapear directamente `e-consultaruc.sunat.gob.pe`**: descartado —
  es un portal HTML pensado para navegador (probablemente con
  CAPTCHA/anti-bot), no una API; frágil y de mantenimiento no razonable
  para este alcance.

## Referencias

- `backend/src/auth/tax_id.hpp` / `.cpp`
- `backend/src/auth/tax_registry_client.hpp` / `.cpp`
- `backend/src/auth/auth_routes.cpp` (`GET /api/auth/validate-company`)
- `backend/src/config/app_config.hpp` / `.cpp` (`gTaxRegistry*`)
- `docker-compose.yml` (env `BEEMETRY_TAX_REGISTRY_*`)
- `docs_/01_Planificacion/Auditoria_Registro_RUC_Tenant_2026-07-21.md` (Hallazgo A)
- ADR-001 (`despliegue-soberano-on-prem`)
