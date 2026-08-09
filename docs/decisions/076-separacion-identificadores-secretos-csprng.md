# ADR-076 — Separar identificadores UUID de secretos generados con CSPRNG

**Status**: implemented, probado y desplegado localmente (2026-07-29)
**Fecha**: 2026-07-27
**Autores**: EC
**Ámbito**: plataforma
**Relación**: refina ADR-029/037/043/060; hallazgo originado durante la verificación de ADR-075.

## Contexto

El smoke de autenticación encontró altas intermitentes con `failed to insert
user`. La causa no era una colisión de DNI: `http_utils::makeId()` convertía
dos enteros de 64 bits a hexadecimal sin rellenar ceros a la izquierda. El
resultado podía tener menos de 32 caracteres y PostgreSQL lo rechazaba al
insertarlo en `auth_users.id UUID`.

La revisión transversal encontró un problema arquitectónico adicional:
`makeId()` no solo crea identificadores. También alimenta `jti`, refresh
tokens y claves de dispositivos. Su implementación usa `std::mt19937_64`
sembrado una vez con `std::random_device`; es apropiada para identificadores
no secretos con baja probabilidad de colisión, pero no establece una garantía
criptográfica suficiente para credenciales.

## Decisión

1. `makeId()` queda reservado para identificadores no secretos. Su contrato
   mínimo inmediato es devolver exactamente 32 caracteres hexadecimales,
   aceptados por PostgreSQL como representación compacta de UUID.
2. Los secretos de autenticación deben migrar a una función distinta,
   `secureRandomHex(bytes)`, basada en el CSPRNG de OpenSSL (`RAND_bytes`) y
   con fallo cerrado si el generador seguro no está disponible.
3. Refresh tokens y claves de dispositivo usarán al menos 256 bits aleatorios.
   `jti` puede usar UUID v4 o 128 bits CSPRNG porque identifica un JWT, pero
   nunca debe reutilizar una credencial.
4. Los secretos continúan persistidos únicamente como SHA-256; el valor crudo
   se entrega una sola vez. La separación cambia su generación, no el modelo
   de almacenamiento de ADR-029.
5. Los tokens ya emitidos pueden vencer o rotarse normalmente. No se requiere
   invalidación masiva; todo token nuevo posterior al despliegue debe usar el
   generador seguro.
6. ADR-060 deberá cubrir: longitud/formato de IDs, múltiples generaciones,
   longitud de secretos y fallo explícito del CSPRNG. No se usarán pruebas
   estadísticas superficiales como sustituto de revisar la fuente de entropía.

## Estado de implementación

- `secureRandomHex(bytes)` usa `RAND_bytes` y falla cerrado.
- `makeId()` genera 128 bits CSPRNG con 32 caracteres hexadecimales fijos.
- Refresh tokens y `jti` usan 256 bits; las API keys de dispositivos usan
  256 bits más el prefijo no secreto `dev_`.
- Catch2 verifica formato, 256 IDs únicos y secretos independientes. La
  compilación productiva ejecuta `ctest`: 100 % aprobado.
- La imagen final `3c6acc4d30a1` se desplegó y el smoke real del 2026-07-29
  completó registro, contraseña, rostro, refresh/CSRF, auditoría/CSV y logout.

## Compatibilidad y conflictos

- **ADR-029**: conserva JWT corto, refresh opaco, hashing y rotación. Este ADR
  hace explícita la fuente de aleatoriedad requerida por la palabra “secreto”.
- **ADR-037**: el alta administrada conserva el mismo tipo UUID; se elimina el
  fallo intermitente sin cambiar endpoint ni esquema.
- **ADR-043**: amplía el hardening pre-pentest. Una credencial no debe depender
  de un PRNG general aunque luego se almacene hasheada.
- **ADR-060**: no contradice que Catch2 sea opcional en la imagen productiva;
  exige agregar regresiones al corredor `Dockerfile.verify`.
- **ADR-075**: país, idioma y documento fiscal no participan en la generación
  de IDs; el defecto solo fue descubierto por su smoke E2E.

## Consecuencias

### Positivas

- El alta deja de fallar aleatoriamente por IDs de longitud variable.
- Se elimina la ambigüedad entre “identificador único” y “secreto
  impredecible”.
- La migración de tokens puede ser gradual y sin cierre de sesiones masivo.

### Riesgos y controles

- La disponibilidad de OpenSSL es obligatoria; no existe fallback a PRNG
  general ni a un valor predecible.
- Los IDs compactos existentes siguen siendo válidos. No se reescriben claves
  primarias ni relaciones históricas.
- Si `RAND_bytes` falla, emitir un secreto débil como fallback está prohibido.

## Alternativas descartadas

- **Usar `makeId()` para todo después de rellenar ceros**: corrige el formato,
  no la impredecibilidad de secretos.
- **Generar todos los UUID en frontend**: amplía la superficie de confianza y
  no resuelve tokens del backend.
- **Rotar inmediatamente todos los refresh tokens/API keys existentes**:
  innecesario para adoptar generación segura hacia adelante y operacionalmente
  disruptivo.

## Evidencia y referencias

- `backend/src/http/http_utils.cpp` (`makeId`)
- `backend/src/auth/auth_session.cpp` (`makeSessionToken`)
- `backend/src/mining/device_alarm_routes.cpp` (`rawApiKey`)
- `backend/src/auth/auth_storage_pg.cpp` (`auth_users.id`)
- `scripts/smoke-auth-e2e.ps1`
- Build Docker/CMake del backend: 100 %.
