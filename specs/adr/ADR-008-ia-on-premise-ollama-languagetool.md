# ADR-008 — IA on-premise Ollama + LanguageTool

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-06-24 |
| **Decisor(es)** | Arquitecto TI |
| **Features** | `011`, `018` |

## Contexto
Corrección de texto y redacción asistida en informes técnicos debe funcionar en VPS sin depender de APIs cloud (soberanía de datos).

## Decisión
- **LanguageTool** self-hosted (`languagetool`) para ortografía/gramática es-PE
- **Ollama** (`tinyllama` u otros) para reescritura vía `/api/text/rewrite`
- Cloud pagada/gratuita solo como **fallback** configurable (BE2), nunca por defecto para datos sensibles

## Consecuencias
- Servicios en `docker-compose.yml`; gateway enruta según política tenant
