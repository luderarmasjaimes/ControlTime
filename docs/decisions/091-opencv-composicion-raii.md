# ADR-091 — Procesamiento de Imágenes y Composición (C++ OpenCV RAII)

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-08-05 |
| **Decisor(es)** | Arquitecto TI |
| **Relacionado** | CANDIDATE E6 |

## Contexto
El sistema Backend en C++ necesita manipular imágenes pesadas y componer mapas con marcas de agua para la generación de reportes y validaciones de EPP (Equipos de Protección Personal). El uso incontrolado de buffers de imagen puede causar fugas de memoria severas en un entorno concurrente (microservicio C++ con miles de peticiones). Originalmente (Candidato E6) se decidió usar OpenCV.

## Decisión
- **OpenCV** es la librería oficial para decodificación, manipulación y composición de imágenes (`cv::Mat`).
- Se adopta obligatoriamente el paradigma **RAII (Resource Acquisition Is Initialization)**. Todo `cv::Mat` o buffer de imagen en memoria debe estar atado al ciclo de vida de un objeto inteligente (scopes locales o smart pointers) para asegurar la liberación automática de memoria de la GPU/RAM tan pronto como la petición HTTP finalice.
- Las funciones de composición (ej. superponer pines de mapa sobre cartografía offline) se ejecutarán en un pool de hilos separado (worker pool) para no bloquear el Event Loop principal de Boost.Asio.

## Consecuencias
- Mayor estabilidad y consumo de RAM predecible en el Gateway C++.
- Restricción: Los desarrolladores Backend no pueden usar librerías de imagen que requieran liberación manual (`free()`, `delete`) sin envolverlas en RAII.
