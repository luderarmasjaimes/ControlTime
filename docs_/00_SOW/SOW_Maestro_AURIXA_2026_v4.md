# STATEMENT OF WORK (SOW) — PLATAFORMA AURIXA

## Plataforma Integral de Telemetría, Trazabilidad y Automatización Minera con IA

---

**Documento:** SOW-AURIXA-2026-MAESTRO
**Versión:** 3.0 — Sincronizada con el Plan de Proyecto v36
**Clasificación:** Confidencial — Uso interno
**Fecha de emisión:** 17 de junio de 2026
**Calendario de ejecución:** 1 de junio – 30 de noviembre de 2026 (6 meses / 26 semanas)
**Estado:** Versión maestra para revisión y aprobación ejecutiva

---

## Control Documental

| Ítem | Detalle |
|---|---|
| Preparado por | Arquitectura TI Senior LATAM / PMO |
| Audiencia | Gerencia General, Líderes Técnicos y Gerencia TI |
| Naturaleza | Documento maestro de alcance, gobierno y aceptación del proyecto |
| Fuente de cronograma y tareas | Plan_Detallado_Etapas_1_y_2_v36.xlsx + Plan_Proyecto_Gerencia_Etapas_Sprints_v36.xlsx |
| Fuente de recursos | Documento_Gerencia_Distribucion_Recursos_v36 (10 recursos) |
| Metodología | Híbrida: Clásica (PMO + gates) + Scrum (sprints quincenales) |
| Trazabilidad de alcance | 100% de entregables mapeados a sprint, release y gate |

### Control de versiones

| Versión | Fecha | Cambio principal |
|---|---|---|
| 2.0 | 12-05-2026 | Migración a arquitectura soberana VPS Linux (Lima) |
| 3.0 (v36) | 17-06-2026 | Sincronización total con el plan de tareas v36: 10 recursos (incorpora PAF), 13 sprints, 6 releases, fechas reales y economía recalculada |

---

## 1. Resumen Ejecutivo

AURIXA es la plataforma con la que la operación minera deja de gestionar su información de forma dispersa y empieza a operar sobre una sola fuente de verdad: una solución que integra monitoreo de sensores en tiempo real, edición y trazabilidad documental, mapas operativos, continuidad de trabajo aun sin conectividad y automatización asistida por inteligencia artificial local.

El proyecto se ejecuta en **seis meses calendario, del 1 de junio al 30 de noviembre de 2026**, sobre una arquitectura soberana en servidores VPS Linux en Lima. Esta decisión no es solo técnica: significa que la información crítica del negocio reside en territorio nacional, con baja latencia, menor dependencia de la nube internacional y mayor control sobre los datos y la continuidad operativa.

Para gerencia, este documento cumple un único propósito: ser la **base de decisión y de control del proyecto**. Define qué se va a entregar, cuándo, con qué equipo, cómo se mide el avance y bajo qué criterios se acepta cada hito. No describe una idea: describe un plan ya estructurado, con un cronograma real de 13 sprints, seis puntos formales de control (releases) y un equipo de diez especialistas con carga asignada y trazable.

Aprobar este SOW es habilitar una nueva capacidad operativa para la compañía, gobernada desde el primer día y verificable en cada etapa.

### 1.1 Valor para Gerencia General y Gerencia TI

1. **Para Gerencia General:** control ejecutivo real, visibilidad de hitos y riesgos, y una salida a producción gobernada por puertas de decisión, no por percepciones.
2. **Para Gerencia TI:** una arquitectura medible y sostenible, con menor dependencia externa en procesos core y mayor control de disponibilidad, seguridad e integración.
3. **Para la operación minera:** menos tiempos muertos de información, mejor calidad del reporte técnico y respuesta ordenada ante alarmas, incidentes y condiciones de campo.
4. **Para la organización:** una base digital escalable para las siguientes fases de automatización y analítica operativa.

### 1.2 Beneficios esperados

| Beneficio | Impacto esperado |
|---|---|
| Centralización operativa | Menor dispersión de datos, reportes y evidencias |
| Respuesta más rápida | Mejor tiempo de reacción ante alarmas e incidentes |
| Mayor control gerencial | Visibilidad ejecutiva de hitos, riesgos y entregables |
| Continuidad operativa | Capacidad de operar aun con conectividad variable |
| Trazabilidad y auditoría | Control sobre cambios, acciones, aprobaciones y responsables |
| Base para escalar | Plataforma lista para crecimiento funcional y operativo |

