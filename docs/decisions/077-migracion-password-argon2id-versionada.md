# ADR-077 — Migración versionada de contraseñas legacy a Argon2id

**Status**: implemented y desplegado; transición legacy operativa (2026-07-29)
**Fecha**: 2026-07-27
**Autores**: EC
**Ámbito**: plataforma
**Relación**: convierte el pendiente de ADR-043 en una decisión ejecutable; refina ADR-029/037/058/060.

## Contexto

`http_utils::hashPassword()` usa actualmente
`std::hash(salt + "::" + password)` y cae al literal
`mining_local_salt_change_me` cuando `BEEMETRY_AUTH_PASSWORD_SALT` no existe.
El runtime auditado continúa emitiendo esa advertencia.

Configurar simplemente un salt nuevo rompería todas las contraseñas actuales,
porque el esquema no guarda versión ni parámetros y la verificación recalcula
el hash con el único salt activo. Además, `std::hash` es rápido y no está
diseñado como función criptográfica de derivación de contraseñas. Por tanto,
el pendiente no se resuelve únicamente agregando una variable de entorno.

## Decisión

1. Adoptar **Argon2id** mediante una biblioteca mantenida del sistema. Cada hash
   almacenará versión, parámetros, salt aleatorio por usuario y resultado en
   un formato autocontenido verificable.
2. Agregar un esquema versionado, preferiblemente dentro del propio string
   (`$argon2id$...`); alternativamente, una columna `password_scheme` con
   migración explícita. Nunca inferir el algoritmo por longitud.
3. Mantener verificación legacy solo durante la transición:
   - si el hash es Argon2id, verificar con Argon2id;
   - si es legacy y la contraseña coincide, rehashear inmediatamente con
     Argon2id en la misma operación de login;
   - cuentas que no ingresen durante la ventana deberán completar un reset
     controlado antes de retirar el verificador legacy.
4. El antiguo salt se conservará temporalmente como secreto de migración,
   separado del nuevo pepper opcional. No se expondrá en logs ni respuestas.
5. Altas, cambios y resets de contraseña usarán Argon2id desde el primer
   despliegue. No se crearán hashes legacy nuevos.
6. La retirada del verificador legacy requiere evidencia de inventario:
   cero cuentas legacy activas o una decisión formal de reset para las
   restantes.

## Parámetros y operación

- Los parámetros de memoria/tiempo/paralelismo se medirán en el contenedor
  productivo y se fijarán por configuración versionada, con objetivo inicial
  de latencia compatible con login humano y resistencia offline.
- Antes del despliegue: backup, prueba de restauración, conteo de hashes por
  esquema y comunicación de la ventana.
- Después: smoke de alta/login/reset, prueba de rehash oportunista, auditoría
  de fallos y rollback que conserve la capacidad de verificar ambos formatos.

## Evidencia de implementación

- `hashPassword()` produce formato autocontenido `$argon2id$` con salt
  CSPRNG de 16 bytes y hash de 32 bytes.
- Parámetros por defecto: tiempo 3, memoria 65536 KiB, paralelismo 1; límites
  defensivos y configuración por entorno.
- `verifyPassword()` acepta Argon2id y el formato histórico durante la
  transición, con comparación constante para el legado.
- PostgreSQL y almacenamiento en archivo rehashean en el primer login legacy
  correcto. Altas y resets crean únicamente Argon2id.
- Catch2 aprobó hash con salts distintos, contraseña válida/inválida y
  detección del esquema legacy. El build productivo ejecutó `ctest` al 100 %.
- E2E: el usuario nuevo `admin_20260727163946086_6c28c6fb` quedó con esquema
  `argon2id` y longitud 97. La cuenta smoke legacy
  `admin_20260727134736203_30c24045` migró a `argon2id` tras un login correcto.
- Inventario final tras la regresión del 2026-07-29: 14 Argon2id y 40 legacy.
  Esas 40 cuentas no se resetean destructivamente: migrarán al próximo acceso
  o por reset administrado. El verificador legacy solo podrá retirarse cuando
  el conteo llegue a cero.

## Compatibilidad y conflictos

- **ADR-029**: no cambia JWT, cookies ni refresh; endurece la autenticación
  previa a emitir la sesión.
- **ADR-037**: el alta administrada sigue permitida sin biometría, pero toda
  contraseña nueva debe nacer en Argon2id.
- **ADR-043**: supersede únicamente la alternativa de “cambiar el salt y
  resetear todo” como única salida. La migración dual evita una interrupción
  masiva y cierra tanto el salt de desarrollo como `std::hash`.
- **ADR-058**: no reemplaza el pentest ni la auditoría; cierra un bloqueante
  conocido antes de someter el sistema a validación externa.
- **ADR-060**: requiere pruebas de hashes correctos/incorrectos, formatos
  corruptos, rehash legacy y parámetros mínimos.

## Consecuencias

### Positivas

- Resistencia adecuada frente a cracking offline de una base filtrada.
- Migración gradual sin invalidar de inmediato a todos los usuarios.
- Parámetros y algoritmo quedan versionados y auditables.

### Riesgos y controles

- Argon2id consume memoria deliberadamente; limitar concurrencia y medir bajo
  carga evita degradar el backend.
- Mantener verificación legacy demasiado tiempo conserva la debilidad; la
  transición necesita fecha límite y métrica.
- Un rollback debe conservar hashes Argon2id ya creados; nunca degradarlos a
  legacy.

## Alternativas descartadas

- **Solo cambiar `BEEMETRY_AUTH_PASSWORD_SALT`**: invalida credenciales y
  mantiene `std::hash`.
- **SHA-256 con salt global**: demasiado rápido para contraseñas.
- **Reset inmediato de toda la base sin transición**: posible como respuesta
  de emergencia, pero innecesariamente disruptivo como plan normal.

## Evidencia y referencias

- `backend/src/http/http_utils.cpp` (`hashPassword`)
- `backend/src/auth/auth_storage_pg.cpp`
- `backend/src/auth/auth_routes.cpp`
- `backend/src/main.cpp`
- ADR-043, ADR-029, ADR-037, ADR-058 y ADR-060.
