# Informe de consumo de recursos del servidor de pruebas Beemetry

**Fecha de captura y diagnóstico:** 2026-09-01  
**Zona horaria:** America/Lima  
**Equipo:** `DESKTOP-ATRC0UU`  
**Propósito:** establecer una línea base de capacidad y optimización para el despliegue inicial de la plataforma minera Beemetry.

> Este documento registra una observación puntual del servidor. No reemplaza una prueba de carga sostenida ni demuestra por sí solo la capacidad máxima de producción.

## 1. Resumen ejecutivo

El equipo se encuentra operativo y sin señales de saturación crítica. El uso de memoria observado fue de 46.65 GB sobre 63.73 GB (73.2%), pero todavía existían 17.08 GB disponibles y el archivo de paginación apenas utilizaba 0.08 GB. Esto indica que, durante la medición, Windows no estaba trasladando cantidades significativas de memoria al disco.

La principal fuente del consumo visible es WSL/Docker. `vmmemWSL` mantenía 20.63 GB de memoria física, de los cuales Linux identificaba aproximadamente 20.6 GB como caché y 20.3 GB como recuperables. La segunda oportunidad de optimización corresponde a las herramientas de desarrollo: 23 procesos de Claude acumulaban 5.93 GB de memoria activa.

La NVIDIA RTX 5060 Laptop GPU está correctamente disponible dentro de los contenedores de IA. Su utilización de 0% no representa un error: no había modelos de Ollama cargados ni inferencias activas. La Intel UHD alcanzó 73% en la captura original debido al motor 3D; una muestra posterior atribuyó la mayor parte de la actividad a Microsoft Edge y al escritorio de Windows.

**Conclusión:** el 73% de RAM es aceptable para una estación de pruebas con 21 contenedores, pero no es el estado óptimo para una laptop que también se utiliza para desarrollo. Se recomienda reservar entre 15 y 20 GB para Windows, limitar WSL inicialmente a 24 GB, cerrar sesiones de desarrollo sin uso y ejecutar solamente los perfiles Docker necesarios para cada prueba.

## 2. Alcance y metodología

La revisión se realizó con consultas de solo lectura sobre:

- hardware y memoria reportados por Windows;
- memoria física y privada de los procesos;
- memoria interna, caché y swap de WSL;
- contenedores activos, límites de recursos y consumo instantáneo;
- acceso de los contenedores a la GPU NVIDIA;
- modelos instalados y cargados en Ollama;
- motores GPU por proceso durante una muestra de cinco segundos;
- configuración existente de WSL y Docker Compose.

No se detuvieron servicios, no se modificaron configuraciones y no se ejecutaron cargas sintéticas.

## 3. Inventario del equipo

| Componente | Valor observado |
|---|---:|
| CPU | Intel Core i9-14900HX |
| Procesadores lógicos | 32 |
| RAM utilizable | 63.73 GB |
| GPU integrada | Intel UHD Graphics |
| GPU dedicada | NVIDIA GeForce RTX 5060 Laptop GPU |
| VRAM NVIDIA disponible | 8,151 MiB |
| Almacenamiento | Dos unidades SSD NVMe |
| WSL | 2.7.11.0 |
| Kernel WSL | 6.18.33.2-2 |
| Distribución WSL activa | `docker-desktop` |

## 4. Línea base de recursos

### 4.1 Memoria del host

| Métrica | Resultado | Evaluación |
|---|---:|---|
| RAM total | 63.73 GB | Capacidad adecuada para pruebas locales |
| RAM utilizada | 46.65 GB | 73.2%, uso alto pero no crítico |
| RAM disponible | 17.08 GB | Margen operativo suficiente |
| Archivo de paginación asignado | 12.71 GB | Disponible como protección |
| Archivo de paginación utilizado | 0.08 GB | Sin presión importante de intercambio |
| Pico de paginación observado | 0.14 GB | Sin evidencia de thrashing |
| Compresión de memoria | 5.23 GB | Señal de presión o actividad previa elevada |

### 4.2 CPU, discos y red

La captura mostró CPU entre 0% y actividad mínima, discos entre 0% y 1% y ausencia de tráfico significativo en el instante observado. Las muestras de Docker mostraron actividad moderada en PostgreSQL, ThingsBoard y sincronización, pero no un cuello de botella del procesador.