---

## 2. Propósito y Justificación

Hoy la operación combina herramientas generales no trazables, integraciones parciales y limitaciones para trabajar con estabilidad en zonas de baja conectividad. AURIXA resuelve cinco frentes de negocio:

1. Reducir la dispersión de información técnica y operativa.
2. Consolidar datos de sensores, mapas y reportes en una sola vista de gestión.
3. Asegurar operación continua aun ante caídas de red o conectividad externa.
4. Mejorar la trazabilidad, el control de versiones y la capacidad de auditoría.
5. Preparar a la organización para una operación más segura, medible y escalable.

---

## 3. Objetivos Medibles (KPIs)

| Código | Objetivo | Métrica | Meta | Sprint de validación |
|---|---|---|---|---|
| O1 | Rapidez de visualización y respuesta | Retraso visual de pantalla | < 20 ms (local) | S9, S11 |
| O2 | Auto-guardado seguro | Tiempo por operación | < 0.5 s | S4 |
| O3 | Generación de reportes técnicos | Exportación PDF/Word | < 5 s | S7 |
| O4 | Capacidad de monitoreo | Sensores simultáneos | 10,000 a la vez | S6 (sim), S12 (estrés) |
| O5 | Estabilidad operacional | Disponibilidad anual | > 99.9% | S10, S13 |
| O6 | IA local de apoyo | Corrección por párrafo | < 1 s | S6, S11 |
| O7 | Trazabilidad y control | Acciones auditadas | 100% | S4, S8 |

### 3.1 Acuerdos de Nivel de Servicio (SLA)

| Categoría | Meta esperada | Consecuencia de incumplimiento |
|---|---|---|
| Rapidez del sistema | < 20 ms | Optimización obligatoria en 48 h |
| Uptime | 99.9% | Créditos de servicio a favor del cliente |
| Pérdida de datos | 0% (Zero Data Loss) | Auditoría inmediata de seguridad |
| IA de redacción | < 1 s por respuesta | Ajuste de capacidad de servidores |

---

## 4. Arquitectura Objetivo (VPS Soberana en Lima)

La arquitectura es soberana sobre VPS Linux en Lima, con integración controlada hacia sistemas y fuentes externas autorizadas. Cada capa cumple un propósito de negocio: la de aplicación soporta el trabajo diario; la de integración conecta con las fuentes actuales sin romper la continuidad; la de datos consolida histórico y trazabilidad; la de seguridad protege acceso e integridad; la de continuidad mantiene la operación ante fallas.

### 4.1 Stack tecnológico (software libre)

| Capa | Tecnología | Beneficio |
|---|---|---|
| Servidores | Linux (Ubuntu/Rocky) | Estabilidad industrial sin costo de licencia |
| Base de datos | PostgreSQL + TimescaleDB | Almacenamiento masivo de sensores |
| Ingesta de datos | Redpanda (C++) | 10k datos/seg con latencia mínima |
| Inteligencia artificial | Ollama + modelos ONNX/DeepFace | IA que vive en el servidor local, no en la nube |
| Mapas | OpenStreetMap + MBTiles | Cartografía detallada sin internet |
| Almacenamiento | MinIO | "Nube" de archivos dentro de los servidores propios |
| Seguridad | WireGuard + Nginx | Túneles privados y canal seguro |

### 4.2 Principios arquitectónicos

1. Soberanía de la información crítica.
2. Baja latencia para procesos sensibles al tiempo de respuesta.
3. Integración controlada con sistemas existentes, sin dependencia ciega del legado.
4. Trazabilidad de acciones y decisiones como requisito de negocio.
5. Escalabilidad progresiva, sin sobredimensionar la etapa inicial.

---

## 5. Metodología Híbrida (Clásica + Scrum)

El proyecto se gestiona combinando lo mejor de dos enfoques. Del modelo **clásico (PMO)** toma el gobierno por etapas, los gates de aprobación y el control formal de alcance, costo y riesgo. Del modelo **Scrum** toma la entrega incremental: el trabajo se organiza en **13 sprints quincenales** y al cierre de cada sprint hay una demostración (Sprint Review) donde gerencia ve avance real, no promesas.

