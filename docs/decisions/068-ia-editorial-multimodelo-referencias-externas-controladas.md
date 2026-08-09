# ADR-068 — IA editorial multimodelo y referencias externas controladas

## Actualización 2026-07-25 — la corrección rápida no cumplía la Decisión 1, y Tavily se probó con clave real

Este ADR ya declaraba como decisión (§1, "Corrección fiel") que "LanguageTool
on-premise es la autoridad para ortografía/gramática y solo autoaplica
categorías seguras" — pero `handleCorrectQuick` (botón "Corrección
ortográfica rápida" de la barra flotante) en realidad llamaba a
`applyQuickSpanishCorrections`, un reemplazo de **13 palabras hardcodeadas**
sin relación con LanguageTool, inútil contra errores reales. Reportado
explícitamente por el usuario ("me haces una propuesta con cambios que no
tienen relación con el texto original"). Corregido: `handleCorrectQuick`
ahora llama a `languageToolCheckJson` + `applyLanguageToolSafeMatches` (el
mismo mecanismo que ya usaba `/api/text/rewrite`), con
`applyQuickSpanishCorrections` retenido solo como pulido determinístico final
(espaciado/mayúscula) y como fallback si LanguageTool no responde. Verificado
end-to-end: texto con errores reales
("operatibo"→"operativo","disponivilidad"→"disponibilidad",
"jeneral"→"general", "covertura"→"cobertura", "piezometros"→"piezómetros")
corregido con fidelidad total al contenido original, sin parafraseo.

Además, el usuario proveyó una API key real de Tavily
(`tvly-dev-...`, cuenta propia) — antes de esto, `handleSearchReferences`
solo se había probado devolviendo `serper_not_configured`/
`tavily_not_configured`. Con la clave real configurada (`.env`, ignorado por
git) se verificó una búsqueda real de dos consultas mineras
("geotechnical slope stability open pit mine", "tailings dam safety
guidelines mining"): Tavily devolvió resultados reales y el filtro local de
dominios de confianza los redujo correctamente a fuentes académicas/
institucionales genuinas (`sciencedirect.com`, `mdpi.com`, `icmm.com`,
`smenet.org`, `stacks.cdc.gov`) — nunca blogs/Scribd/etc. Confirma en runtime
real (no solo en código) que el LLM nunca decide confiabilidad; solo el
filtro de dominios lo hace, como ya declaraba este ADR.

**Status**: implemented, verificado por build y runtime (2026-07-24)
**Fecha**: 2026-07-22
**Autores**: EC
**Ámbito**: ia
**Relación**: refina ADR-001/024; reemplaza el alcance único del presupuesto O6 de ADR-023 para tareas generativas.

## Contexto

El corrector original usaba LanguageTool y un único modelo Ollama. Las pruebas
reales demostraron que `tinyllama` podía producir texto ajeno al original y no
era apto para referencias. Un benchmark de 20 iteraciones por tarea comparó
`gemma2:2b` y `qwen2.5:7b`: el primero fue más rápido y fiel en reescritura,
mientras el segundo fue más fiable para APA 7, pero más lento.

ReportStudio también necesitaba localizar fuentes reales. Pedir al LLM que
"recuerde" bibliografía no es aceptable: puede inventarla. La búsqueda real
requiere salida HTTPS a un proveedor, lo que debe reconciliarse con la
soberanía de ADR-001/024.

## Decisión

1. **Corrección fiel**: LanguageTool on-premise es la autoridad para
   ortografía/gramática y solo autoaplica categorías seguras.
2. **Reescritura**: Ollama local con `gemma2:2b`.
3. **Formato APA 7**: Ollama local con `qwen2.5:7b`; si la respuesta omite o
   altera título/año, se descarta y se usa un formateador determinístico.
4. **Búsqueda bibliográfica**: Tavily es proveedor preferido y Serper el
   fallback, ambos opt-in por variable de entorno. La respuesta se filtra
   localmente por dominios académicos/institucionales permitidos.
5. **Verificación de URL**: Tavily `/extract` solo obtiene el contenido de la
   URL elegida; la coincidencia de título/año se calcula localmente.

### Límite de soberanía

La excepción externa cubre exclusivamente una consulta bibliográfica que el
usuario escribe y envía de forma explícita, y metadatos de una referencia
(URL, título, año). No se envían automáticamente cuerpo del informe,
telemetría, tenant, ubicación exacta, incidentes, identidades ni prompts de
reescritura. Sin API key, la búsqueda devuelve `503`; corrección, reescritura
y formato APA continúan on-premise.

### Presupuesto de rendimiento

O6 de ADR-023 (<1 s/párrafo) sigue vigente para corrección automática
LanguageTool/reglas. No es un presupuesto realista para generación LLM local:
el benchmark observado fue aproximadamente p50 7 s (`gemma2:2b`, rewrite) y
18 s (`qwen2.5:7b`, APA). Esas acciones son asíncronas y muestran estado de
progreso. Esta separación reemplaza el alcance único anterior de O6 sin
relajar los demás SLA.

## Consecuencias

- Se evita usar un modelo único fuera de su tarea óptima y se reduce el riesgo
  de alucinación bibliográfica.
- Ollama mantiene dos modelos calientes y eleva su límite a 12 GiB; es una
  decisión de capacidad explícita.
- La búsqueda depende de conectividad y de un tercero, pero no es necesaria
  para editar ni corregir informes.
- La confianza del dominio no garantiza la exactitud científica del
  contenido; la UI exige revisión humana antes de insertar.

## Alternativas descartadas

- **`tinyllama` para todo**: descartado por alucinaciones verificadas.
- **Un único modelo grande**: peor latencia/RAM y menor fidelidad por tarea.
- **Bibliografía generada por LLM**: no verificable y propensa a invención.
- **Enviar el informe completo a búsqueda/IA cloud**: viola ADR-001/024.

## Evidencia y referencias

- `backend/src/text_spell_service.cpp`, `backend/src/text/text_routes.cpp`
- `frontend/src/components/ReportStudioV2/components/modals/Apa7CitationModal.tsx`
- `docker-compose.yml`, `scripts/ensure-ollama-model.ps1`
- Runtime 2026-07-24: `gemma2:2b` y `qwen2.5:7b` instalados; backend saludable,
  rutas `/api/text/*` autenticadas; Tavily configurado y Serper deshabilitado.

