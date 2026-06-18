# Resumen Ejecutivo — Proyecto AURIXA

## Plataforma Integral de Telemetría, Trazabilidad y Automatización Minera con IA

**Audiencia:** Gerencia General, Líderes Técnicos y Gerencia TI
**Versión:** sincronizada con el SOW Maestro v3.0 (SOW_Maestro_AURIXA_2026_v4) y el Plan de tareas v36
**Calendario:** 1 de junio – 30 de noviembre de 2026 (6 meses / 26 semanas)

---

## 1. Visión ejecutiva

AURIXA reemplaza la gestión dispersa de información minera por una **única plataforma soberana** que integra monitoreo de sensores en tiempo real, edición y trazabilidad documental, mapas operativos, trabajo offline y automatización asistida por IA local. La solución corre sobre **infraestructura VPS Linux en Lima**, no sobre AWS: la plataforma actual en AWS se mantiene únicamente como **fuente externa de datos**, integrada de forma controlada para no interrumpir el negocio.

**Resultado para gerencia:**
- Mayor control operativo y trazabilidad ejecutiva sobre la plataforma.
- Costos más previsibles al operar sobre infraestructura propia/contratada en Lima.
- Baja latencia (<20 ms) e independencia de una nueva nube pública para procesos core.
- Continuidad del negocio mediante integración controlada con la plataforma actual.

---

## 2. Estrategia de entrega

| Etapa | Duración | Sprints / Releases | Objetivo |
|---|---|---|---|
| **Etapa 1 — Core funcional** | 4 meses (Jun–Sep) | S1–S8 · R1–R4 | Núcleo funcional, editor documental, sensores, mapas, IA base, offline |
| **Etapa 2 — Hardening + Go-Live** | 2 meses (Oct–Nov) | S9–S13 · R5–R6 | Seguridad, DR, estrés 10k, IA avanzada, UAT y salida a producción |

**Metodología híbrida (Clásica + Scrum):** 13 sprints quincenales con demo de cierre, 6 releases (R1–R6) y gates PM que aprueban el avance con evidencia. El proyecto avanza por resultados verificables, no por acumulación de tareas.

---

## 3. Hitos de control (releases)

| Release | Fecha gate | Resultado de negocio |
|---|---|---|
| R1 | 30 jun | Arquitectura y diseño de datos aprobados |
| R2 | 31 jul | Motor operacional + seguridad base + VPS desarrollo |
| R3 | 31 ago | Editor, mapas, sensores e IA base operativos |
| R4 | 30 sep | Sistema integrado e2e — **fin Etapa 1** |
| R5 | 31 oct | Hardening, DR y optimización listos para UAT |
| R6 | 30 nov | **Go-Live en producción** — fin del proyecto |

---

## 4. Objetivos medibles (KPIs)

| O1 <20 ms render · O2 <0.5 s auto-guardado · O3 <5 s reportes · O4 10,000 sensores · O5 >99.9% uptime · O6 <1 s IA/párrafo · O7 100% trazabilidad |
|---|

---

## 5. Equipo — 10 recursos especializados

| Backend (3) | Frontend (2) | Gobierno y soporte (5) |
|---|---|---|
| BE1 Core C++ / Tiempo real | FE1 Interfaces / ReportStudio | ARQ Arquitecto TI / PMO |
| BE2 Seguridad / Biometría / IA aplicada | FE2 UX / Soporte / Pruebas de campo | SYS Infraestructura VPS |
| BE3 DBA / AWS / ETL / Recovery | | QA Calidad / Auditoría |
| | | IA Modelos (STT, NLP, visión EPP) |
| | | PAF Soporte PMO / Analista funcional |

Carga planificada del **90–100%** en meses activos (FE2, SYS, QA e IA inician en el mes 2). Detalle y obligatoriedad de cada rol en `docs/03_Gerencia_Informes/Documento_Gerencia_Distribucion_Recursos_v36`.

---

## 6. Inversión (referencial, recalculada sobre 10 recursos)

| Concepto | USD |
|---|---|
| Base RR.HH. (10 recursos) | 101,900.00 |
| Cargas de planilla (≈ 60.72%) | 61,873.68 |
| Equipamiento (laptops) | 19,800.00 |
| **Subtotal ampliado** | **183,573.68** |
| Contingencia (12%) | 22,028.84 |
| Reserva de gestión (5%) | 9,178.68 |
| **Total proyecto realista** | **214,781.20** |

Distribución mensual de la base de recursos: Junio USD 10,900 · Julio–Noviembre USD 18,200/mes. Detalle en `Matriz_Costos_Cronograma_26_Semanas` (.md/.xlsx).

---

## 7. Riesgos gestionados

- Dependencia de la base externa actual en AWS → tratada como riesgo formal con validación temprana de integración.
- Rendimiento de la infraestructura VPS → pruebas progresivas, hardening y load test 10k.
- Cierre de seguridad y continuidad antes del go-live → pentest OWASP y simulacro DR.
- Adopción de usuarios → UX validada en campo (FE2) y marcha blanca antes de producción.

---

## 8. Recomendación

Aprobar el inicio formal del proyecto sobre esta base. El programa ordena alcance, equipo real de 10 recursos, cronograma de 13 sprints, seis puertas de control y economía recalculada con trazabilidad — habilitando una transformación gobernada por resultados verificables y enfocada en control operacional, continuidad del negocio y trazabilidad ejecutiva.