Sobre esos sprints se definen **seis releases (R1–R6)**, que son los hitos formales de negocio. Cada release tiene un **gate PM**: una puerta de decisión donde se valida evidencia antes de avanzar.

| Concepto | Definición práctica para gerencia |
|---|---|
| Sprint | Ciclo de 2 semanas con un objetivo concreto y una demo al final |
| Release (R1–R6) | Hito de negocio que agrupa varios sprints y habilita el siguiente tramo |
| Gate PM | Punto formal de control donde se aprueba (o no) el paso de fase con evidencia |
| Sprint Review | Demostración funcional al cierre de cada sprint |

**Lectura gerencial:** el proyecto no avanza por acumulación de tareas, sino por cumplimiento verificable de resultados. Si un gate no se aprueba, no se avanza: así se evita el descontrol de alcance y las sorpresas al final.

---

## 6. Alcance por Etapas

### 6.1 Etapa 1 — Implementación Funcional Core

**Cobertura:** Junio a Septiembre 2026 (Sprints S1–S8 · Releases R1–R4).

En esta etapa se construye el corazón de la plataforma: arquitectura y base de datos, motor central en C++, accesos seguros, editor de informes tipo Word (ReportStudio), mapas mineros, integración de sensores, primeras capacidades de IA y el modo de trabajo offline. Es la fase que sostiene todo lo demás: si el núcleo queda bien resuelto, el endurecimiento posterior tiene base sólida.

**Resultados esperados de la Etapa 1:**

1. Documento marco aprobado y gobernanza activa.
2. Infraestructura base preparada en Lima.
3. Motor central y servicios core operativos.
4. Editor documental funcional, con experiencia familiar para el usuario.
5. Mapa operativo con sensores, zonas y eventos.
6. Integración inicial con la fuente externa autorizada e información histórica.
7. Primer ciclo completo de pruebas funcionales del núcleo.

### 6.2 Etapa 2 — Hardening, IA Avanzada y Go-Live

**Cobertura:** Octubre a Noviembre 2026 (Sprints S9–S13 · Releases R5–R6).

Aquí la plataforma funcional se transforma en una plataforma operable bajo exigencia real: blindaje de infraestructura, seguridad reforzada, recuperación ante desastres, prueba de carga con 10,000 sensores, IA avanzada (biometría, visión EPP, dictado por voz), UAT con usuarios de mina, marcha blanca y paso controlado a producción.

**Resultados esperados de la Etapa 2:**

1. Infraestructura endurecida y validada.
2. IA avanzada y seguridad visual integradas.
3. Plataforma preparada para volumen alto de eventos.
4. Pruebas de resiliencia, usuarios y continuidad superadas.
5. Marcha blanca ejecutada y estabilización inicial asistida.
6. Transferencia de control y cierre formal del proyecto.

---

## 7. Cronograma, Releases e Hitos

El proyecto se ejecuta en 13 sprints quincenales agrupados en 6 releases. Cada release cierra con un gate PM que gerencia interpreta como una puerta de validación.

| Release | Etapa | Sprint de cierre | Fecha gate | Criterio de aprobación | Aprueba | Evidencia requerida |
|---|---|---|---|---|---|---|
| R1 | Etapa 1 | S2 | 2026-06-30 | Diseño y arquitectura aprobados | ARQ | Acta gate + demo shell + esquema BD |
| R2 | Etapa 1 | S4 | 2026-07-31 | Motor operacional + seguridad base | ARQ | Demo telemetría + RBAC + VPS dev |
| R3 | Etapa 1 | S6 | 2026-08-31 | Editor + sensores + IA base | ARQ | Demo editor + mapa + sensores en vivo |
| R4 | Etapa 1 | S8 | 2026-09-30 | Sistema integrado e2e — FIN ETAPA 1 | Gerencia + ARQ | Demo offline + informe QA Etapa 1 |
| R5 | Etapa 2 | S11 | 2026-10-31 | Hardening + DR + optimización | ARQ + Gerencia TI | Pentest + simulacro DR + carga |
| R6 | Etapa 2 | S13 | 2026-11-30 | Go-Live producción — FIN PROYECTO | Gerencia General | Acta Go-Live + handover + kit documental |

### 7.1 Detalle de sprints (objetivo y demo)