La frecuencia de 4.19 GHz mostrada con uso casi nulo puede corresponder a la política energética o a un pico instantáneo. Para operación permanente debe observarse también temperatura, potencia y throttling, variables que no formaron parte de esta captura.

## 5. Desglose de memoria por aplicación

| Grupo de procesos | Cantidad | Memoria activa | Memoria privada | Observación |
|---|---:|---:|---:|---|
| `vmmemWSL` | 1 | 20.63 GB | 29.60 GB | Docker, procesos Linux y caché |
| Claude | 23 | 5.93 GB | 10.54 GB | Principal oportunidad inmediata fuera de Docker |
| Compresión de memoria | 1 | 5.23 GB | 0.02 GB | Páginas comprimidas administradas por Windows |
| `svchost` | 97 | 1.80 GB | 0.80 GB | Servicios normales de Windows |
| Microsoft Edge | 14 | 1.55 GB | 1.27 GB | Pestañas, extensiones y aceleración gráfica |
| Codex/ChatGPT | 11 | 1.40 GB | 1.81 GB | Arquitectura multiproceso esperada |
| PowerShell | 16 | 0.83 GB | 1.05 GB | Varias consolas o tareas activas |
| Docker Desktop | 6 | 0.53 GB | 0.52 GB | Interfaz y componentes del escritorio |
| Docker backend | 2 | 0.33 GB | 0.37 GB | Backend de Docker fuera de `vmmemWSL` |
| pgAdmin | 4 | 0.31 GB | 0.50 GB | Administración de base de datos |

La memoria privada representa memoria comprometida por los procesos y no siempre coincide con las páginas físicas residentes. Por ello, no debe sumarse directamente para calcular la RAM física total.

## 6. Análisis de WSL y Docker

### 6.1 Estado interno de WSL

| Métrica Linux | Valor |
|---|---:|
| Memoria total visible | 31.2 GB |
| Memoria utilizada por Linux | 7.1 GB |
| Memoria libre inmediata | 3.5 GB |
| Caché/búferes | 20.6 GB |
| Memoria disponible/recuperable | 20.3 GB |
| Swap total | 8.0 GB |
| Swap utilizado | 866.8 MB |

La diferencia entre los 20.63 GB de `vmmemWSL` visibles en Windows y los 7.1 GB realmente utilizados dentro de Linux se explica principalmente por caché de archivos. Esa caché mejora el rendimiento de imágenes, capas, bases de datos y compilaciones, pero puede hacer que Windows muestre un consumo alto durante períodos prolongados.

La configuración actual de `%UserProfile%\.wslconfig` solo contiene:

```ini
[wsl2]
networkingMode=mirrored
```

No existe un límite explícito de memoria del usuario ni una política explícita de recuperación de caché.

### 6.2 Contenedores activos

| Contenedor | Consumo observado | Límite | CPU instantánea | Evaluación |
|---|---:|---:|---:|---|
| `beemetry-db` | 4.103 GiB | 8 GiB | 9.21% | Mayor consumidor; coherente con TimescaleDB ajustado |
| `tb-local-node` | 1.941 GiB | Sin límite de RAM | 5.81% | Debe recibir límite y monitoreo de heap |
| `beemetry-db-replica` | 1.912 GiB | 4 GiB | 0.35% | Candidato a apagado en pruebas que no validen HA |
| `tb-local-postgres` | 1.179 GiB | Sin límite | 0.47% | Debe recibir límite |
| `beemetry-ai-vision` | 990.7 MiB | 6 GiB | 0.08% | Inactivo, pero mantiene casi 1 GB |
| `beemetry-redpanda` | 382.5 MiB | 3 GiB | 1.90% | Consumo moderado |
| `beemetry-grammar` | 375.9 MiB | 1 GiB | 0.12% | Puede apagarse si no se prueba corrección gramatical |
| `beemetry-pdf-export` | 209 MiB | 4 GiB | 0% | Límite muy superior al consumo observado |
| `beemetry-minio` | 164 MiB | 1 GiB | 0.01% | Normal |
| `beemetry-llm` | 52.5 MiB | 12 GiB | 0% | Ollama activo sin modelo cargado |
| Otros servicios | Menos de 50 MiB cada uno | Variable | Bajo | Impacto individual menor |

