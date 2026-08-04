# Revision completa de la solucion (enfoque tiempo real)

## Cambios aplicados en esta iteracion

1. **Rutas Windows fijadas para build local CMake (backend)**
   - `Python`: `C:/Python/Python314`
   - `Boost.Asio`: `C:/boost_1_90_0`
   - `OpenCV`: `C:/opencv/build`
   - Archivo actualizado: `backend/CMakeLists.txt`.

2. **Importacion biometrica productiva desde `C:\\FACIAL`**
   - Se incorporo el microservicio IA:
     - `ai_engine/eye_analyzer.py`
     - `ai_engine/requirements.txt`
     - `ai_engine/Dockerfile.ai`
   - Motor importado: MediaPipe FaceLandmarker + reglas de ojos/boca/lentes con histeresis.

3. **Integracion Docker de tiempo real**
   - `docker-compose.yml`:
     - servicio `ai_engine` habilitado y healthcheck activo.
     - `web` ahora depende de `ai_engine` + `db`.
     - variable `AI_ENGINE_URL=http://ai_engine:5000`.
   - `docker-compose.prod.yml`:
     - agregado servicio `ai_engine`.
     - variable `AI_ENGINE_URL` en backend.

## Revision arquitectonica completa (estado actual)

- **Backend C++ (Boost.Beast/Asio + OpenCV + PostgreSQL)**: correcto para baja latencia, con puntos de mejora en desacoplar biometria en modulos compilables independientes (actualmente concentrado en `main.cpp`).
- **Frontend React/Vite + Nginx**: proxy y puertos ya alineados (`5173` frontend, `8082` backend externo).
- **DB Timescale/Postgres**: base funcional para auth/reportes/telemetria; falta estandarizar politicas de retencion y particionamiento para cargas de alta frecuencia.
- **Biometria**: coexisten heuristicas C++ y proveedor externo; con la importacion de `ai_engine` queda preparado un camino de validacion asistida por IA.
- **Infra Docker**: stack Linux funcional; faltan controles de autoscaling y observabilidad dedicada para FPS/latencia biometrica.

## Gap critico para "tiempo real" (prioridad alta)

1. **Monitoreo de latencia por etapa**
   - Medir p50/p95 en: captura, analisis biometrico, auth, respuesta API.
2. **Backpressure en pipeline biometrico**
   - Evitar acumulacion de frames: procesar ultimo frame util y descartar stale frames.
3. **Separacion de workers**
   - Liveness/quality en worker pool dedicado para no bloquear hilo HTTP.
4. **Caches de clasificadores/modelos**
   - Cargar modelos una sola vez y validar estado en `/health` extendido.
5. **Pruebas de estres**
   - Carga concurrente de login facial + reportes para validar SLA real.

## Ruta recomendada inmediata (siguiente sprint)

1. Conectar `AI_ENGINE_URL` en backend para que `verify-frame` consuma `ai_engine` de forma opcional con timeout estricto.
2. Extraer biometria de `backend/src/main.cpp` a modulos:
   - `biometric/analyzer.*`
   - `biometric/provider_dermalog.*`
   - `biometric/provider_ai_engine.*`
3. Agregar metricas:
   - `biometric_frame_ms`
   - `biometric_quality_score`
   - `auth_face_match_ms`
4. Definir presupuesto de latencia:
   - `verify-frame` < 180 ms p95 (objetivo inicial).

## Validacion operativa recomendada

```powershell
docker compose build ai_engine web frontend
docker compose up -d
docker compose ps
curl http://localhost:8082/health
curl http://localhost:5173
curl http://localhost:5000/health
```

## Nota importante

La importacion desde `C:\\FACIAL` fue aplicada con foco en componentes productivos reutilizables (motor IA Python + empaquetado Docker).  
Para una migracion "100% total" del stack C++ de `C:\\FACIAL` dentro del backend actual, se recomienda ejecutar una segunda fase de refactor controlado (por modulos) para evitar regresiones en APIs ya desplegadas.