| Sprint | Fechas | Release | Objetivo | Demo de cierre |
|---|---|---|---|---|
| S1 | 01–12 jun | R1 | Arranque y alcance acordado | Presentación ejecutiva de alcance e hitos |
| S2 | 15–26 jun | R1 | Base técnica y diseño de datos | Shell ReportStudio + diagrama de datos |
| S3 | 29 jun–10 jul | R2 | Motor del servidor y acceso seguro | Login + recepción de sensores en vivo |
| S4 | 13–24 jul | R2 | Permisos, guardado y telemetría base | Perfiles diferenciados + auto-guardado |
| S5 | 27 jul–07 ago | R3 | Editor de informes y mapa minero | Informe con formato + ubicación en mapa |
| S6 | 10–21 ago | R3 | Sensores, voz e IA base | Dashboard de 10k sensores + dictado |
| S7 | 24 ago–04 sep | R4 | Exportación e integraciones | Informe PDF + panel gerencial |
| S8 | 07–18 sep | R4 | Modo offline y validación integral E1 | Editar sin internet, reconectar y sincronizar |
| S9 | 21 sep–02 oct | R5 | Rendimiento y seguridad aplicativa | Informe de rendimiento + pentest |
| S10 | 05–16 oct | R5 | Continuidad y recuperación (DR) | Simulacro de recuperación + monitoreo |
| S11 | 19–30 oct | R5 | Optimización final pre-UAT | Comparativa de rendimiento + matriz de cierre |
| S12 | 02–13 nov | R6 | Estrés, UAT y marcha blanca | UAT en campo + prueba 10k + marcha blanca |
| S13 | 16–27 nov | R6 | Go-Live y transferencia | Sistema en producción + acta Go-Live |

---

## 8. Entregables Principales

### 8.1 Etapa 1

1. SOW maestro y paquete de arranque del proyecto.
2. Arquitectura objetivo, reglas de conectividad y niveles de servicio.
3. Infraestructura base en Lima.
4. Motor central de servicios, seguridad, trazabilidad y versionado.
5. Editor maestro de informes con tablas, estilos, plantillas y exportación.
6. Visualización GIS con sensores, capas y zonas operativas.
7. Integración con fuentes históricas y operativas autorizadas.
8. Modo de trabajo offline con mecanismo de reconciliación.
9. Pruebas funcionales del núcleo documentadas.

### 8.2 Etapa 2

1. Hardening completo de plataforma e infraestructura.
2. Canales seguros, cifrado y segmentación.
3. IA avanzada, biometría y detección de condiciones operativas (EPP).
4. Capacidad reforzada para monitoreo intensivo de fuentes de datos.
5. Plan de recuperación ante desastres y respaldo geográfico.
6. Evidencia de pruebas de estrés, seguridad y resiliencia.
7. UAT, marcha blanca y salida controlada a producción.
8. Capacitación, transferencia de control y cierre formal.

---

## 9. Equipo del Proyecto — 10 Recursos Especializados

El proyecto se ejecuta con un equipo de **diez recursos**, dimensionado para una carga del 90–100% en los meses activos de cada rol. Cada frente tiene un responsable claro, sin vacíos entre arquitectura, desarrollo, integración, calidad, infraestructura y PMO.

| Cód. | Rol | Función principal | Meses activos | Horas | Carga prom. |
|---|---|---|---|---|---|
| BE1 | Backend 1 — Core C++ / OpenCV / Sockets | Núcleo C++ tiempo real, telemetría, APIs core, exportación, cola offline | Jun–Nov | 978 h | 92.0% |
| BE2 | Backend 2 — Seguridad, Biometría, IA aplicada | RBAC/JWT/OWASP, biometría, gateway IA, auditoría de accesos | Jun–Nov | 985 h | 92.7% |
| BE3 | Backend 3 — DBA / AWS / ETL / Recovery | PostgreSQL, sync AWS, ETL, backups, replicación y DR de datos | Jun–Nov | 1,009 h | 95.0% |
| FE1 | Frontend 1 — Interfaces | Shell UI, editor ReportStudio, mapas, dashboards (único FE en mes 1) | Jun–Nov | 1,042 h | 98.0% |
| FE2 | Frontend 2 — UX y Soporte | UX tablet, accesibilidad industrial, pruebas de campo y UAT | Jul–Nov | 836 h | 94.5% |
| ARQ | Arquitecto TI / PMO | Gobierno técnico, gates R1–R6, DRP, UAT ejecutivo, go-live | Jun–Nov | 1,026 h | 96.5% |
| SYS | Infraestructura | VPS/Docker, CI/CD, Prometheus/Grafana, hardening, DRP técnico | Jul–Nov | 852 h | 96.3% |
| QA | Calidad | 13 suites funcionales, pentest funcional, load test 10k, UAT | Jul–Nov | 850 h | 96.1% |
| IA | IA-ML — Modelos | STT, NLP, OCR, biometría ONNX, visión EPP, modelos locales | Jul–Nov | 866 h | 97.9% |
| PAF | Soporte PMO — Analista Funcional | ClickUp, actas, trazabilidad requisito-entregable, manuales y capacitación | Jun–Nov | 997 h | 93.8% |

