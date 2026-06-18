# Version Tecnica Extendida del Cronograma
## Plataforma Minera sobre VPS Linux en Lima - 26 Semanas

## 1. Principios Tecnicos del Programa
- La solucion objetivo corre sobre VPS Linux en Lima.
- La plataforma actual en AWS se mantiene como fuente externa de datos para este alcance.
- El cronograma privilegia desacoplamiento progresivo, continuidad operativa y cierre de riesgos antes de go-live.
- La ocupacion del equipo se distribuye segun camino critico, dependencias de integracion y madurez natural de cada frente.

## 2. Etapa 1: Implementacion Funcional Core
### 2.1 Objetivos Tecnicos
- Definir arquitectura objetivo, conectividad, seguridad base y contrato de datos.
- Implementar el motor central de eventos, documentos y trazabilidad.
- Construir el editor documental tipo Word para reportes mineros.
- Implementar tablero gerencial, monitoreo de sensores y visualizacion GIS.
- Cerrar la etapa con QA funcional y estabilizacion del nucleo.

### 2.2 Focos por Mes
**Mes 1**
- Arquitectura, SOW, conectividad, seguridad inicial e integracion con fuente externa.

**Mes 2**
- Servicios base del negocio, seguridad, mensajeria, persistencia y trazabilidad.

**Mes 3**
- Frontend operativo, tablero gerencial, sensores y visualizacion GIS.

**Mes 4**
- Integracion final, IA local aprobada, exportacion documental y QA funcional.

### 2.3 Riesgos Tecnicos Dominantes
- Variabilidad del esquema o disponibilidad de la base externa.
- Subdimensionamiento de almacenamiento y mensajeria para eventos.
- Sobrecarga simultanea en backend, integracion y exportacion documental.
- Insuficiente adopcion temprana de la UX documental.

## 3. Etapa 2: Hardening, Estabilizacion y Go-Live
### 3.1 Objetivos Tecnicos
- Hardening de infraestructura, accesos, cifrado, respaldo y continuidad.
- Estabilizacion del flujo de datos desde la plataforma actual.
- Validacion de performance, seguridad, recuperacion y UAT.
- Marcha blanca, soporte de estabilizacion y go-live formal.

### 3.2 Focos por Mes
**Mes 5**
- Hardening, integracion estabilizada, capacidad intensiva y mejoras avanzadas.

**Mes 6**
- Calidad extrema, continuidad, cierre de hallazgos, marcha blanca y transferencia.

### 3.3 Riesgos Tecnicos Dominantes
- Saturacion de CPU, memoria o disco en VPS durante cargas pico.
- Hallazgos de seguridad sin cerrar al inicio del mes 6.
- Fallas de integracion tardias sobre datos reales.
- Incidentes de adopcion en marcha blanca que exijan retrabajo rapido.

## 4. Estrategia de Ocupacion
### 4.1 Etapa 1
- ARQ y SYS lideran arquitectura e infraestructura desde el arranque.
- Backend toma carga maxima desde el mes 2.
- Frontend acelera desde el mes 2 para reducir riesgo de rechazo de usuario.
- QA crece en forma progresiva para entrar fuerte al cierre funcional.

### 4.2 Etapa 2
- SYS permanece al 100% por criticidad de continuidad y hardening.
- QA escala al 100% para UAT y cierre de hallazgos.
- ARQ incrementa carga en cierre por transferencia, gobierno y aprobacion.
- FE2 mantiene alta ocupacion para adopcion y estabilizacion operativa.

## 5. Entregables Tecnicos por Etapa
### 5.1 Etapa 1
- Arquitectura objetivo aprobada.
- Contrato de datos y conectores base.
- Motor central y modelo documental.
- Editor maestro, tablero y GIS operativo.
- Exportacion documental y QA funcional cerrados.

### 5.2 Etapa 2
- Hardening completo de plataforma.
- Integracion estabilizada con fuente externa.
- Continuidad y recuperacion probadas.
- UAT y performance formalmente cerrados.
- Marcha blanca, go-live y transferencia al cliente.

## 6. Recomendaciones Tecnicas de Gobierno
- Mantener comite quincenal de arquitectura y riesgos.
- Gestionar la dependencia AWS como frente formal de proyecto, no como supuesto operativo.
- Congelar cambios no criticos durante semanas de performance, UAT y marcha blanca.
- Sostener trazabilidad de hallazgos, mitigaciones y decisiones ejecutivas hasta el cierre.

## 7. Conclusiones
La planificacion tecnica resultante es coherente con una implementacion minera de alta exigencia: protege el camino critico, mejora la utilizacion del equipo, controla la dependencia de la plataforma actual y organiza el go-live bajo una secuencia de estabilizacion realista.
