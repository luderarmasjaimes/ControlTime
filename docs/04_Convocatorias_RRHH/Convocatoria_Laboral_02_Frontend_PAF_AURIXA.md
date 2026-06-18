# Convocatoria Laboral — Documento 2 de 2
## Frontend Senior FE1 · Profesional de Apoyo Funcional (PAF)

> **Proyecto:** Plataforma de reportabilidad e informes técnicos avanzados — AURIXA  
> **Duración:** 6 meses (implementación)  
> **Modalidad:** Remoto / híbrido con coordinación en LATAM  

Este documento contiene **dos convocatorias** del equipo núcleo de producto y gestión:

| # | Rol | Código cronograma | Inicio |
|---|-----|-------------------|--------|
| A | Frontend Senior | **FE1** | **Mes 1** (único frontend activo en junio) |
| B | Profesional de Apoyo Funcional | **PAF** | Mes 1 al 6 |

---

# PARTE A — Frontend Senior FE1

> **Nivel:** Senior exclusivamente (6+ años React, 8+ años desarrollo web). No semi-senior.

---

## Texto para publicar — FE1 (copiar desde aquí)

---

**Convocatoria abierta: Frontend Senior FE1 — ReportStudio e informes técnicos mineros enterprise**

Organización del sector **industrial y minero** busca un **Frontend Senior** para liderar la construcción de la interfaz de una plataforma de informes técnicos avanzados: editor tipo Word (TipTap), mapas GIS, telemetría en vivo, exportación documental y experiencia optimizada para tablets de campo en zonas con conectividad limitada.

**Inicio:** Mes 1 del proyecto (junio 2026). FE1 es el **único desarrollador frontend activo en el primer mes**.  
**Duración:** 6 meses, dedicación alta.  
**Modalidad:** Remoto / híbrido.

---

### Misión del rol

Construir la **experiencia de usuario de clase mundial** del informe técnico minero enterprise en LATAM:

- Editor ReportStudio (TipTap) con paridad funcional cercana a procesadores ofimáticos.
- **Operación offline completa** con guardado local y sincronización transparente al reconectar.
- **Múltiples borradores** de informe simultáneos por usuario.
- **Pegado de imágenes** desde navegador web y WhatsApp Web directamente al informe.
- **Teclas rápidas empresariales** para todas las funcionalidades frecuentes.
- **Navegación optimizada**: menos pasos en menús y accesos directos a tareas operativas.
- **Maximización del lienzo**: ocultamiento automático de barra superior en funcionalidades internas.
- **Paneles laterales icon-only** cuando no están en uso activo (sin textos redundantes).
- Integración con backend C++/PostgreSQL, WebSocket en tiempo real y APIs de IA local.

---

### Responsabilidades principales

#### Mes 1 — Arranque exclusivo FE1

- Levantar arquitectura **React 18 + Vite**, routing, design tokens y shell navegable del ReportStudio.
- Definir contratos API con BE1/DBA y validar integración temprana con ARQ.
- Implementar prototipos funcionales de login, layout principal y primeras pantallas del editor.

#### Editor ReportStudio (Meses 2–4)

- Motor TipTap V2: estilos, tablas, imágenes, reglas, TOC automática, paginación A4/A3.
- Toolbar Ribbon retráctil con estilos Título/H1/H2/Normal, color, fuentes e interlineado.
- Autosave cada 2 segundos vía WebSocket; indicadores de estado de guardado.
- Workflow de aprobación, firma digital UI, comparador de versiones y galería de plantillas.

#### Nuevos alcances UX industrial (Meses 3–5)

| Alcance | Entregable FE1 |
|---------|----------------|
| **Offline** | UI con IndexedDB, badge online/offline/syncing, cola local y resolución de conflictos |
| **Borradores múltiples** | Bandeja de borradores, preview, duplicar, promover a informe formal |
| **Paste imagen web/WhatsApp** | Clipboard paste, drag-drop, compresión y preview en canvas TipTap |
| **Teclas rápidas** | Mapa Ctrl+/ con búsqueda fuzzy; atajos editor, navegación y exportación |
| **Menú optimizado** | Favoritos, breadcrumbs, -40% clics en flujos top-10 mineros |
| **Ribbon auto-hide** | Ocultar barra superior al entrar a editor/mapa/streaming |
| **Sidebars icon-only** | Paneles izq/der colapsados a iconos; expand on hover/focus |

#### Integración y cierre (Meses 4–6)