### 9.1 Por qué cada rol es obligatorio (lectura ejecutiva)

1. **BE1** es dueño del núcleo C++ en tiempo real: sin él no hay telemetría en vivo ni operación offline.
2. **BE2** concentra la seguridad y la IA aplicada; no es absorbible por el core sin sacrificar la ruta crítica.
3. **BE3** sostiene la base de datos, la integración con AWS y la recuperación: garantiza que el dato no se pierda.
4. **FE1** es el único frontend del mes 1; sin él, el cronograma se retrasa desde el arranque.
5. **FE2** valida la experiencia en condiciones reales de mina (guantes, poca luz, tablet), clave para la adopción.
6. **ARQ** gobierna las decisiones técnicas y firma los gates; es el sponsor técnico ante el directorio.
7. **SYS** asegura infraestructura, despliegues y disponibilidad: sin él no hay SLA sostenible.
8. **QA** aporta independencia de calidad exigida por auditoría: quien desarrolla no certifica.
9. **IA** posee la competencia de modelos (voz, visión EPP, biometría) que ningún otro rol cubre.
10. **PAF** libera carga de PMO de ARQ y del equipo, y es el único responsable de capacitación y trazabilidad documental.

---

## 10. Trazabilidad de Alcance (Cobertura 100%)

Cada entregable del SOW está vinculado a un sprint, una release y un gate. Esto garantiza que ningún alcance comprometido quede sin responsable ni sin punto de control.

| Etapa | Entregable / Alcance | Sprint(s) | Release | Gate / Criterio |
|---|---|---|---|---|
| E1 | SOW maestro y arranque del proyecto | S1 | R1 | Gate PM-0: aprobación de inicio |
| E1 | Arquitectura objetivo y niveles de servicio | S2 | R1 | Gate R1: diseño aprobado |
| E1 | Infraestructura base en Lima | S2–S4 | R1–R2 | Gate R2: VPS desarrollo operativo |
| E1 | Motor central: seguridad, trazabilidad, versionado | S3–S4 | R2 | Gate R2: motor + RBAC |
| E1 | Editor maestro de informes | S5 | R3 | Editor ReportStudio en demo |
| E1 | GIS: sensores, capas y zonas | S5–S6 | R3 | Gate R3: editor + GIS + dashboards |
| E1 | Integración con fuentes históricas/operativas | S3–S7 | R2–R4 | ETL POC S3, integración e2e S7 |
| E1 | Modo offline con reconciliación | S8 | R4 | Demo offline + sync sin pérdida |
| E1 | Pruebas funcionales del núcleo | S7–S8 | R4 | Gate R4 / FIN E1: e2e + acta QA |
| E2 | Hardening completo | S9 | R5 | Pentest OWASP + cierre P0/P1 |
| E2 | Canales seguros, cifrado, segmentación | S9–S10 | R5 | WireGuard/Nginx + cifrado validado |
| E2 | IA avanzada, biometría, visión EPP | S6, S11 | R3, R5 | Modelos afinados pre-UAT |
| E2 | Monitoreo intensivo 10k sensores | S6, S12 | R3, R6 | Estrés 10k cumple SLA |
| E2 | DR y respaldo geográfico | S10 | R5 | Simulacro DR < 15 min |
| E2 | Evidencia de estrés, seguridad y resiliencia | S9–S12 | R5–R6 | Load test incremental + informe |
| E2 | UAT, marcha blanca y salida a producción | S12–S13 | R6 | UAT aprobado + marcha blanca |
| E2 | Capacitación, transferencia y cierre | S13 | R6 | Gate R6 / FIN: Go-Live + handover |

---

## 11. Modelo de Gobernanza

