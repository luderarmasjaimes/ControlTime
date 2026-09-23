# FrontEndMovil — Beemetry/AURIXA para Android

Cliente móvil Android (Flutter) para la plataforma minera Beemetry/AURIXA.
**Proyecto independiente** del frontend web (`../frontend`) y del backend
(`../backend`) — ver [docs/decisions/0001](docs/decisions/0001-alcance-independencia-proyecto.md)
para el porqué y el criterio de gobernanza. Reutiliza el mismo backend como
único punto de integración; no comparte código, backlog ni ADRs con el
proyecto principal.

## Decisiones de arquitectura

Todo el razonamiento de diseño está en [docs/decisions/](docs/decisions/README.md)
(numeración propia `ADR-0001+`). Léelos en orden antes de tocar auth,
navegación o los módulos de Informes/Fórmulas:

1. [Alcance e independencia](docs/decisions/0001-alcance-independencia-proyecto.md)
2. [Elección de stack: Flutter](docs/decisions/0002-eleccion-stack-flutter.md)
3. [Autenticación, sesión y biometría](docs/decisions/0003-autenticacion-sesion-biometria.md)
4. [Arquitectura de navegación móvil](docs/decisions/0004-arquitectura-navegacion-movil.md)
5. [Módulos de alto riesgo (Informes/Fórmulas)](docs/decisions/0005-estrategia-modulos-alto-riesgo-informes-formulas.md)
6. [Sistema de diseño visual](docs/decisions/0006-sistema-diseno-visual.md)

## Entorno de desarrollo

### Requisitos ya instalados en esta máquina (ver historial de setup)
- Flutter SDK (stable) en `C:\dev\flutter`
- Android SDK (cmdline-tools + platform-tools + platform 35/36 + build-tools)
  en `C:\dev\android-sdk`
- JDK 17 (Temurin) en `C:\dev\jdk17`

Si configuras esto en otra máquina, agrega al PATH:
```bash
export JAVA_HOME="C:\dev\jdk17"
export ANDROID_HOME="C:\dev\android-sdk"
export PATH="/c/dev/jdk17/bin:/c/dev/android-sdk/cmdline-tools/latest/bin:/c/dev/android-sdk/platform-tools:/c/dev/flutter/bin:$PATH"
```

### ⚠️ Bug conocido de la sandbox de Claude Code en Windows (Gradle)

Cualquier `flutter build`/`flutter run`/`./gradlew` ejecutado desde el Bash
de Claude Code en Windows falla con
`java.io.IOException: Unable to establish loopback connection`
(issue conocido: `anthropics/claude-code#77508`). El JDK abre un socket
AF_UNIX para el "wakeup pipe" interno de `Selector.open()`, y la sandbox
virtualiza `%TEMP%` de forma que rompe ese socket. **Workaround
obligatorio** — exportar esto antes de cualquier comando Gradle/Flutter:

```bash
mkdir -p /c/dev/tmp   # una sola vez
export JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:\\dev\\tmp"
```

Esto NO hace falta en una terminal normal (PowerShell/Git Bash fuera del
agente) — solo quien compile este proyecto invocando comandos a través de
Claude Code en Windows lo necesita. Ver comentario detallado en
`android/gradle.properties`.

### ⚠️ Segundo problema: nombre de usuario de Windows con carácter especial

Si el usuario de Windows de la máquina de desarrollo tiene un carácter no
ASCII en su nombre (ej. `lenovo´`), herramientas nativas C++ (ninja/CMake,
usadas por dependencias con bindings JNI/FFI como las que trae
`google_mlkit_face_detection`) fallan con
`ninja: fatal: chdir to '...' - No such file or directory` porque no
manejan bien esa ruta — el Pub cache por defecto vive bajo
`%LOCALAPPDATA%\Pub\Cache`, dentro del perfil de ese usuario. Workaround
(una sola vez, o cada sesión de terminal si no se persiste la variable de
entorno a nivel de usuario):

```bash
mkdir -p /c/dev/pub-cache
export PUB_CACHE="C:\dev\pub-cache"
flutter pub get
```

Esto sí puede hacer falta también en una terminal normal, si el nombre de
usuario de esa máquina tiene el mismo problema — no es específico de
Claude Code (a diferencia del problema de Gradle de arriba).

### Backend de desarrollo

El backend real solo es alcanzable a través de nginx (`beemetry-web`,
puerto host `5173`), nunca directo al contenedor del backend (ver
[docs/decisions/0001](docs/decisions/0001-alcance-independencia-proyecto.md)).
Con el stack principal levantado (`docker compose up` en `D:\InformeCliente`)
y un celular Android conectado por USB (depuración USB activada):

```bash
flutter run --dart-define=API_BASE_URL=http://<ip-lan-de-esta-pc>:5173
```

Reemplaza `<ip-lan-de-esta-pc>` por la IP de esta máquina en la red local
(un celular físico no puede usar `localhost` ni `10.0.2.2` — ver comentario
en `lib/core/network/env.dart`).

## Estado de implementación (primera entrega)

Ver [docs/decisions/0005](docs/decisions/0005-estrategia-modulos-alto-riesgo-informes-formulas.md)
para el criterio de "mismo nivel de profundidad" aplicado a Informes/Fórmulas.

**Con integración real a la API** (arquitectura completa: auth Bearer +
refresh + CSRF, biometría, i18n, tema, navegación completa a los ~25
módulos):
- Login por contraseña (2FA/MFA incluido) y por rostro con desafío de vida
  activa biométrico server-authoritative
- Dashboard (KPIs), KPIs de Operación (streaming SSE en vivo), Alarmas
  (REST + WebSocket en tiempo real), Mapa General (marcadores + clustering),
  Dispositivos, Resumen de Fórmulas, Lista de Informes
- Puentes WebView autenticados para edición de Informes y el canvas de
  Fórmulas (ver ADR-0005)

**Pendiente de integración real** (destino de navegación ya existe,
pantalla marcador mientras se completa módulo por módulo): Sensores
Técnicos, Telemetría, Monitor de Simulación, Videovigilancia,
Inclinómetro, Visor 3D, Desplazamiento Acumulado, Geoportal Minero,
Cumplimiento Geoespacial, Mapa Detallado, Usuarios, Empresas,
Configuración de Alarmas, WhatsApp, Soporte, Candidatos RRHH, Matriz de
Permisos.

### Puntos abiertos que requieren verificación contra el backend real
Documentados inline en el código donde aplica (`grep -r "docs/decisions/0001" lib/`
para encontrarlos todos):
- Forma exacta de campos de `/api/map/markers`, `/api/mining/formulas`,
  `/api/reports` (parseados defensivamente, best-effort).
- Nombre exacto del campo de "desafío biométrico completado" dentro de
  `challenge` en la respuesta de `/api/process_frame`.
- El puente WebView de Informes/Fórmulas necesita que el frontend web
  aprenda a leer un parámetro de sesión (`mobile_bridge_token`) — ver
  comentario en `lib/core/widgets/authenticated_webview.dart`.