- Dashboard gerencial KPIs, mapas Leaflet/GIS, streaming WebRTC de cámaras.
- Gráficos Recharts conectados a telemetría C++ en tiempo real.
- Soporte a UAT, marcha blanca y ajustes UX post-feedback de operadores mineros.
- Coordinación con FE2 (desde mes 2) en pruebas de campo y accesibilidad industrial.

---

### Requisitos obligatorios

| Área | Detalle |
|------|---------|
| Experiencia | 6+ años React/TypeScript en producción; 8+ años desarrollo frontend |
| Editor rich-text | TipTap, ProseMirror o Slate con extensiones custom |
| Offline-first | Service Worker, IndexedDB, estrategias sync y UX de reconexión |
| Real-time | WebSocket, estado reactivo (Zustand/Redux), reconexión automática |
| UX industrial | Tablets de campo, guantes, modo oscuro, alto contraste |
| GIS | Leaflet/Mapbox integrado a datos en vivo (deseable obligatorio para proyecto) |
| Calidad | ESLint, Prettier, tests E2E (Cypress/Playwright), revisión en Git |
| Colaboración | Git + ClickUp en equipos ágiles multidisciplinarios |
| Idioma | Español fluido; inglés técnico de lectura |

---

### Deseable

- Office UI Fabric / Fluent UI como referencia de Ribbon toolbar.
- Experiencia con exportación PDF client-side (html2canvas, jsPDF).
- PWA y Workbox para operación offline robusta.
- Accesibilidad WCAG 2.1 AA en entornos industriales.
- Experiencia en minería, oil & gas o manufactura pesada en LATAM.

---

### Entregables esperados

- ReportStudio operativo con todos los alcances A–G del SOW ampliado.
- Integración frontend-backend validada en 13 suites QA funcionales.
- UX validada con operadores mineros en pruebas de campo (tablets).
- Documentación de componentes y guía de atajos de teclado.

---

### Cómo postular — FE1

Envía CV en PDF y respuesta breve (máx. 1 página) con:

1. Dos proyectos con **editor rich-text** o experiencia documental compleja.
2. Un caso de **modo offline / sync** en aplicación web.
3. Capturas o demo de **UX optimizada** (menos clics, atajos, paneles colapsables).
4. Experiencia con **React + WebSocket + mapas** en producción.
5. Disponibilidad de inicio **mes 1** y herramientas (**Git**, **ClickUp**).

**Contacto:** LUDER.EDER.ARMAS.JAIMES.LEAJ@GMAIL.COM  
**Asunto:** `Senior Frontend FE1 ReportStudio — [Tu nombre]`

---

**#Hiring #FrontendSenior #React #TipTap #UX #OfflineFirst #GIS #WebSocket #Minería #LATAM #Industria40**

---

# PARTE B — Profesional de Apoyo Funcional (PAF)

> **Perfil:** Analista funcional · Coordinador documentario · Soporte PMO · Capacitador  
> **Nivel:** Semi-senior a Senior en gestión de proyectos TI y documentación funcional (5+ años)

---

## Texto para publicar — PAF (copiar desde aquí)

---

**Convocatoria abierta: Analista Funcional y Soporte PMO (PAF) — Proyecto plataforma minera enterprise**

Organización busca un profesional para **soporte documentario, analisis funcional, coordinacion de proyecto y capacitacion** en un megaproyecto de software minero de 6 meses con equipo de 10 especialistas.

**Duración:** 6 meses completos (mes 1 al 6).  
**Modalidad:** Remoto / híbrido.

---

### Misión del rol

Ser el **eje operativo de gestión documental y coordinacion** entre equipo tecnico, Project Manager (ARQ) y gerencia minera:

- Mantener **ClickUp** actualizado: estados, fechas, dependencias y bloqueos.
- **Generar y convocar reuniones**: dailies, sprint reviews, comites ejecutivos y workshops.
- Redactar **actas, minutas y action items** con seguimiento hasta cierre.
- Elaborar y actualizar **manuales funcionales**, quick-start y material de capacitacion.
- Mantener **matriz de trazabilidad** requisito–tarea–modulo y correspondencias FE↔BE.
- Apoyar al PM en **reportes de avance**, riesgos y comunicacion con gerencia.
- **Capacitar usuarios** en nuevas funcionalidades (offline, borradores, atajos, UX optimizada).
- Coordinar **UAT**: escenarios de prueba, log de incidencias y priorizacion con ARQ/QA.

