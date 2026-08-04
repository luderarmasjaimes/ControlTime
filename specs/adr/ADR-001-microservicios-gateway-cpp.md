# ADR-001 — Microservicios con gateway C++ central

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-06-24 |
| **Decisor(es)** | Arquitecto TI AURIXA |
| **Features** | `specs/001-*`, `006-*`, `010-*` |

## Contexto
La plataforma debe procesar telemetría minera en tiempo real (10.000+ sensores), biometría, GIS, fórmulas e IA con latencia baja y trazabilidad centralizada. Un monolito dificulta escalar componentes independientes (visión IA vs ingesta vs UI).

## Opciones consideradas
1. **Monolito C++** — simple al inicio; difícil escalar IA y GIS por separado.
2. **Microservicios sin gateway** — el frontend hablaría con N servicios; superficie de ataque y complejidad operativa altas.
3. **Microservicios + gateway C++ (`web`)** — un punto de control TLS, auth, auditoría y orquestación.

## Decisión
Adoptar **microservicios containerizados** (`ai_engine`, `formula_engine`, `tileserver`, `ollama`, etc.) con **gateway central C++** (`backend/web`) como único punto de entrada del frontend y de integraciones externas.

## Consecuencias
- **Positivas:** escalabilidad por servicio, seguridad centralizada, cumple Art. 6 Constitución.
- **Negativas:** mayor complejidad operativa (Docker Compose, healthchecks, redes).
- **Impacto:** alineado con `docker-compose.yml` y `docker-compose.scale.yml`.
