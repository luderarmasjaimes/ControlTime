# ADR-207 — Fotocheck: encabezado con la empresa minera, solo 3 datos visibles y color por área de trabajo

**Status**: implemented, verificado con build real y render en el contenedor desplegado (2026-09-23); pendiente revisión visual con un registro real
**Fecha**: 2026-09-23
**Autores**: Claude (sesión con Luder Armas)
**Ámbito**: plataforma / identidad (registro biométrico)

## Contexto

El fotocheck que se genera al registrar un usuario (foto real capturada en
el registro + QR cifrado, `GET /api/fotocheck/{token}` →
`ai_engine /generate_fotocheck`) tenía tres problemas reportados:

1. El título superior decía siempre **BEEMETRY**, sin importar a qué empresa
   minera pertenece el usuario.
2. Mostraba 6 datos (nombres, DNI, empresa, correo, celular, cargo). Se pide
   dejar solo **Nombres, Apellidos y Documento de identidad**.
3. Diseño único para todos, con fuentes Hershey de OpenCV. Se pide que el
   color/diseño **varíe según el área de trabajo** (ligada al perfil/rol del
   usuario) y un acabado de nivel corporativo enterprise LATAM.

## Decisión

- **Empresa en el encabezado**: el backend resuelve `tenants.tenant_name` del
  `tenant_id` del usuario (`resolveTenantNamePg`, `fotocheck_share_links.cpp`);
  si no hay tenant, cae al texto `company` del registro. Se muestra en
  mayúsculas, 1 línea (60→42 px) o 2 líneas (48→28 px) auto-ajustadas, con un
  monograma de iniciales (se ignoran "Compañía", "Minera", "S.A.A.", etc.).
  No se usa el logo SVG del tenant (ADR-046): rasterizar SVG exigiría
  cairosvg/librsvg en `ai_engine`, dependencia nueva que no se justificó.
- **Datos visibles**: solo nombres, apellidos y DNI. El backend ahora manda
  a `ai_engine` únicamente `tenant_name`, `role`, `first_name`, `last_name`,
  `dni` (minimización: correo/celular ya no salen del backend para el render).
  **El QR no cambia**: sigue cifrando el payload completo de
  `buildFotocheckFields` (+`exp`), que es lo que `POST /api/fotocheck/scan-qr`
  usa para precargar empresa/usuario en login/registro.
- **Área de trabajo = rol de plataforma** (los 7 de `kValidPlatformRoles`),
  tabla `_AREA_THEMES` en `ai_engine/fotocheck_render.py`:

  | Rol | Área impresa | Color |
  |-----|--------------|-------|
  | admin | Administración | azul marino + dorado |
  | manager | Gerencia | grafito + dorado |
  | supervisor | Supervisión de Operaciones | azul royal |
  | geologist | Geología y Geotecnia | marrón tierra |
  | safety | Seguridad y Salud Ocupacional | verde esmeralda |
  | operator | Operaciones Mina | naranja alta visibilidad |
  | viewer | Visitante | pizarra |
  | (otro) | Personal Autorizado | gris neutro |

  El nombre del área se imprime en la banda inferior (no solo el color), para
  que la tarjeta no dependa de distinguir colores.
- **Render**: Pillow + Inter / Inter Display (paquete Debian `fonts-inter`,
  OFL) en vez de `cv2.putText`. Pillow ya estaba en la imagen (paso
  `--no-deps` de `Dockerfile.ai`); `fonts-inter` se agrega en capa aparte
  DESPUÉS de los `pip install` para no invalidar su caché. Sin la fuente, cae
  a DejaVu Sans. Tarjeta 900×1428 (proporción CR80 vertical).
- **QR**: escala por factor entero de píxeles por módulo (antes fraccionaria,
  módulos de 3 y 4 px mezclados), lado acotado a 250–330 px y panel blanco
  dimensionado sobre el tamaño real.

## Alternativas descartadas

- *Área de trabajo como campo nuevo en `auth_users`*: no existe hoy y el
  pedido la liga explícitamente al perfil con el que se registró el usuario;
  el rol ya es ese dato. Si más adelante se necesitan áreas más finas que los
  7 roles (p. ej. "Planta concentradora"), requiere columna + ADR propio.
- *Rol por tenant (membresías / `org_grant` de ADR-130)* en vez de
  `auth_users.role`: el fotocheck se abre por link sin sesión, así que no hay
  un "tenant activo" que elegir; se usa el rol y tenant primarios del usuario.

## Verificación

- `docker compose build ai_engine web`: ambas imágenes compilan limpio
  (incluye `fotocheck_routes.cpp`/`fotocheck_share_links.cpp`).
- Contenedores recreados y `healthy`; `fonts-inter` presente en la imagen.
- `POST /generate_fotocheck` real con foto SINTÉTICA (sin PII) y payload de
  440 caracteres base64 (tamaño del cifrado real): PNG 900×1428, QR
  decodificado con `pyzbar` igual al payload, también con la imagen reducida
  al 50%.
- Los 7 roles renderizados + nombres de empresa largos (2 líneas) y nombres
  / apellidos compuestos largos (auto-ajuste sin invadir el panel QR).
- `GET /api/fotocheck/<token inexistente>` → 404 `fotocheck_link_invalido`
  (ruta intacta).
- **Pendiente**: abrir el link de fotocheck de un usuario real registrado
  (no se hizo en la sesión para no extraer fotos/datos personales reales).