---

### Responsabilidades detalladas

#### Gestión PMO y reuniones

- Actualizacion semanal de 400+ tareas en ClickUp con % avance real.
- Convocatorias, agendas, salas virtuales y recordatorios para 10 recursos + gerencia.
- Actas de cada ceremonia agile con action items, responsable y fecha compromiso.
- Boletines quincenales de avance, alertas de vencidos y escalamiento de bloqueos.

#### Documentacion funcional

- Manuales no tecnicos: crear informe, sensores, mapas, alertas, exportacion.
- Catalogo de requerimientos funcionales y matriz RACI del proyecto.
- Documentacion de nuevos alcances: offline, borradores multiples, paste imagen, shortcuts.
- Kit de cierre: indice documentacion, lecciones aprendidas y acta de transferencia.

#### Analisis funcional

- Levantamiento y validacion de flujos BPMN de aprobacion documental.
- Trazabilidad requisito–dato–pantalla con BE1 y FE1.
- Soporte a change requests con impacto documentado en cronograma.

#### Capacitacion

- Plan de talleres mes 5–6 para supervisores y operadores mineros.
- Guias quick-reference: atajos de teclado, modo offline, gestion de borradores.
- Acompanamiento presencial/hibrido en marcha blanca y primeras semanas post go-live.

---

### Requisitos obligatorios

| Área | Detalle |
|------|---------|
| Experiencia | 5+ años en analisis funcional, documentacion o PMO en proyectos TI |
| Herramientas | ClickUp, Jira o Azure DevOps; dominio de Excel y Markdown/Word |
| Documentacion | Manuales de usuario, actas, procedimientos operativos, matrices RACI |
| Comunicacion | Redaccion ejecutiva clara; coordinacion de multiples stakeholders |
| Metodologia | Scrum/Kanban; ceremonias agile y seguimiento de action items |
| Sector | Proyectos enterprise, industrial, minero o utilities (deseable fuerte) |
| Idioma | Español nativo o fluido; ingles de lectura para documentacion tecnica |

---

### Deseable

- Experiencia como **capacitador** de usuarios finales no TI en operaciones de campo.
- Conocimiento basico de arquitectura web (frontend/backend) para dialogo con devs.
- Certificacion PMP, Scrum Master o ITIL Foundation.
- Familiaridad con ISO 9001 / documentacion para auditorias.

---

### Entregables esperados

- ClickUp actualizado semanalmente con trazabilidad completa.
- 100% de actas de reuniones con action items cerrados o escalados.
- Manuales funcionales validados por QA y usuarios piloto.
- Plan de capacitacion ejecutado en marcha blanca y go-live.
- Paquete de cierre documental entregado a gerencia minera.

---

### Cómo postular — PAF

Envía CV en PDF y respuesta breve (máx. 1 página) con:

1. Dos proyectos donde hayas liderado **documentacion funcional o PMO**.
2. Ejemplo de **acta de reunion** o manual de usuario que hayas redactado (extracto anonimizado).
3. Experiencia con **ClickUp o herramienta equivalente**.
4. Un caso de **capacitacion a usuarios** no tecnicos.
5. Disponibilidad de dedicacion alta durante 6 meses.

**Contacto:** LUDER.EDER.ARMAS.JAIMES.LEAJ@GMAIL.COM  
**Asunto:** `Analista Funcional PAF / PMO — [Tu nombre]`

---

**#Hiring #AnalistaFuncional #PMO #Documentacion #ClickUp #Capacitacion #GestionProyectos #Minería #LATAM**

---

## Versión corta LinkedIn (ambos roles)

> **2 convocatorias — Plataforma minera enterprise LATAM**  
> **FE1 Frontend Senior** (mes 1–6): React, TipTap, offline, UX industrial.  
> **PAF Analista Funcional**: ClickUp, actas, manuales, capacitacion, soporte PM.  
> CV a LUDER.EDER.ARMAS.JAIMES.LEAJ@GMAIL.COM. #Hiring #Frontend #PMO #Minería

---

## Checklist antes de publicar

- [x] Contacto de postulación: LUDER.EDER.ARMAS.JAIMES.LEAJ@GMAIL.COM
- [ ] FE1: confirmar fecha inicio mes 1 con ARQ.
- [ ] PAF: confirmar que el candidato acepta rol transversal (no solo redactor).

---

*Documento interno — Convocatoria 2/2. Última revisión: mayo 2026.*
