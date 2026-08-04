# ADR-004 — Arquitectura políglota: C++ core + sidecars (Python/Ollama/LanguageTool) por HTTP

## Actualización 2026-07-27 — biometría local activa y avatar HD

ADR-074 supersede únicamente la frase histórica que describía toda la función
biométrica como “latente”. El runtime ya usa el sidecar local para
captura/calidad/login y ahora para avatar; la arquitectura C++ + sidecar sigue
vigente. Visión EPP permanece diferida y el gate legal de ADR-025 no cambia.

**Status**: implemented (verificado 2026-07-06: `ai_engine`/`formula_engine`/`languagetool`/`ollama` como servicios Docker separados; `ai_engine_client.cpp` los llama vía HTTP, sin linking en proceso)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: plataforma

## Contexto

El sistema combina dos mundos con necesidades opuestas: un núcleo de tiempo real sensible a la latencia (telemetría, WS, auth) donde C++ es óptimo, y cargas de IA/ML/CV (modelos de inferencia, LLM, corrección gramatical, OCR/visión) donde el ecosistema vive en Python y en servidores de modelos dedicados. El código ya refleja esto: el gateway C++ llama por HTTP a un sidecar Python (`ai_engine`, puerto 5000, `biometric/ai_engine_client.cpp`), a Ollama y a LanguageTool. También hay scripts utilitarios Python (`backend/image_optimizer.py`).

## Decisión

Adoptamos una **arquitectura políglota con frontera HTTP explícita**: el **hot path es 100% C++** (gateway, telemetría, WS, auth, ruteo); la **IA/ML/CV vive en sidecars** que el gateway invoca por HTTP — sidecar Python (`ai_engine`), Ollama (LLM) y LanguageTool (gramática). **Python nunca está en el hot path de telemetría.**

### Alcance v0.1
- El **sidecar Python está activo en v0.1** para IA no-biométrica (inferencia de modelos, análisis de imagen/documento) más los scripts utilitarios (`image_optimizer.py`).
- La **función biométrica del sidecar queda latente** (no se activa por la decisión legal de ADR-025).
- Contrato sidecar = HTTP/JSON sincrónico para inferencia bajo demanda; nada de RPC binario propietario.

### Reglas duras
- Ningún sidecar bloquea el event loop del gateway: las llamadas a sidecars son async o van a un thread pool.
- Los sidecars son stateless respecto del negocio (el estado vive en el gateway/DB).
- Reescribir un modelo de Python a C++ (p.ej. ONNX C++) es una optimización de hardening, no un default (ver ADR-027).

## Consecuencias

### Positivas
- Cada lenguaje en lo que es fuerte: C++ en latencia, Python en ML/CV.
- Aísla fallas: un crash del sidecar no tumba el gateway de telemetría.
- Permite versionar/escalar los modelos independientemente del core.

### Negativas / Trade-offs
- El salto HTTP agrega latencia (notado en el doc de optimización para el login biométrico) — aceptable fuera del hot path; en hardening se evalúa mover inferencia crítica a ONNX C++.
- Más superficies operativas (varios runtimes) — contenido por Docker y por el gateway como único frente público.

### Neutras
- Define una frontera clara que disciplina dónde va cada nuevo workload.

## Alternativas descartadas

### Embeber Python en C++ (pybind11 / CPython embebido)
Elimina el salto HTTP, pero acopla el ciclo de vida del intérprete al gateway, complica el GIL y arriesga el hot path. Se descarta.

### Reescribir todo en C++ (sin Python)
Máximo rendimiento, pero tira el ecosistema de modelos y multiplica el costo de desarrollo. Solo se hace selectivamente en hardening.

### Todo en Python (sin C++)
Imposible sostener 10k sensores <20 ms en Python. Descartado de raíz.

## Referencias
- `Referencias/backend/src/biometric/ai_engine_client.cpp`, `backend/image_optimizer.py`
- `Referencias/docs/02_Arquitectura/Optimizacion_TiempoReal_CPP_AURIXA_v36.md` (salto Python en login)
- ADR-002 (gateway), ADR-024 (IA local), ADR-025 (biometría diferida), ADR-027 (OpenCV)