| Nivel | Participantes | Frecuencia | Objetivo |
|---|---|---|---|
| Ejecutivo | Gerencia General, Sponsor, líder del proveedor | Mensual o por hito | Decisiones de continuidad, prioridad y escalamiento |
| Técnico | Gerencia TI, Arquitecto (ARQ), líderes funcionales | Semanal | Alcance, riesgos, dependencias y calidad |
| Operativo | PMO (PAF), responsables de frente, usuarios clave | Semanal | Avances, observaciones y coordinación de entregables |

Principios: un único control de alcance aprobado; revisión por gates, no por percepciones; registro formal de decisiones; gestión de cambios controlada; y escalamiento temprano de dependencias del cliente.

---

## 12. Criterios de Aceptación

Cada hito se aprueba con evidencia objetiva, no solo con demostraciones:

1. Entregable presentado formalmente al comité o contraparte.
2. Evidencia técnica o funcional disponible para revisión.
3. Validación de cumplimiento contra el objetivo del hito.
4. Observaciones clasificadas y tratadas dentro del plazo.
5. Conformidad expresa o tácita dentro de la ventana de revisión (5 días hábiles).

| Dominio | Criterio mínimo de aceptación |
|---|---|
| Editor documental | Edición, estilos, tablas, plantillas, guardado y exportación |
| Sensores y monitoreo | Visualización con trazabilidad y respuesta consistente |
| GIS | Mapa operativo con sensores y contexto relevante |
| Offline | Operar sin conectividad y reconciliar sin pérdida |
| Seguridad | Accesos, trazabilidad, cifrado y controles en entorno objetivo |
| IA | Funciones priorizadas operando en condiciones de negocio |
| Go-Live | UAT, marcha blanca y estabilización completadas |

---

## 13. Gestión de Riesgos

### 13.1 Riesgos de la Etapa 1

| Impacto | Riesgo | Respuesta de control | Responsable |
|---|---|---|---|
| Alto | Retraso en aprobación de arquitectura (Mes 1) | Gate ARQ semana 4 (S2), comité semanal | ARQ, PAF |
| Alto | Complejidad del núcleo C++ tiempo real | Modularización + revisiones de código quincenales | BE1, ARQ |
| Medio | Integración con AWS y datos legacy | ETL incremental, POC sync en S3 | BE3, SYS |
| Alto | Ampliación de alcance sin control | Change control formal aprobado por comité | ARQ, PAF |
| Alto | Seguridad incompleta antes de R4 | BE2 líder desde S3, gate de seguridad pre-R4 | BE2, QA |

### 13.2 Riesgos de la Etapa 2

| Impacto | Riesgo | Respuesta de control | Responsable |
|---|---|---|---|
| Alto | Hallazgos críticos en pentest OWASP | Pentest progresivo desde S9, buffer S11 | BE2, QA |
| Alto | Fallo en simulacro de recuperación (DR) | Simulacro S10, runbooks, segundo intento | BE3, SYS, ARQ |
| Alto | Carga 10k sensores no cumple SLA | Load test incremental S9–S12, tuning sockets | BE1, QA, SYS |
| Medio | Rechazo parcial en UAT de mina | FE2 acompaña en campo, marcha blanca S12 | FE2, QA, ARQ |
| Medio | Equipo al 95–100% sin margen | S13 dedicado a hotfixes, ARQ prioriza P0 | ARQ, PAF |

---

## 14. Supuestos, Dependencias y Exclusiones

### 14.1 Dependencias críticas del cliente

1. Definición de responsables de aprobación por hito.
2. Habilitación de accesos a fuentes de datos y ambientes requeridos.
3. Entrega de insumos funcionales para configuración y pruebas.
4. Disponibilidad de usuarios operativos para UAT y marcha blanca.

### 14.2 Exclusiones (salvo control de cambios)

1. Aplicaciones móviles nativas fuera del alcance descrito.
2. Integraciones con terceros ajenos a la fuente autorizada.
3. Personalizaciones ilimitadas por área u unidad.
4. Cambios introducidos fuera del proceso de gestión de cambios.
5. Soporte extendido más allá del periodo inicial de estabilización.

---

## 15. Gestión de Cambios

Todo cambio que afecte alcance, plazo, entregables o criterios de aceptación se procesa por solicitud formal, evaluación de impacto y aprobación del comité. No se incorporan cambios relevantes por vía informal, y los aprobados se reflejan en el plan maestro y en la trazabilidad de entregables.