### 6.3 Servicios sin límites efectivos

Los siguientes contenedores no tenían límite efectivo de memoria durante la inspección:

- `tb-local-node`;
- `tb-local-postgres`;
- `tb-sync-prod6h`;
- `tb-sync-sim-1h`;
- `beemetry-webhook-tunnel`.

Los límites definidos en `docker-compose.yml` sí se encontraban aplicados a otros servicios, por lo que es viable extender el mismo mecanismo al stack de ThingsBoard y a los auxiliares.

### 6.4 Ajustes PostgreSQL relevantes

La base principal utiliza aproximadamente:

```text
shared_buffers = 2 GB
effective_cache_size = 6 GB
work_mem = 32 MB
maintenance_work_mem = 512 MB
max_connections = 400
```

Estos valores fueron diseñados para una prueba de ingesta de alrededor de 10 000 sensores. `effective_cache_size` es una estimación para el planificador y no una reserva directa de memoria. `work_mem`, en cambio, puede multiplicarse por operaciones y conexiones concurrentes; debe observarse durante consultas complejas.

Para pruebas funcionales comunes se recomienda un perfil liviano distinto, sin alterar el perfil destinado a pruebas de carga.

## 7. Análisis de GPU

### 7.1 NVIDIA RTX 5060

Estado observado mediante `nvidia-smi`:

| Métrica | Resultado |
|---|---:|
| Utilización GPU | 0% |
| Utilización de memoria | 0% |
| VRAM usada | 0 MiB |
| VRAM total | 8,151 MiB |
| Temperatura | 49 °C |
| Potencia instantánea | 5.54 W |

Los contenedores `beemetry-llm` y `beemetry-ai-vision` tienen una solicitud NVIDIA válida y ambos ejecutaron correctamente `nvidia-smi` desde su interior. No existe evidencia de un error de instalación, controlador o passthrough de GPU.

Ollama tenía instalados:

- `gemma2:2b`, 1.6 GB;
- `qwen2.5:7b`, 4.7 GB.

`ollama ps` no mostró modelos activos. Por tanto, 0% de utilización es el comportamiento correcto. La GPU no se activa por mantener el contenedor iniciado: requiere una petición de inferencia que cargue un modelo.

Durante una validación de IA deben observarse simultáneamente:

```powershell
nvidia-smi --loop=1
docker exec beemetry-llm ollama ps
docker stats beemetry-llm beemetry-ai-vision
```

En el Administrador de tareas debe seleccionarse el gráfico `CUDA` o `Compute_0`; el gráfico `3D` puede permanecer bajo aunque exista cómputo CUDA.

### 7.2 Intel UHD

La captura original mostró 73% en el motor 3D y 2.2 GB de memoria compartida. La cifra 47.7 GB es el máximo potencial de RAM compartible, no una reserva real.

En una muestra posterior de cinco segundos se identificó:

| Proceso | Motor | Promedio | Pico |
|---|---|---:|---:|
| Microsoft Edge | 3D | 18.5% | 24.5% |
| Desktop Window Manager | 3D | 3.6% | 5.4% |
| Claude | 3D | 0.8% | 1.4% |

Esto sugiere que el 73% fue un pico del navegador, una página acelerada, WebGL, animación o composición del escritorio. No se atribuye a PostgreSQL, MQTT, Redpanda ni al backend.

No se recomienda deshabilitar globalmente la aceleración gráfica. Primero debe identificarse la pestaña o aplicación responsable si la utilización permanece por encima de 60% durante más de cinco minutos con el servidor en reposo.

## 8. Riesgos para el despliegue

### Riesgo R1: presión de RAM al iniciar inferencias

Aunque Ollama trasladará los pesos principalmente a los 8 GB de VRAM, la carga, el contexto y los buffers pueden aumentar temporalmente RAM y VRAM. Ejecutar una inferencia grande mientras continúan los 21 contenedores y múltiples herramientas de desarrollo puede elevar el host por encima de 85%.

