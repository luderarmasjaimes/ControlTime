---

# STATEMENT OF WORK (SOW)

## PLATAFORMA INTEGRAL DE MONITOREO Y GESTIÓN DOCUMENTAL PARA OPERACIONES MINERAS

---

**Documento**: SOW-AURIXA-2026-001  
**Versión**: 2.0 (Arquitectura Soberana VPS Lima)  
**Clasificación**: CONFIDENCIAL — USO INTERNO  
**Fecha de Emisión**: 12 de Mayo de 2026  
**Fecha de Vigencia**: A partir de la firma  

---

**ELABORADO POR:**  
Arquitecto TI Senior / Project Manager (LATAM)  
Dirección de Tecnología e Innovación  

**REVISADO POR:**  
Gerencia de Tecnología de la Información  

**APROBADO POR:**  
Gerencia General  

---

## CONTROL DE VERSIONES

| Versión | Fecha | Autor | Descripción del Cambio |
|---------|-------|-------|------------------------|
| 0.1 | 15-04-2026 | Arquitecto TI | Borrador inicial (Cloud Based) |
| 1.0 | 05-05-2026 | Arquitecto TI | Versión final AWS |
| 2.0 | 12-05-2026 | Arquitecto TI | **Migración Total a Infraestructura VPS Linux Local (Lima)** |

---

## 1. PROPÓSITO Y CONTEXTO ESTRATÉGICO

### 1.1 Propósito

El presente Statement of Work (SOW) establece de manera vinculante el alcance, los entregables, los hitos, los niveles de servicio y las condiciones de ejecución para la plataforma **AURIXA**, ahora optimizada para funcionar en servidores locales de alto rendimiento en Lima, Perú, garantizando la soberanía de los datos y latencias mínimas.

### 1.2 Contexto del Negocio

La operación minera requiere una solución que no dependa de la nube internacional para procesos críticos:
- **Soberanía de Datos**: La información estratégica debe residir en servidores controlados dentro del territorio nacional.
- **Velocidad de Respuesta**: Reducción de latencia de 120ms (USA) a <20ms (Local) para monitoreo de sensores.
- **Eficiencia de Costos**: Eliminación de costos variables por tráfico de datos en la nube.

### 1.3 Visión del Producto (Arquitectura VPS Soberana)

1. Un **editor documental tipo Word** (ReportStudio) con herramientas familiares para el usuario.
2. **Monitoreo de 10,000 sensores** mediante una base de datos de alta velocidad local (**TimescaleDB**).
3. **Procesamiento inmediato de datos**: Uso del motor **Redpanda** (Software Libre) para recibir miles de señales por segundo sin errores.
4. **Mapas Digitales**: Visualización de la mina con sensores moviéndose en vivo sobre planos satelitales.
5. **Funcionamiento sin Internet**: Capacidad de trabajar en el socavón y sincronizar automáticamente al detectar señal.
6. **Inteligencia Artificial Local**: Corrección de textos y reconocimiento facial procesado en servidores propios en Lima, sin enviar fotos a la nube.
7. **Infraestructura Blindada**: Clúster de servidores Linux en centros de datos de Lima con soporte técnico regional.

### 1.4 Objetivos Medibles (KPIs)

| # | Objetivo | Métrica | Meta (Target) |
|---|----------|---------|---------------|
| O1 | Rapidez de la pantalla | Retraso visual | <20ms (Prácticamente instantáneo) |
| O2 | Guardado seguro | Tiempo de auto-guardado | <0.5 segundos |
| O3 | Generación de reportes | Tiempo de creación de PDF | <5 segundos |
| O4 | Capacidad de carga | Sensores conectados | **10,000 funcionando a la vez** |
| O5 | Estabilidad del sistema | Disponibilidad anual | >99.9% del tiempo activo |
| O6 | Inteligencia Artificial | Rapidez de corrección | <1 segundo por párrafo |
| O7 | Ubicación Satelital | Precisión en mapas | <1 metro de error |

---

## 3. ALCANCE DEL PROYECTO (MIGRACIÓN VPS)

### 3.1 Alcance por Etapas

#### ETAPA 1 — Construcción del Núcleo del Sistema (Meses 1–4)

- **Editor Maestro**: Creación del entorno de escritura tipo Word con todas las funciones de formato.
- **Cerebro del Sistema**: Motor central en C++ que gestiona la seguridad y los documentos.
- **Recolector de Datos**: Sistema para recibir información de sensores mineros en tiempo real.
- **Mapas en Vivo**: Pantalla para ver la ubicación de personal y maquinaria sobre el plano minero.
- **Modo Offline**: Posibilidad de crear y editar informes sin conexión a internet.

