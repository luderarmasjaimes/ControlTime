# Análisis e instalación de Boost.Asio para InformeCliente

## Estado encontrado

- `C:\boost_1_92_0` contiene las cabeceras de Boost 1.92.0 (`BOOST_VERSION=109200`).
- Al 2026-08-12, 1.92.0 es Beta 1; la versión estable más reciente es 1.91.0.
- La carpeta Windows todavía no tiene `b2.exe`, `stage/lib` ni bibliotecas compiladas.
- No se detectó Visual Studio Build Tools/MSVC en la sesión actual.
- CMake y `CMakePresets.json` del backend aún apuntaban a `C:\boost_1_90_0`.
- Los Dockerfiles usaban `libboost-all-dev`: Boost 1.83 en Ubuntu 24.04 y una
  versión aún anterior en Ubuntu 22.04.
- El backend requiere Asio/Beast (cabeceras), Boost.System y Boost.JSON.
- Formula Engine requiere Asio/Beast, Boost.System y Boost.Thread.

## Decisión aplicada

- Windows de desarrollo apunta a `C:\boost_1_92_0`, respetando la instalación solicitada.
- Windows admite fallback header-only para backend, con validación mínima 1.91.
- Para obtener bibliotecas Windows se incluye `Instalar-Boost-Windows.ps1`; exige MSVC x64.
- Docker no copia nada desde `C:`. Descarga Boost 1.91.0 estable dentro de Linux,
  comprueba el SHA-256 oficial y compila solo los componentes requeridos.
- La imagen runtime del backend copia las mismas bibliotecas Linux creadas por
  el builder, evitando mezclar 1.91 con paquetes Ubuntu 1.83.
- CMake exige Boost >=1.91 y muestra la versión/ruta durante cada configuración.

## Motivo de la separación

Los `.lib`/`.dll` generados con MSVC para Windows no pueden enlazarse ni ejecutarse
en Linux. Los contenedores necesitan `.a`/`.so` construidos con el compilador y ABI
Linux de la propia imagen. Además, usar una beta en producción minera aumenta el
riesgo de cambios incompatibles; por eso Docker queda en 1.91.0 estable.

## Requisitos pendientes

- Instalar Visual Studio Build Tools 2022, carga `Desarrollo para escritorio con C++`,
  para compilar Boost 1.92 en Windows.
- Iniciar Docker Desktop y conceder acceso al daemon para validar las imágenes.
- Ejecutar los builds indicados después de aplicar los cambios.

## Validación esperada

```powershell
docker build -f backend/Dockerfile.verify -t beemetry-backend-boost-verify backend
docker build -t beemetry-formula-boost formula_engine
docker compose build web formula_engine
```

En los logs de CMake debe aparecer Boost 1.91.0 desde `/opt/boost`.