**Control:** mantener al menos 12-16 GB disponibles antes de una prueba de IA y monitorear `nvidia-smi`, WSL y Docker.

### Riesgo R2: contenedores sin límite

ThingsBoard, su PostgreSQL y los sincronizadores pueden crecer sin una frontera individual y competir con la base principal.

**Control:** definir límites iniciales, ejecutar pruebas y revisar eventos OOM antes de producción.

### Riesgo R3: confundir caché con fuga de memoria

La caché de WSL puede hacer que `vmmemWSL` permanezca alto aun cuando los servicios estén poco activos.

**Control:** comparar siempre memoria `used`, `buff/cache` y `available` dentro de Linux. Una fuga real muestra crecimiento de `used` y degradación de `available`, no solo crecimiento de caché.

### Riesgo R4: pruebas no representativas

Detener réplica, Redpanda o ThingsBoard reduce el uso, pero también cambia el comportamiento del sistema.

**Control:** mantener perfiles separados para desarrollo, integración, carga y despliegue completo.

## 9. Plan de optimización priorizado

### Prioridad 1: acciones sin cambios de arquitectura

1. Cerrar tareas, ventanas o agentes de Claude que no estén participando en la prueba.
2. Cerrar pestañas de Edge con actividad gráfica continua.
3. Detener perfiles Docker que no formen parte del escenario validado.
4. Confirmar que Windows conserve al menos 12 GB disponibles antes de iniciar una prueba pesada.

**Ahorro potencial estimado:** 5-10 GB, dependiendo de las herramientas y servicios detenidos.

### Prioridad 2: control de WSL

Configuración inicial propuesta:

```ini
[wsl2]
networkingMode=mirrored
memory=24GB
swap=8GB

[experimental]
autoMemoryReclaim=gradual
```

La propuesta mantiene la red actual y establece una frontera para que Windows conserve cerca de 40 GB para el sistema, aplicaciones y memoria compartida de la Intel. El límite de 24 GB debe probarse con el stack completo; si se producen errores OOM, debe aumentarse a 28 GB.

Después de modificar `.wslconfig` es necesario reiniciar WSL y Docker en una ventana de mantenimiento. No debe ejecutarse `wsl --shutdown` mientras haya pruebas o escrituras activas en las bases de datos.

### Prioridad 3: límites por contenedor

Valores de partida para pruebas funcionales, sujetos a validación:

| Servicio | Límite inicial propuesto |
|---|---:|
| ThingsBoard | 3 GB |
| PostgreSQL de ThingsBoard | 2 GB |
| Sincronizador de producción | 512 MB |
| Sincronizador de simulación | 512 MB |
| Cloudflare tunnel | 256 MB |

Los límites no deben aplicarse todos a la vez sin observación. Cada cambio debe validarse mediante prueba funcional, carga esperada y revisión de reinicios/OOM.

### Prioridad 4: perfiles operativos

Se recomienda separar al menos:

- `core`: web, API, base principal, PgBouncer y MQTT;
- `observability/integration`: ThingsBoard y sincronizadores;
- `ai`: Ollama y visión;
- `documents`: PDF, LanguageTool y fórmulas;
- `ha/load`: réplica, Redpanda y componentes de carga.

Esto permite reproducir escenarios sin mantener todos los servicios encendidos permanentemente.

## 10. Umbrales de aceptación

| Indicador | Normal | Advertencia | Crítico |
|---|---:|---:|---:|
| RAM del host | Menos de 75% | 75-85% sostenido | Más de 85% sostenido |
| Memoria disponible | Más de 12 GB | 8-12 GB | Menos de 8 GB |
| Paginación | Menos de 1 GB | 1-4 GB creciente | Más de 4 GB con disco activo |
| CPU | Menos de 70% | 70-90% sostenido | Más de 90% sostenido |
| Disco activo | Menos de 60% | 60-90% sostenido | Más de 90% sostenido |
| Temperatura NVIDIA | Menos de 75 °C | 75-85 °C | Más de 85 °C o throttling |
| VRAM NVIDIA | Menos de 85% | 85-95% | OOM o descarga significativa a RAM |
| Reinicios de contenedor | 0 | 1 investigado | Ciclo de reinicios |

Estos umbrales son una base operativa para la laptop, no un SLA definitivo de producción.

