# ADR-102 — Validación fiscal: Ecuador, Chile, Costa Rica y fallback estructural para el resto del catálogo

**Status**: implemented (2026-08-08)
**Fecha**: 2026-08-08
**Autores**: EC
**Ámbito**: plataforma
**Relación**: extiende ADR-075 (i18n país/idioma) y ADR-087 (validación RUC
registro externo opcional); motivado por una necesidad de negocio concreta
comunicada durante la sesión (proyectos activos en Ecuador/Chile/Brasil/
EE.UU./etc. y un proveedor con sede en Costa Rica que necesita registrarse);
aterriza en código lo que ADR-035 (plataforma enterprise LATAM) plantea como
visión — sin implicar su topología edge+hub, ver Contexto.

## Contexto

El usuario reportó que la plataforma debe ser enterprise para LATAM con
proyectos ya activos en Ecuador, Chile, Brasil, EE.UU. y otros países, más
un proveedor con sede en Costa Rica que quiere registrarse **ahora**. Antes
de asumir que esto requería la topología edge+hub de ADR-035 (que resuelve
soberanía de datos y despliegue distribuido — un proyecto de meses), se
verificó qué bloqueaba concretamente el caso descrito:

- **Catálogo de países**: ya tenía Ecuador, Chile, Costa Rica y 27 países
  más de LATAM/Caribe (`db_scripts/16` y `25`) — no era un hueco real.
- **Idioma**: los tres países usan español, ya cubierto por el diccionario
  de ADR-075 — tampoco era un hueco real.
- **Validación de identificador fiscal** (`tax_id.cpp`,
  `validateTaxIdChecksum`): solo tenía algoritmo real para Perú, Brasil,
  US/Canadá. Cualquier otro país del catálogo — incluidos los tres
  mencionados — caía en `return false` sin condición, es decir, **el
  registro de una empresa de Ecuador, Chile o Costa Rica (o cualquiera de
  los otros 24 países del catálogo) era rechazado siempre**, sin importar
  qué identificador fiscal real se ingresara.

Esto sí era un bloqueador real y concreto para el caso descrito — a
diferencia de ADR-035 (que resuelve un problema de infraestructura/
soberanía que no aplica todavía a "un proveedor quiere registrarse").

## Decisión

1. **Ecuador (RUC, 13 dígitos)**: algoritmo oficial del SRI completo —
   código de provincia (01-24 o 30), y una de tres variantes según el
   tercer dígito: persona natural (0-5, módulo 10 tipo Luhn), sociedad
   privada/extranjera (9, módulo 11 sobre 9 dígitos), entidad pública (6,
   módulo 11 sobre 8 dígitos). Verificado a mano contra dos ejemplos
   reales conocidos (`1792146739001` sociedad, `1710034065001` persona
   natural) antes de escribir el código — ambos coinciden con el dígito
   verificador calculado.
2. **Chile (RUT)**: algoritmo módulo 11 estándar, dígito verificador
   final que puede ser la letra `K`. Requirió tocar `normalizeTaxId()`
   (antes eliminaba todo carácter no numérico, lo que borraba la `K`
   antes de llegar a la validación) para conservarla si es el último
   carácter no vacío del input crudo — cambio con efecto nulo en los
   demás países (ninguno usa letras). Verificado contra un RUT real
   conocido (`76.086.428-5`).
3. **Costa Rica (cédula jurídica, 10 dígitos)**: **sin** dígito
   verificador matemático — se buscó una fuente pública confiable del
   algoritmo real y no se encontró una lo suficientemente autorizada
   para implementarla con la misma confianza que Ecuador/Chile/Perú/
   Brasil. Se valida solo la forma (10 dígitos, sin cero inicial, no
   todos repetidos), documentado explícitamente como "sin checksum
   real" en el código y en este ADR — se prefiere ser honesto sobre la
   limitación a inventar una fórmula sin fuente confirmada.
4. **Fallback estructural genérico** para el resto del catálogo (~24
   países: México, Colombia, Argentina, Guatemala, Panamá, etc.): acepta
   6-15 dígitos, no todos repetidos, sin afirmar un dígito verificador
   real. Reemplaza el `return false` incondicional anterior.

## Verificación

- 8 nuevos test cases en `backend/tests/test_tax_id.cpp`, incluidos los
  dos ejemplos reales de Ecuador y el de Chile citados arriba (verificados
  a mano antes de escribir el código, no solo después). Cobertura:
  aceptación válida, rechazo por dígito verificador incorrecto, rechazo
  por provincia/establecimiento inválido (Ecuador), rechazo por longitud
  o repetición (Costa Rica/fallback).
- `docker compose build web` + `ctest` corridos contra el contenedor real
  tras el cambio — ver detalle de conteo de aserciones en el historial de
  build de esta sesión.

## Consecuencias

- Un proveedor con sede en Costa Rica, o una empresa de Ecuador/Chile, ya
  puede completar el registro con su identificador fiscal real.
- Costa Rica y el resto del catálogo (excepto PE/BR/US/CA/EC/CL) quedan
  con una validación **honesta pero débil** (solo forma, no matemática) —
  si en el futuro se confirma un algoritmo real y confiable para alguno
  de esos países, reemplazar el fallback genérico por su validador
  específico es aditivo (mismo patrón que este ADR).
- Este ADR **no** resuelve la topología edge+hub, soberanía de datos por
  país, ni el rollout por fases de ADR-035 — solo el registro de una
  empresa individual en el stack actual (SaaS multi-tenant de un solo
  nodo). Si "proyectos activos en Ecuador/Chile/Brasil/EE.UU." significa
  despliegues físicos separados por país (no solo tenants en el mismo
  stack), esa es una decisión de negocio distinta y más grande — ver
  ADR-035, que sigue como propuesta a la espera de esa decisión.

## Alternativas descartadas

- **Inventar un algoritmo de dígito verificador para Costa Rica** basado
  en fuentes no confirmadas: descartado — el riesgo de rechazar empresas
  válidas (o aceptar inválidas) con una fórmula equivocada es peor que
  no tener checksum matemático y ser explícito al respecto.
- **Bloquear el registro para países sin checksum real** (mantener el
  `return false` para todo lo que no sea PE/BR/US/CA/EC/CL): descartado
  — es exactamente el problema que este ADR resuelve; el catálogo ya
  ofrece esos países como opción en la UI (ADR-075), no tiene sentido
  que la UI los liste y el backend los rechace siempre.
- **Implementar la topología completa de ADR-035 primero**: descartado
  para este caso concreto — es una inversión de meses para un problema
  (una empresa individual no se puede registrar) que se resuelve con un
  cambio acotado en la validación fiscal. ADR-035 sigue siendo la
  decisión correcta si el negocio necesita despliegues físicos separados
  por país con soberanía de datos, pero eso es una decisión aparte.

## Referencias

- `backend/src/auth/tax_id.{cpp,hpp}`
- `backend/tests/test_tax_id.cpp`
- `db_scripts/16_platform_multitenant_latam_i18n_rbac_audit.sql`,
  `db_scripts/25_platform_ui_countries_languages.sql` (catálogo de países)
- ADR-075 (`internacionalizacion-pais-idioma-acceso`)
- ADR-087 (`validacion-ruc-registro-externo-opcional`)
- ADR-035 (`plataforma-enterprise-latam`) — visión de infraestructura, no
  resuelta por este ADR
