<style>
  :root {
    --ink: #18202a;
    --muted: #5d6978;
    --line: #d9e1e8;
    --panel: #f7f9fb;
    --gold: #b77a24;
    --green: #1f7a55;
    --blue: #1f5d8f;
    --red: #a33a3a;
  }
  body {
    color: var(--ink);
    font-family: "Segoe UI", Arial, sans-serif;
    line-height: 1.45;
  }
  .hero {
    border-top: 6px solid var(--gold);
    padding: 28px 0 18px;
    margin-bottom: 18px;
  }
  .eyebrow {
    color: var(--gold);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  h1 {
    font-size: 34px;
    line-height: 1.08;
    margin: 8px 0 10px;
  }
  h2 {
    border-bottom: 1px solid var(--line);
    font-size: 22px;
    margin-top: 28px;
    padding-bottom: 8px;
  }
  h3 {
    color: var(--blue);
    font-size: 16px;
    margin-bottom: 4px;
  }
  .lead {
    color: var(--muted);
    font-size: 17px;
    max-width: 980px;
  }
  .grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    margin: 18px 0;
  }
  .metric {
    background: var(--panel);
    border: 1px solid var(--line);
    border-left: 5px solid var(--blue);
    border-radius: 6px;
    padding: 13px 14px;
  }
  .metric strong {
    display: block;
    font-size: 24px;
  }
  .metric span {
    color: var(--muted);
    font-size: 13px;
  }
  .roadmap {
    border-collapse: collapse;
    margin: 16px 0;
    width: 100%;
  }
  .roadmap th {
    background: #edf2f6;
    color: #26323f;
    text-align: left;
  }
  .roadmap th, .roadmap td {
    border: 1px solid var(--line);
    padding: 9px 10px;
    vertical-align: top;
  }
  .status {
    border-radius: 999px;
    display: inline-block;
    font-size: 12px;
    font-weight: 700;
    padding: 3px 9px;
    white-space: nowrap;
  }
  .done { background: #e3f4ec; color: var(--green); }
  .progress { background: #e6f0fa; color: var(--blue); }
  .verify { background: #fff4de; color: #8a5a10; }
  .risk { background: #faeaea; color: var(--red); }
  .note {
    background: #fff8eb;
    border-left: 4px solid var(--gold);
    padding: 12px 14px;
  }
  .section-band {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 14px 16px;
  }
  .small {
    color: var(--muted);
    font-size: 13px;
  }
</style>

<div class="hero">
  <div class="eyebrow">Plataforma Minera Beemetry · Informe Ejecutivo</div>
  <h1>Mapa de Funcionalidades Implementadas y en Proceso</h1>
  <p class="lead">
    Presentación gerencial para Gerencia General y Gerencia TI sobre los avances de la nueva plataforma minera:
    seguridad, telemetría, integración operacional, documentos técnicos, analítica en tiempo real, geolocalización,
    auditoría y automatización asistida por IA.
  </p>
</div>

> **Alcance del documento.** Este informe consolida las funcionalidades indicadas por el equipo y las organiza en una vista ejecutiva. Las métricas marcadas como **por validar** deben confirmarse con evidencia de pruebas, logs, dashboards de observabilidad o reportes de QA antes de circularse como cifras contractuales.

## 1. Resumen Ejecutivo

La plataforma minera evoluciona desde un sistema operativo tradicional hacia una arquitectura integrada, auditable y preparada para operación en tiempo real. Los avances cubren cinco ejes principales:

- **Identidad y seguridad:** doble factor, geolocalización en login, auditoría avanzada, fotocheck digital con QR y refuerzo contra riesgos cibernéticos.
- **Operación minera digital:** zonas mineras en mapas, integración con GEOTMIN, ubicación geográfica de unidades mineras y validación de empresas vía información pública/tributaria.
- **Telemetría y sensores:** lectura desde smartphone, soporte de protocolos industriales, integración sensor-fórmula, dashboards en tiempo real y simulación contra réplica ThingsBoard.
- **Gestión documental:** OCR multiformato, exportación fiel a Word, importación de informes técnicos y pruebas con documentos de gran volumen.
- **Escalabilidad y continuidad:** réplica de bases de datos, sincronización con ThingsBoard, migración de fórmulas y pruebas de esfuerzo de ingesta/procesamiento/visualización.

<div class="grid">
  <div class="metric"><strong>23+</strong><span>frentes funcionales identificados</span></div>
  <div class="metric"><strong>5</strong><span>ejes estratégicos de transformación</span></div>
  <div class="metric"><strong>Tiempo real</strong><span>telemetría, procesamiento y dashboards</span></div>
  <div class="metric"><strong>Auditable</strong><span>trazabilidad operativa y seguridad reforzada</span></div>
</div>

## 2. Estado Consolidado de Funcionalidades

| # | Funcionalidad | Estado ejecutivo | Valor para gerencia |
|---:|---|---|---|
| 1 | Validación doble factor por correo y celular SMS | <span class="status progress">En implementación</span> | Eleva la seguridad de acceso y reduce riesgo de suplantación. |
| 2 | Fotocheck digital con QR para automatizar login | <span class="status progress">En implementación</span> | Facilita onboarding, acceso rápido y control de identidad operacional. |
| 3 | Importación avanzada de documentos con OCR | <span class="status progress">En implementación</span> | Digitaliza documentos PDF, BMP, JPG y PNG para búsqueda, extracción y trazabilidad. |
| 4 | Zonas mineras integradas con mapa | <span class="status progress">En implementación</span> | Permite visualizar activos, áreas de operación y contexto territorial. |
| 5 | Integración de GEOTMIN | <span class="status verify">Por validar alcance</span> | Enriquece la plataforma con información minera oficial y georreferenciada. |
| 6 | Flujo completo de telemetría con sensores de smartphone | <span class="status progress">En pruebas</span> | Demuestra captura, procesamiento y visualización en tiempo real. |
| 7 | Migración de fórmulas desde productivo al nuevo servidor | <span class="status progress">En implementación</span> | Reduce riesgo de pérdida funcional y asegura continuidad del cálculo operativo. |
| 8 | Exportación avanzada del informe técnico a Word | <span class="status progress">En implementación</span> | Mejora la calidad documental con texto fluido, sin cajas ni bloques de texto. |
| 9 | Exportación e importación de informe técnico entre usuarios | <span class="status progress">En implementación</span> | Habilita portabilidad, colaboración y continuidad entre áreas o consultores. |
| 10 | Integración motor de sensores con motor de fórmulas | <span class="status progress">En implementación</span> | Soporta multitenancy y personalización de cálculo por sensor. |
| 11 | Simulación de telemetría hacia réplica ThingsBoard | <span class="status progress">En pruebas</span> | Permite validar ingesta, latencia y comportamiento sin afectar producción. |
| 12 | Sincronización entre ThingsBoard productivo y nueva plataforma | <span class="status verify">Por validar alcance</span> | Asegura continuidad de datos y coexistencia durante transición tecnológica. |
| 13 | Réplica de base de datos primaria/secundaria | <span class="status progress">En implementación</span> | Mejora resiliencia, recuperación y disponibilidad operacional. |
| 14 | Pruebas de esfuerzo de ingesta de datos | <span class="status progress">En pruebas</span> | Confirma capacidad para recibir, procesar y visualizar alto volumen de datos. |
| 15 | Exportación de documento grande de más de 2,100 hojas | <span class="status progress">En pruebas</span> | Valida estabilidad documental en escenarios extremos de informe técnico. |
| 16 | Métricas operativas relevantes | <span class="status verify">Por consolidar</span> | Permite una lectura ejecutiva de rendimiento, calidad y confiabilidad. |
| 17 | Mejoras de ciberseguridad | <span class="status progress">En implementación</span> | Reduce exposición ante ataques y fortalece gobierno de accesos y datos. |
| 18 | Avatar minero como guía de tutorial automatizado | <span class="status progress">En diseño/implementación</span> | Mejora adopción, capacitación y autoservicio de usuarios. |
| 19 | Soporte de protocolos MQTT, OPC UA y smartphone telemetry | <span class="status progress">En implementación</span> | Amplía compatibilidad con sensores industriales y dispositivos móviles. |
| 20 | Geolocalización en login | <span class="status progress">En implementación</span> | Agrega auditoría real de ubicación del personal al acceder a la plataforma. |
| 21 | Conectividad a API SUNAT / proveedor de validación RUC | <span class="status verify">Por confirmar proveedor</span> | Permite validar datos reales de empresas mineras según información tributaria. |
| 22 | Ubicación geográfica de unidades mineras con fuentes públicas | <span class="status progress">En implementación</span> | Mejora precisión del mapa minero y reduce carga manual de ubicación. |
| 23 | Auditoría avanzada de operaciones y cambios | <span class="status progress">En implementación</span> | Fortalece trazabilidad, control interno y capacidad de investigación. |

## 3. Funcionalidades Clave para Gerencia General

### Seguridad de acceso y trazabilidad

Se ha priorizado el endurecimiento del acceso a la plataforma mediante doble factor por correo y SMS, geolocalización en el login y registro detallado de operaciones. Esta combinación permite responder tres preguntas críticas para gobierno corporativo: **quién ingresó, desde dónde ingresó y qué cambió dentro de la plataforma**.

Beneficios esperados:

- Disminución del riesgo de accesos no autorizados.
- Mayor control sobre usuarios internos, terceros y personal operativo.
- Evidencia auditable para investigaciones internas, cumplimiento y continuidad operacional.
- Base para políticas de acceso por ubicación, rol, horario y nivel de criticidad.

### Fotocheck digital con QR

El fotocheck digital automatiza el vínculo entre identidad del usuario y acceso a la plataforma. Al registrar un nuevo usuario, el sistema genera un fotocheck y lo envía automáticamente al correo registrado, incluyendo un QR que simplifica el ingreso y la validación.

Valor operacional:

- Reduce fricción en el proceso de alta de usuarios.
- Mejora la experiencia de ingreso, especialmente para personal de campo.
- Facilita controles de identidad en operaciones distribuidas.
- Puede integrarse con flujos de auditoría, asistencia, permisos o seguridad industrial.

### Documentos técnicos inteligentes

La plataforma incorpora dos capacidades críticas: importación con OCR y exportación avanzada a Word. El OCR permite procesar documentos de distintos formatos, mientras que la exportación a Word busca reproducir informes técnicos con alta fidelidad, priorizando texto fluido y editable, sin cajas de texto ni globos que dificulten la edición.

Impacto:

- Menor trabajo manual para digitalizar y reutilizar información.
- Informes más profesionales y editables para usuarios finales.
- Mejor interoperabilidad con procesos corporativos basados en Word.
- Capacidad de exportar e importar informes técnicos entre usuarios de la plataforma.

### Mapa minero, GEOTMIN y georreferenciación

La generación de zonas mineras integradas con mapas y la conexión con fuentes públicas confiables permiten ubicar unidades mineras, visualizar áreas de interés y apoyar decisiones territoriales. La integración con GEOTMIN debe confirmarse en alcance técnico exacto, pero el objetivo ejecutivo es claro: consolidar información geográfica minera dentro de una sola plataforma operacional.

### Telemetría, sensores y dashboards en tiempo real

La nueva plataforma soporta pruebas de flujo completo con sensores de smartphone, incluyendo acelerómetro, ubicación/geolocalización y otros datos disponibles desde el dispositivo. El flujo cubre captura, transmisión, procesamiento mediante fórmulas y visualización en dashboards en tiempo real.

Arquitectura funcional esperada:

1. Captura de datos desde sensor, smartphone o plataforma industrial.
2. Transmisión mediante protocolo soportado, como MQTT, HTTP/API, OPC UA o canal móvil seguro.
3. Ingesta en plataforma o réplica ThingsBoard.
4. Procesamiento con motor de fórmulas multitenant.
5. Persistencia y auditoría del dato.
6. Visualización en dashboard operativo.

## 4. Integración con ThingsBoard y Telemetría Industrial

La simulación de telemetría hacia una réplica de ThingsBoard permite probar la plataforma sin comprometer datos productivos. El mecanismo de integración se basa típicamente en APIs y protocolos soportados por ThingsBoard, especialmente:

- **MQTT telemetry API:** publicación de datos de sensores hacia dispositivos registrados.
- **HTTP telemetry API:** envío de lecturas mediante endpoint REST.
- **Device credentials / access token:** autenticación de dispositivos o gateways.
- **Rule chains:** procesamiento interno, enrutamiento y transformación de telemetría.
- **Dashboards:** visualización de series temporales, estados y alertas.

Indicadores a confirmar en pruebas:

| Métrica | Objetivo gerencial | Estado |
|---|---|---|
| Latencia de ingesta | Tiempo desde envío del sensor hasta recepción en plataforma | <span class="status verify">Por medir</span> |
| Latencia end-to-end | Tiempo desde sensor hasta visualización en dashboard | <span class="status verify">Por medir</span> |
| Throughput | Eventos por segundo procesados sin degradación | <span class="status verify">Por medir</span> |
| Tasa de error | Eventos rechazados, perdidos o duplicados | <span class="status verify">Por medir</span> |
| Resiliencia | Recuperación ante caída de red, réplica o base de datos | <span class="status verify">Por medir</span> |
| Consistencia | Diferencia entre ThingsBoard productivo, réplica y nueva plataforma | <span class="status verify">Por medir</span> |

<div class="note">
  <strong>Recomendación ejecutiva:</strong> antes de presentar cifras finales, consolidar un reporte técnico con fecha de prueba, volumen de eventos, número de sensores simulados, infraestructura usada, latencia promedio, percentil 95, percentil 99 y tasa de error.
</div>

## 5. Base de Datos, Réplicas y Continuidad Operacional

La réplica entre base de datos primaria y secundaria apunta a sostener disponibilidad, resiliencia y recuperación ante fallos. Para una lectura gerencial, el éxito de esta capacidad debe explicarse en términos de continuidad:

- **Disponibilidad:** la plataforma mantiene operación aun si un componente falla.
- **Recuperación:** la información puede restaurarse desde una réplica consistente.
- **Latencia de replicación:** tiempo entre escritura primaria y disponibilidad en secundaria.
- **Pérdida máxima aceptable de datos:** ventana de recuperación esperada.
- **Pruebas de conmutación:** validación de comportamiento ante caída del nodo principal.

Métricas sugeridas para incluir en el informe final:

| Indicador | Descripción | Valor actual |
|---|---|---|
| Replication lag | Diferencia temporal entre base primaria y secundaria | Por validar |
| RPO | Máxima pérdida aceptable de datos | Por definir |
| RTO | Tiempo objetivo de recuperación | Por definir |
| Disponibilidad mensual | Porcentaje de operación sin interrupción | Por medir |
| Prueba de failover | Resultado de caída controlada del nodo principal | Por ejecutar/validar |

## 6. Seguridad y Protección ante Riesgos Cibernéticos

Las mejoras de seguridad deben presentarse como un programa integral, no como controles aislados. Las capacidades implementadas o en proceso cubren prevención, detección, trazabilidad y respuesta.

Controles destacados:

- Doble factor por correo y SMS.
- Auditoría detallada de cambios, accesos y operaciones sensibles.
- Geolocalización durante login para reforzar trazabilidad.
- Separación por tenant y personalización por sensor para reducir exposición cruzada.
- Validación de identidad y datos empresariales mediante fuentes oficiales o proveedores autorizados.
- Fortalecimiento de trazabilidad documental en importaciones/exportaciones.
- Base para monitoreo de eventos anómalos, accesos inusuales y cambios críticos.

Riesgos mitigados:

- Suplantación de usuario.
- Acceso no autorizado desde ubicaciones no esperadas.
- Cambios no trazables sobre información técnica.
- Manipulación de fórmulas o datos de sensores sin evidencia.
- Pérdida de continuidad por fallos de base de datos o servicios de telemetría.

Recomendaciones de siguiente nivel:

- Pruebas de penetración sobre login, API, carga documental y endpoints de telemetría.
- Revisión OWASP ASVS para controles de autenticación, sesiones, autorización y auditoría.
- Gestión de secretos, rotación de tokens y segregación de ambientes.
- Monitoreo de logs de seguridad con alertas por eventos críticos.
- Validación de cifrado en tránsito y en reposo para documentos, credenciales y telemetría.

## 7. API SUNAT y Validación de Empresas

Para validar y extraer datos reales de empresas mineras tal como figuran en SUNAT, el componente debe conectarse a una fuente confiable de consulta RUC. En Perú, las alternativas habituales son:

- **SUNAT Consulta RUC:** servicio público de consulta de contribuyentes, disponible como portal y mecanismos de consulta.
- **Servicios autorizados o integradores privados de consulta RUC:** proveedores que exponen APIs comerciales sobre datos tributarios públicos.

<div class="note">
  <strong>Punto pendiente de confirmación:</strong> el nombre exacto del API/proveedor usado por la plataforma debe validarse contra configuración técnica, contrato, documentación interna o variables de entorno. No se recomienda afirmar un proveedor específico sin evidencia, porque puede comprometer la precisión del informe gerencial.
</div>

Datos esperados:

- RUC.
- Razón social.
- Estado y condición del contribuyente.
- Dirección fiscal.
- Actividad económica cuando esté disponible.
- Fecha de validación y fuente consultada.

## 8. Avatar Minero y Adopción de Usuarios

El avatar minero se plantea como guía automatizada de la plataforma. Su objetivo es reducir la curva de aprendizaje, acompañar al usuario en tareas frecuentes y ofrecer orientación contextual sobre módulos, informes, telemetría, mapas y carga documental.

Capacidades esperadas:

- Tutorial paso a paso para nuevos usuarios.
- Ayuda contextual según pantalla o proceso.
- Respuestas sobre uso de la plataforma minera.
- Guía para carga de documentos, generación de informes y lectura de dashboards.
- Base de conocimiento conectada a documentación funcional y procedimientos internos.

Valor para gerencia:

- Menor dependencia de soporte manual.
- Mayor adopción de la nueva plataforma.
- Entrenamiento homogéneo para usuarios distribuidos.
- Reducción de errores operativos por desconocimiento.

## 9. Pruebas, Rendimiento y Calidad

Los frentes de prueba más relevantes para presentar a gerencia son:

| Prueba | Objetivo | Evidencia recomendada |
|---|---|---|
| Flujo completo de telemetría smartphone | Validar captura, transmisión, fórmula y dashboard | Video, logs, dashboard y reporte de latencia |
| Ingesta masiva de datos | Medir capacidad de eventos por segundo | Reporte de carga, CPU, memoria, errores y percentiles |
| Exportación Word de gran volumen | Confirmar estabilidad con más de 2,100 hojas | Documento generado, tiempo total y consumo de memoria |
| OCR multiformato | Validar extracción sobre PDF/BMP/JPG/PNG | Muestras, tasa de reconocimiento y errores por tipo |
| Réplica de base de datos | Validar resiliencia y continuidad | Lag, failover y consistencia |
| Sincronización ThingsBoard | Validar interoperabilidad productivo-réplica-nueva plataforma | Conteo de eventos, diferencias y tiempos |

Métricas ejecutivas sugeridas:

- Tiempo promedio de generación de informe Word.
- Tiempo máximo observado en exportación de documento grande.
- Porcentaje de documentos OCR procesados exitosamente.
- Latencia promedio y percentil 95 de telemetría.
- Eventos por segundo soportados en prueba de esfuerzo.
- Tasa de error de ingesta.
- Tiempo de sincronización entre réplicas.
- Número de operaciones auditadas.
- Número de usuarios con 2FA habilitado.
- Número de sensores integrados por tenant.

## 10. Funcionalidades Relevantes Adicionales para Resaltar

Además de la lista inicial, se recomienda incluir los siguientes elementos por su valor estratégico en un proyecto minero moderno:

- **Multitenancy:** separación lógica de clientes, unidades, sensores o áreas operativas.
- **Motor de reglas y fórmulas:** capacidad de adaptar cálculos sin rehacer la plataforma base.
- **Trazabilidad ADR/SPEC:** gobierno técnico sobre decisiones, requisitos y cambios.
- **Pipeline IA de desarrollo:** apoyo a generación, revisión, routing y documentación técnica.
- **Observabilidad operacional:** logs, métricas y reportes de latencia para telemetría y documentos.
- **Gestión de fuentes oficiales:** integración con datos públicos confiables para unidades mineras y empresas.
- **Portabilidad documental:** exportación/importación de informes como activo reutilizable.
- **Preparación para continuidad operativa:** réplicas, sincronización y ambientes controlados de prueba.

## 11. Mensaje Ejecutivo Final

La nueva plataforma minera concentra avances relevantes para seguridad, operación en tiempo real, gestión documental y gobierno de datos. El valor principal no está solo en cada módulo individual, sino en la integración de todos ellos: **usuarios validados, sensores conectados, fórmulas configurables, mapas mineros, documentos técnicos, auditoría completa y dashboards en tiempo real**.

Para Gerencia General, el proyecto fortalece control, trazabilidad y capacidad de decisión. Para Gerencia TI, consolida una base tecnológica escalable, auditable y preparada para interoperar con plataformas industriales como ThingsBoard, fuentes públicas como SUNAT/GEOTMIN y dispositivos móviles o sensores industriales.

## 12. Próximos Pasos Recomendados

1. Consolidar evidencia técnica de cada funcionalidad: capturas, logs, reportes de prueba y fecha de validación.
2. Confirmar estado real por módulo: implementado, en pruebas, en desarrollo o pendiente.
3. Completar métricas de telemetría: latencia promedio, percentil 95, percentil 99, throughput y tasa de error.
4. Validar el proveedor exacto de consulta RUC/SUNAT antes de presentar el nombre comercial.
5. Ejecutar reporte formal de seguridad: autenticación, autorización, auditoría, APIs, documentos y telemetría.
6. Preparar una demo ejecutiva con tres historias: login seguro, telemetría en tiempo real e informe técnico Word.
7. Convertir este Markdown en una presentación visual o página HTML publicada para distribución gerencial.

---

<p class="small">
Documento preparado para revisión gerencial. Los estados y métricas deben ajustarse con evidencia final del equipo técnico antes de su emisión oficial.
</p>