---

## 16. Referencia Económica (Recalculada sobre 10 Recursos v36)

La estimación se recalcula a partir del equipo real de diez recursos del plan v36, con el método **tarifa mensual × meses activos**. Incorpora a PAF (antes no presupuestado) con tarifa de USD 1,500/mes.

### 16.1 Costo directo de recursos (base RR.HH.)

| Recurso | Tarifa/mes | Meses activos | Subtotal |
|---|---|---|---|
| BE1 | 1,900 | 6 | 11,400 |
| BE2 | 1,900 | 6 | 11,400 |
| BE3 | 1,900 | 6 | 11,400 |
| ARQ | 1,900 | 6 | 11,400 |
| IA | 1,900 | 5 | 9,500 |
| FE1 | 1,800 | 6 | 10,800 |
| FE2 | 1,800 | 5 | 9,000 |
| SYS | 1,800 | 5 | 9,000 |
| QA | 1,800 | 5 | 9,000 |
| PAF | 1,500 | 6 | 9,000 |
| **Base RR.HH.** | | | **USD 101,900.00** |

Distribución por etapa: **Etapa 1 = USD 65,500** · **Etapa 2 = USD 36,400**.

### 16.2 Presupuesto realista consolidado

| Concepto | Monto (USD) |
|---|---|
| Base RR.HH. (10 recursos) | 101,900.00 |
| Cargas de planilla (≈ 60.72%) | 61,873.68 |
| Equipamiento (laptops) | 19,800.00 |
| **Subtotal ampliado** | **183,573.68** |
| Contingencia (12%) | 22,028.84 |
| Reserva de gestión (5%) | 9,178.68 |
| **Total proyecto realista** | **214,781.20** |

### 16.3 Distribución mensual de la base de recursos

| Mes | Monto (USD) |
|---|---|
| Junio (6 recursos activos) | 10,900.00 |
| Julio | 18,200.00 |
| Agosto | 18,200.00 |
| Septiembre | 18,200.00 |
| Octubre | 18,200.00 |
| Noviembre | 18,200.00 |

Las cifras son referenciales y editables; sirven como marco ejecutivo de magnitud y secuencia de inversión. No reemplazan la propuesta económica contractual ni la estructura final de pagos.

---

## 17. Propiedad Intelectual y Confidencialidad

El código fuente y los entregables específicos desarrollados para el proyecto quedan bajo control del cliente conforme al acuerdo final. Todas las llaves maestras y credenciales de los servidores en Lima se transfieren formalmente a la Gerencia de TI. Toda información operativa, técnica y documental compartida se trata como confidencial.

---

## 18. Recomendación Ejecutiva

Se recomienda aprobar este SOW maestro v3.0 como base para habilitar el inicio formal del proyecto. El documento ya ordena alcance, equipo real, cronograma de 13 sprints, seis puertas de control y la economía recalculada con trazabilidad. La recomendación responde a tres prioridades de alta dirección: **control operacional, continuidad del negocio y trazabilidad ejecutiva**. La arquitectura soberana y la entrega por gates reducen el riesgo de una transformación desordenada y permiten gobernar el avance por resultados verificables.

---

## 19. Firmas de Aprobación

**Revisado por Gerencia TI**
Nombre: __________________________  Cargo: __________________________  Fecha: ____________

**Aprobado por Gerencia General**
Nombre: __________________________  Cargo: __________________________  Fecha: ____________

**Preparado por Arquitectura TI Senior LATAM / PMO**
Nombre: __________________________  Cargo: Arquitecto TI Senior / Project Manager  Fecha: 17-06-2026

---

## Anexos Recomendados

1. Plan detallado de tareas por sprint (Plan_Detallado_Etapas_1_y_2_v36.xlsx).
2. Plan gerencial de sprints, gates y carga de recursos (Plan_Proyecto_Gerencia_Etapas_Sprints_v36.xlsx).
3. Documento de distribución y obligatoriedad de recursos (v36).
4. Matriz de costos referencial recalculada (10 recursos).

**Nota de control:** este SOW consolida la narrativa ejecutiva y contractual del proyecto AURIXA sincronizada 1:1 con el plan de tareas v36, sus 13 sprints, sus 6 releases con gates PM y su equipo real de 10 recursos.