#### ETAPA 2 — Hardening, IA Avanzada, Performance y Go-Live (Meses 5–6)

- **Servidores en Lima**: Instalación y configuración de los servidores físicos (VPS) en el centro de datos local.
- **Seguridad Avanzada**: Encriptación de grado bancario para proteger la información minera.
- **Inteligencia Artificial de Visión**: Sistema para detectar si el personal usa casco y chaleco mediante cámaras.
- **Reconocimiento de Voz**: Dictado de informes técnicos directamente al sistema.
- **Marcha Blanca**: Periodo de prueba con datos reales en la unidad minera antes del lanzamiento final.

### 3.2 Tabla de Tecnologías (Software Libre)

| Capa | Tecnología Seleccionada | Beneficio |
|------|-----------|-----------|
| **Servidores** | Linux (Ubuntu/Rocky) | Estabilidad industrial sin costos de licencia OS. |
| **Bases de Datos** | PostgreSQL + TimescaleDB | Almacenamiento masivo de sensores (Gratuito/Libre). |
| **Ingesta de Datos** | **Redpanda (C++)** | Recibe 10k datos/seg con latencia mínima. |
| **Inteligencia Artificial** | **Ollama + DeepFace** | IA que vive en el servidor local, no en la nube. |
| **Mapas** | OpenStreetMap + MBTiles | Cartografía detallada que funciona sin internet. |
| **Almacenamiento** | **MinIO** | Tu propia "nube" de archivos dentro de tus servidores. |
| **Seguridad** | WireGuard + Nginx | Túneles de comunicación privados y seguros. |

---

## 5. ENTREGABLES POR ETAPA

### 5.1 Entregables Clave de la Etapa 1
1. **Editor de Texto Pro**: Con barras de herramientas idénticas a Word.
2. **Índice Automático**: Generación de tablas de contenido con un click.
3. **Mapas Satelitales**: Con sensores que cambian de color según su estado.
4. **Archivos Protegidos**: Formato ".miningreport" para llevar en USB o Tablet.
5. **Sincronización con Sistemas Antiguos**: Conexión con las bases de datos actuales de la mina.

### 5.2 Entregables Clave de la Etapa 2
1. **Infraestructura en Lima**: Clúster de servidores configurado y certificado.
2. **IA de Seguridad**: Detección de EPP (Casco/Chaleco) por video.
3. **Dictado por Voz**: Escribir informes hablando a la computadora o tablet.
4. **Plan de Desastres**: Copia de seguridad automática que recupera el sistema en <15 min.
5. **Capacitación**: Manuales y videos para todos los trabajadores.

---

## 8. ACUERDOS DE NIVEL DE SERVICIO (SLA)

| Categoría | Meta Esperada | Consecuencia de Incumplimiento |
|-----------|---------------|--------------------------------|
| **Rapidez del sistema** | Respuesta menor a 20ms | Optimización obligatoria en 48h |
| **Uptime (Activo)** | 99.9% del tiempo | Créditos de servicio a favor del cliente |
| **Pérdida de Datos** | 0% (Zero Data Loss) | Auditoría inmediata de seguridad |
| **IA de Redacción** | <1 segundo por respuesta | Ajuste de potencia de servidores |

---

## 10. GESTIÓN DE RIESGOS

- **Riesgo**: Corte de internet hacia el exterior de la mina.
    - *Mitigación*: Al usar servidores en Lima y modo offline, el sistema sigue funcionando normalmente.
- **Riesgo**: Falta de potencia para la Inteligencia Artificial.
    - *Mitigación*: Se han seleccionado VPS con aceleración gráfic para garantizar rapidez.
- **Riesgo**: Resistencia de los usuarios al nuevo software.
    - *Mitigación*: La interfaz es "Cero Curva de Aprendizaje" al ser igual a Microsoft Word.

---

## 14. PROPIEDAD INTELECTUAL

- **Código Fuente**: Será propiedad absoluta del Cliente una vez finalizado el proyecto.
- **Soberanía**: Todas las llaves maestras y credenciales de los servidores en Lima se entregarán formalmente al Gerente de TI del Cliente.

---

### FIRMAS DE APROBACIÓN

*(Espacio para firmas de Gerencia General, Gerencia de TI y Arquitecto Senior)*

---
*Documento generado por la Dirección de Arquitectura Senior LATAM - 2026*
