# ADR-060 — Framework de pruebas automatizadas del backend: Catch2 v3

**Status**: implemented, verificado con evidencia caso por caso (2026-07-21). `beemetry_backend_tests` compila y linkea limpio contra GCC 13.3 (Ubuntu 24.04, mismo toolchain de producción, vía `backend/Dockerfile.verify`). `ctest`: **100% tests passed, 0 failed**. Corrida directa del binario con reporte detallado (`-s -r compact`): **27 aserciones en 7 test cases, todas passed** (cada aserción individual verificada valor-a-valor, no solo el resultado agregado).
**Fecha**: 2026-07-20
**Autores**: EC
**Ámbito**: plataforma

**Actualización 2026-07-27:** Catch2 y `ctest` se integraron en la etapa
builder productiva: la imagen no se genera si falla el backend. ADR-076/077
añaden regresiones de formato/unicidad CSPRNG, secretos de 256 bits, Argon2id
con salt aleatorio, contraseña inválida y detección/verificación legacy. La
última compilación reportó **100 % tests passed, 0 failed**.

## Contexto

El relevamiento hecho para redactar el Plan Maestro de Pruebas QA (ADR-059) confirmó que el backend C++ **nunca tuvo un solo test automatizado**: cero archivos de test bajo `backend/`, sin GoogleTest/Catch2/doctest, sin target de test en `CMakeLists.txt`. El frontend sí tiene cobertura real (Vitest: 5 suites; Playwright: 5 specs e2e) — la brecha es específicamente del lado del servidor.

Esto es una brecha real y no solo teórica: el módulo `http_utils.cpp` acaba de recibir el cambio de seguridad de esta semana (refresh token → cookie `HttpOnly` + CSRF de doble envío, ver ADR-029 "Actualización 2026-07-19") sin que exista ningún test de regresión que proteja ese parseo — un futuro cambio en `extractCookie()` (p.ej. al tocar el manejo de espacios o el separador `;`) podría romper silenciosamente la autenticación de toda la plataforma sin que ningún build lo detecte.

## Decisión

Adoptar **Catch2 v3** (paquete `catch2` de los repositorios oficiales de Ubuntu 24.04 — `apt-get install catch2`, sin compilar desde fuente) como framework de pruebas unitarias/de integración del backend. Se eligió consistencia con el resto del `Dockerfile`: todas las demás dependencias (Boost, OpenCV, libpq, librdkafka, libmodbus) vienen de `apt`, no de vcpkg ni vendorizadas — Catch2 sigue ese mismo patrón.

Nuevo target de CMake `beemetry_backend_tests`, **opcional** (guardado con `find_package(Catch2 3 QUIET)`, mismo criterio ya usado para `open62541`/`librdkafka`: si el paquete no está instalado, el resto del build no se ve afectado — el `Dockerfile` de producción no lo instala, para no engordar la imagen final con dependencias de test).

Primer archivo de test: `backend/tests/test_http_utils.cpp`, cubriendo exactamente el módulo que motivó esta necesidad — lógica **pura** (parseo de strings, hashing determinístico) sin I/O de red ni de base de datos:
- `extractCookie()`: una cookie, varias cookies, cookie inexistente, sin header `Cookie`, colisión de nombre-prefijo (`csrf_token_old` vs `csrf_token` — el caso real que motivó el chequeo de límite exacto en el parser), valor vacío (cookie recién vencida).
- `hashPassword()`: determinístico para la misma entrada, distinto para entradas distintas.
- `safeStod()` / `safeStoi()`: fallback ante `nullptr`, cadena vacía, valor no numérico.
- `csvEscape()`: solo entrecomilla cuando hace falta (coma, comillas, salto de línea).
- `urlDecode()`: percent-encoding y `+` como espacio.

### Reglas duras
- El target de tests **nunca** incluye `src/main.cpp` (tiene su propio `main()` — Catch2 provee el suyo vía `Catch2::Catch2WithMain`).
- Los primeros tests deben ser lógica pura, sin dependencias externas levantadas (Postgres, Redpanda, etc.) — módulos con I/O real (`auth_session.cpp` con Postgres, `mining/*`) quedan para una fase posterior con fixtures/mocks, fuera del alcance de este ADR (ver cronograma de ADR-059).
- Corredor: `ctest` (`add_test(NAME backend_unit_tests COMMAND beemetry_backend_tests)`), no un script custom — mismo comando en local, en `Dockerfile.verify` y en cualquier CI futuro.

## Consecuencias

### Positivas
- Primer test de regresión real protegiendo exactamente la lógica de cookies/CSRF recién escrita — un cambio futuro que rompa el parseo de `extractCookie()` ahora falla el build, no la producción.
- Pieza verificable y concreta del "Plan Maestro de Pruebas QA" que exige el SOW en el sprint actual (S4/R2) — no es solo un documento, hay un target que compila y corre.
- No invasivo: el `Dockerfile` de producción no cambia (no instala Catch2), la imagen final no engorda.

### Negativas / Trade-offs
- Cobertura inicial muy acotada — un archivo, un módulo. El grueso de la lógica de negocio (`auth_session.cpp`, `reports/*`, `mining/*`) sigue sin test automatizado; probarla bien requiere una base de datos de prueba o mocks, que es trabajo de la fase 2 descrita en ADR-059, no de este ADR.
- Un desarrollador que compile localmente sin `catch2` instalado no corre los tests (silencioso, no falla el build) — trade-off deliberado para no forzar una dependencia nueva a todo el equipo de un día para otro; `Dockerfile.verify` sí la fija.

### Neutras
- `backend/Dockerfile.verify` (build de verificación rápida, sin ONNX/open62541/modelos pesados) es el que instala `catch2` y corre `ctest --output-on-failure` como parte del build — es el candidato natural para engancharse a CI en el futuro (ver ADR-059).

## Alternativas descartadas

### GoogleTest
Más adoptado en general, pero no está empaquetado para instalación directa y simple vía `apt` en Ubuntu 24.04 de la misma forma que Catch2 (típicamente requiere `FetchContent` o vcpkg) — se descarta por la fricción adicional en el `Dockerfile`, que hoy resuelve todo vía `apt-get install`.

### doctest
Filosofía similar a Catch2 (header-only, sintaxis parecida) pero con muchísima menor adopción/documentación y tampoco empaquetado en `apt` de Ubuntu 24.04 — habría que vendorizar el header manualmente. No reduce fricción real frente a Catch2.

### Vendorizar Catch2 (header-only, sin depender del paquete del sistema)
Evita depender de la versión que empaqueta Ubuntu, pero duplica una dependencia que el sistema operativo ya mantiene actualizada — se prefiere `apt`, consistente con el resto de las dependencias del `Dockerfile` (ninguna otra está vendorizada).

## Referencias
- `backend/CMakeLists.txt` (target `beemetry_backend_tests`)
- `backend/tests/test_http_utils.cpp`
- `backend/Dockerfile.verify` (`catch2` + `ctest --output-on-failure`)
- ADR-029 ("Actualización 2026-07-19" — el módulo bajo test, `http_utils.cpp`, implementa `extractCookie`/`setAuthCookies`/`clearAuthCookies`)
- ADR-059 (Plan Maestro de Pruebas QA — este ADR es la decisión de tooling backend dentro de ese plan)
