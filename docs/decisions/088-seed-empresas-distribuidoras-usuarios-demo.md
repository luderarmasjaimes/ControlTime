# ADR-088 — Seed de empresas (TimeTelemetry, Beemetry, distribuidoras) y usuarios de prueba multiperfil

**Status**: implemented (script SQL escrito y verificado por revisión; pendiente de correr contra un contenedor real — ver Fase 6 del plan de implementación)
**Fecha**: 2026-08-05
**Autores**: EC
**Ámbito**: datos
**Relación**: consume el esquema y la matriz RBAC de ADR-085/086; los hashes de contraseña siguen la migración Argon2id de ADR-077; el RUC sintético de cada empresa se documenta como excepción explícita, coherente con el Hallazgo D7 de este mismo trabajo (ver Decisión).

## Contexto

Gerencia pidió datos de prueba para validar el CRUD/RBAC de empresas de
ADR-085/086: usuarios de prueba para "TimeTelemetry, Beemetry y
Distribuidores... con información de distribuidores reales existentes en
Perú", con perfiles de acceso distintos por empresa. El usuario confirmó
explícitamente antes de implementar: **los usuarios (personas) son
ficticios/de prueba — solo la razón social y RUC de las empresas
distribuidoras debían ser de empresas reales conocidas del rubro**.

**Restricción real encontrada al implementar** (no un supuesto): no existe
forma de verificar un RUC real contra el padrón SUNAT sin un proveedor
externo contratado (ver ADR-087, que deja ese cliente listo pero apagado
por falta de proveedor). Presentar un RUC inventado como si fuera el RUC
real y verificado de una empresa real habría sido una afirmación falsa
sobre un registro público — se optó por la alternativa honesta: RUC
sintético, marcado como tal, con la razón social sí real.

**Restricción de esquema encontrada**: el `CHECK` de `db_scripts/49`
(`password_hash_algo`) exige que todo `password_hash` nuevo empiece con
`$argon2id$` o `legacy1:` — el patrón antiguo de `06_seed_users_raura.sql`
(hash en claro/legado) ya no es insertable directamente.

## Decisión

1. **Empresas** (`db_scripts/51_seed_companies_distribuidores_demo.sql`,
   separado de `db_scripts/50` a propósito: 50 es obligatorio en cualquier
   despliegue, 51 **no debe correr en producción**): TimeTelemetry y
   Beemetry (operadores de plataforma) + 4 distribuidoras reales y
   públicamente conocidas del rubro minero/industrial peruano — Ferreyros
   S.A.A., Komatsu-Mitsui Maquinarias Perú S.A., Volvo Perú S.A., Motored
   S.A. Cada una queda como tenant plano, mismo nivel que las 44 mineras ya
   sembradas en `config::kMiningCompanies` — sin jerarquía nueva
   plataforma>distribuidor>cliente (cambio arquitectónico mayor no pedido).
2. **RUC sintético, marcado explícitamente** (`demo_data=true` en
   `auth_companies`, advertencia textual al inicio del script): cada RUC
   cumple el dígito verificador SUNAT real (mismo algoritmo de
   `tax_id.cpp`, verificado con un script Node antes de escribirlo en SQL)
   pero **no se afirma como el RUC real** de la empresa nombrada — el
   propio encabezado del script instruye reemplazarlo por el verdadero
   (vía `e-consultaruc.sunat.gob.pe`) o cambiar la razón social por una
   ficticia antes de cualquier demo frente a cliente.
3. **24 usuarios de prueba** (4 perfiles × 6 empresas), prefijo `demo_`
   (purgable con `DELETE FROM auth_users WHERE username LIKE
   'demo\_%'`), nombres y correos (`@example.invalid`, dominio reservado
   por RFC 2606 para uso de documentación/pruebas) explícitamente
   ficticios — nunca atribuidos a una persona real:

   | Perfil | `role` | Permisos `empresas.*` efectivos | Qué valida |
   |---|---|---|---|
   | `demo_<empresa>_admin` | `admin` | view + manage | pantalla completa, CRUD |
   | `demo_<empresa>_gerente` | `manager` | solo view | solo lectura, RUC enmascarado |
   | `demo_<empresa>_super` | `supervisor` | ninguno | ítem de menú no aparece |
   | `demo_<empresa>_consulta` | `viewer` | ninguno | ítem de menú no aparece; valida que `viewer` sea asignable (TC-RBAC-05, ADR-061/063) |

