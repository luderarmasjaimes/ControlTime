# ADR-037 — Alta de usuarios administrada por un admin, sin biometría obligatoria

**Status**: accepted (implementado y verificado 2026-07-13)
**Fecha**: 2026-07-13
**Autores**: EC
**Ámbito**: plataforma

> Complementa ADR-029 (identidad de plataforma) y respeta el diferimiento de biometría de ADR-025.

**Actualización 2026-07-27:** ADR-076 implementa UUID compacto DB-safe y
CSPRNG. ADR-077 sustituye `std::hash` por Argon2id para toda contraseña nueva
y migra las antiguas al siguiente login correcto. Ninguna corrección convierte la
biometría en obligatoria ni cambia el tenant heredado del administrador.

## Contexto

El único flujo de alta de usuario existente hasta esta sesión era el auto-registro
(`POST /api/auth/register`), que **exige** `face_template` o `face_image_base64` en el
cuerpo de la request — diseñado para una persona que se registra a sí misma frente a
una cámara, con enrolamiento biométrico presencial en el mismo acto.

Ese flujo no cubre un caso de uso real y frecuente en operaciones multi-unidad: un
administrador necesita dar de alta a un usuario que **todavía no está físicamente en
sitio** (un supervisor recién contratado para otra unidad minera, un reemplazo antes de
su primer día). Exigir biometría en ese momento es imposible por diseño — no hay
cámara ni rostro que capturar todavía — y forzaba a los administradores a compartir
credenciales genéricas como workaround informal, una práctica insegura que este ADR
busca eliminar dándole una vía correcta.

## Decisión

Se agrega un endpoint administrativo, **`POST /api/auth/users/create`**, que crea una
cuenta completa **sin biometría**, protegido por el permiso `usuarios.manage` (no
accesible sin sesión de admin/manager con ese permiso — ver ADR-036 para el modelo de
roles/permisos).

### Comportamiento
- Valida campos obligatorios (`username`, `password` ≥ 8 caracteres, `first_name`,
  `last_name`, `dni`) y el `role` solicitado contra la lista de 7 roles válidos
  (ADR-036).
- Construye el `AuthUser` con `id = http_utils::makeId()` (mismo generador de
  pseudo-UUID ya usado por el auto-registro), `company = session->company` (hereda la
  empresa del admin emisor, no un valor arbitrario del body), `faceTemplate` vacío,
  `passwordHash = http_utils::hashPassword(password)`.
- Tras `registerUserPg`, inserta la fila de membresía en `auth_user_tenant (user_id,
  tenant_id, is_default=true, role)` usando el **tenant activo de la sesión del
  admin** — mismo principio de "nunca confiar en un tenant arbitrario del cliente" que
  ADR-038 formaliza para grant/revoke.
- El enrolamiento biométrico queda **diferido al primer login presencial** del nuevo
  usuario (mismo patrón de diferimiento ya aceptado en general por ADR-025) — no es una
  omisión, es una consecuencia de diseño explícita: la cuenta existe y tiene permisos
  desde su creación, pero solo puede iniciar sesión con contraseña hasta que alguien
  capture su rostro en un login real.

### Reglas duras
- Este endpoint nunca acepta `company`/`tenant_id` del cuerpo de la request para
  determinar dónde se crea la cuenta — siempre hereda el contexto de sesión del
  emisor, igual que ADR-038.
- La contraseña generada por este flujo pasa por el mismo `hashPassword()` que el
  auto-registro — no se introduce un segundo esquema de hash paralelo.

## Consecuencias

### Positivas
- Elimina la necesidad de compartir credenciales genéricas como workaround para altas
  remotas — cada usuario tiene su propia cuenta desde el primer día, con auditoría real
  de quién hizo qué (ADR-030 sigue aplicando, la cuenta ya es un `user_id` real desde su
  creación).
- Reutiliza al 100% la infraestructura de auth existente (`makeId`, `hashPassword`,
  `registerUserPg`) — no introduce un segundo modelo de usuario.

### Negativas / Trade-offs
- **Riesgo heredado, no agravado ni corregido por este ADR**: `hashPassword()`
  (`http_utils.cpp`) sigue siendo un `std::hash` salado simple, no `bcrypt`/`argon2`.
  Es una debilidad preexistente del esquema de auto-registro, reutilizada aquí sin
  cambios porque endurecerla es un cambio transversal (afecta también auto-registro y
  el flujo de cambio de contraseña) fuera del alcance de esta pieza — se señala
  explícitamente aquí para que quede visible en el radar de seguridad, no oculta detrás
  de "ya existía".
- Una cuenta creada por este flujo puede quedar indefinidamente sin biometría enrolada
  si el usuario nunca hace login presencial — el sistema no fuerza un plazo. Aceptado
  como trade-off operativo (no todo usuario de plataforma necesita biometría, p.ej.
  roles administrativos remotos que no acceden a áreas físicas).

### Neutras
- No cambia el modelo de datos de `auth_users` — la cuenta creada es indistinguible en
  esquema de una creada por auto-registro, salvo por tener `face_template` vacío hasta
  el primer login real.

## Alternativas descartadas

### Exigir biometría también en el alta administrada (subir una foto del nuevo usuario)
Reintroduce el mismo problema que se buscaba resolver: el admin normalmente no tiene
una foto válida/consentida del nuevo usuario en el momento del alta, y subir una foto
en su nombre sin que la persona esté presente es un patrón de captura biométrica sin
consentimiento directo — inaceptable dado el mismo criterio legal que ya diferido la
biometría en ADR-025.

### Extender `/api/auth/register` con un flag `skip_biometrics` en vez de un endpoint nuevo
Habría mezclado dos flujos de autorización muy distintos (auto-registro sin sesión
previa vs. alta administrada que requiere `usuarios.manage`) en un mismo handler,
complicando la lógica de permisos y aumentando el riesgo de que un flag opcional se
use accidentalmente para saltarse la biometría en el flujo de auto-registro público.
Un endpoint separado, con su propio gate de permiso, es más simple de auditar.

## Referencias
- `backend/src/auth/auth_routes.cpp::handleAdminCreateUser`
- `backend/src/http/http_utils.cpp` (`makeId`, `hashPassword`)
- ADR-025 (biometría diferida), ADR-029 (identidad/RBAC), ADR-030 (auditoría),
  ADR-036 (7 roles), ADR-038 (delegación de acceso multitenant)