## 11. Procedimiento de medición durante el despliegue

### 11.1 Antes del despliegue

Registrar:

```powershell
Get-CimInstance Win32_OperatingSystem |
  Select-Object TotalVisibleMemorySize, FreePhysicalMemory

docker ps
docker stats --no-stream
nvidia-smi
```

Verificar que no existan contenedores reiniciándose:

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}"
```

### 11.2 Durante el despliegue

Abrir consolas separadas para:

```powershell
docker stats
```

```powershell
nvidia-smi --loop=1
```

Observar en el Administrador de tareas:

- memoria disponible;
- CPU total y frecuencia;
- actividad y latencia de discos;
- GPU NVIDIA en CUDA/Compute;
- GPU Intel en 3D;
- red física y red ZeroTier por separado.

### 11.3 Después del despliegue

Ejecutar:

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}"
docker stats --no-stream
docker events --since 30m --until 0s
nvidia-smi
```

Dentro de WSL/Docker Desktop:

```powershell
wsl.exe -e sh -lc "free -h"
```

Registrar si la memoria alta corresponde a `used` o a `buff/cache`.

## 12. Matriz de escenarios de prueba

| Escenario | Servicios mínimos | Métricas principales | Resultado esperado |
|---|---|---|---|
| Reposo | Stack completo sin tráfico | RAM, caché WSL, CPU | CPU baja; RAM estable |
| Navegación web | Web, API, DB | Intel GPU, API, DB | NVIDIA inactiva |
| Telemetría | API, DB, MQTT, ThingsBoard | CPU, I/O, RAM DB | Sin paginación creciente |
| LLM | Ollama y API | VRAM, CUDA, latencia | NVIDIA activa y modelo en `ollama ps` |
| Visión | AI Vision y API | VRAM, CUDA, RAM | NVIDIA activa; sin OOM |
| Exportación PDF | PDF y API | RAM, CPU, PIDs | Pico temporal controlado |
| Alta disponibilidad | DB y réplica | RAM, WAL, I/O | Réplica estable, sin lag creciente |
| Stack completo | Todos | Todas las anteriores | RAM menor de 85%; sin reinicios |

## 13. Criterio para determinar si existe una fuga

No debe declararse una fuga basándose únicamente en un porcentaje alto. Se debe sospechar una fuga cuando se cumplen varias condiciones:

1. el consumo de un proceso o contenedor crece de forma monotónica durante horas;
2. el uso no baja después de terminar las solicitudes;
3. la memoria `available` de Linux y Windows disminuye continuamente;
4. aumenta la paginación o aparecen terminaciones OOM;
5. reiniciar solo el proceso afectado recupera una cantidad significativa y repetible de memoria.

Para distinguir caché de fuga, registrar muestras cada minuto durante al menos 30 minutos de reposo y 30 minutos de carga.

## 14. Resultado final de la revisión

- El host tiene capacidad suficiente para las pruebas iniciales actuales.
- El 72-73% de RAM no es crítico, pero debe reducirse para conservar margen durante inferencias y pruebas de carga.
- La mayor parte optimizable corresponde a caché WSL, herramientas de desarrollo duplicadas y servicios que no siempre son necesarios.
- La NVIDIA está configurada correctamente; permanece en 0% porque los contenedores de IA están ociosos.
- La Intel UHD atiende el escritorio y el navegador; su pico no representa consumo del backend.
- Deben añadirse límites a ThingsBoard, PostgreSQL de ThingsBoard, sincronizadores y túnel.
- Deben crearse perfiles Docker diferenciados antes de utilizar la laptop como servidor de pruebas continuo.

## 15. Registro de cambios recomendado

Toda optimización debe registrarse con:

| Campo | Contenido |
|---|---|
| Fecha y hora | Momento del cambio |
| Configuración anterior | Valor exacto |
| Configuración nueva | Valor exacto |
| Motivo | Problema o hipótesis |
| Escenario validado | Funcional, carga, IA, HA, etc. |
| Resultado | RAM, CPU, GPU, latencia y errores |
| Decisión | Mantener, ajustar o revertir |

De esta forma se evita confundir mejoras reales con variaciones normales de caché o carga.