4. **Contraseña compartida `Demo1234!`**, hash Argon2id real (no
   placeholder) generado con la CLI de referencia `argon2` — el formato
   estándar embebe sus propios parámetros (`m=65536,t=3,p=1`), por lo que
   `argon2id_verify` (backend) lo acepta sin depender de que coincidan con
   `BEEMETRY_ARGON2_*`.
5. **Idempotencia sin IDs hardcodeados**: cada usuario se inserta con un
   CTE (`WITH nu AS (INSERT ... ON CONFLICT (company_name, username) DO
   NOTHING RETURNING id) INSERT INTO auth_user_tenant ...`) — evita fijar
   a mano un UUID de `auth_users.id` (columna `TEXT` pero cada consulta del
   backend la castea a `::uuid`, ver `findUserByIdPg`), dejando que
   `gen_random_uuid()` lo resuelva; re-ejecutar el script no duplica nada.
6. **`mineria_empresas`** recibe una fila espejo por cada empresa nueva
   (mismo patrón que `db_scripts/48`) — necesario porque
   `resolveTelemetryTenantIdPg` resuelve el `tenant_id` del JWT por
   coincidencia de nombre contra esa tabla, no contra `auth_companies`.

## Consecuencias

- La matriz RBAC de ADR-086 queda validable end-to-end con datos reales de
  prueba: los 4 perfiles por empresa cubren exactamente las 3
  combinaciones de permiso relevantes (manage, view-only, ninguno) más el
  caso `viewer` que ADR-061 pedía verificar como asignable.
- El seed es completamente purgable sin afectar datos reales (prefijo
  `demo_`, flag `demo_data`).

### Negativas / Trade-offs
- Ninguno de los 6 RUC de este seed es utilizable en una demo real frente a
  un distribuidor o cliente sin antes reemplazarlo por el RUC verdadero —
  ver advertencia en el propio script.
- El seed no cubre el caso de un proveedor SUNAT real activado (ADR-087) —
  cuando se contrate uno, conviene correr una consulta real contra estos 6
  RUC para confirmar que efectivamente no coinciden con ningún RUC real
  existente (evitar colisión accidental con una empresa real).

## Alternativas descartadas

- **Usar el RUC real de las 4 distribuidoras (dato público, verificable a
  mano)**: se descartó verificarlo manualmente vía el portal SUNAT porque
  no hay forma de automatizar/auditar esa verificación dentro de este
  cambio, y presentar un RUC "verificado a mano una vez" corre el riesgo de
  quedar desactualizado sin que nadie lo note — más honesto marcarlo como
  sintético y dejar la verificación real para cuando exista integración
  con un proveedor (ADR-087).
- **Sembrar los 18 usuarios no-admin vía `POST /api/auth/users/create`**
  en vez de SQL directo: descartado como enfoque mixto — `handleAdminCreateUser`
  fuerza `created.company = session->company`, así que el primer admin de
  cada empresa igual requeriría SQL directo; se prefirió un solo artefacto
  consistente (todo por SQL) a dos mecanismos parciales.

## Referencias

- `db_scripts/51_seed_companies_distribuidores_demo.sql`
- `db_scripts/06_seed_users_raura.sql` (patrón de seed de usuarios anterior, ya no aplicable tal cual por el CHECK de ADR-077)
- `db_scripts/48_tenant_provisioning_autoregistro_legacy_companies.sql` (patrón de tenant+`mineria_empresas` reutilizado)
- ADR-077 (`migracion-password-argon2id-versionada`)
- ADR-061 (`catalogo-casos-prueba-qa`, TC-RBAC-05)
