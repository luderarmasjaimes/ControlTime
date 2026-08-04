# ANEXO DE RIESGOS Y MITIGACIONES

## Portafolio IA Minera 2026

**Fecha**: 15 de mayo de 2026  
**Dirigido a**: Gerencia General, Directorio y Gerencia TI  
**Objetivo**: documentar los principales riesgos de adopcion del portafolio IA propuesto y las mitigaciones sugeridas para aprobacion ejecutiva.

---

## 1. Lectura ejecutiva

El riesgo principal no es adoptar IA, sino hacerlo sin gobierno, sin control de costo, sin politicas de datos y sin una secuencia de implementacion disciplinada. La estrategia recomendada reduce ese riesgo mediante un gateway comun, control de acceso, observabilidad y adopcion por fases.

## 2. Riesgos principales

### Riesgo 1. Dispersion de proveedores y complejidad de integracion

**Descripcion**: la empresa puede terminar usando multiples proveedores, copilotos y modelos sin control central, generando duplicidad de gasto, integraciones inconsistentes y dificultad para auditar decisiones.

**Impacto**:

1. Mayor complejidad operativa.
2. Dificultad para comparar costo-rendimiento.
3. Riesgo de fragmentacion tecnica entre equipos.

**Mitigaciones**:

1. Implementar un gateway IA unico para acceso a modelos.
2. Definir un catalogo corporativo de proveedores aprobados.
3. Establecer comite quincenal de arquitectura y consumo.

### Riesgo 2. Sobrecosto por consumo de API y herramientas premium

**Descripcion**: sin cuotas, routing y seguimiento de uso, el consumo puede crecer rapidamente por prompts largos, cargas de RAG, uso intensivo de modelos premium y licencias subutilizadas.

**Impacto**:

1. Desviacion del presupuesto aprobado.
2. Dificultad para justificar ROI.
3. Rechazo ejecutivo por percepcion de gasto no controlado.

**Mitigaciones**:

1. Asignar cuotas por equipo y entorno.
2. Aplicar routing por costo y criticidad del caso de uso.
3. Medir consumo, cache y ahorro por trimestre.

### Riesgo 3. Fuga de datos o uso no gobernado

**Descripcion**: el uso de herramientas IA sin politicas claras puede exponer documentos, codigo, telemetria, datos personales o informacion sensible de la operacion minera.

**Impacto**:

1. Riesgo legal, reputacional y contractual.
2. Exposicion de informacion operativa o biometrica.
3. Observaciones de auditoria interna o externa.

**Mitigaciones**:

1. Habilitar SSO, trazabilidad y administracion centralizada.
2. Segmentar casos de uso permitidos y prohibidos.
3. Separar ambientes de prueba, desarrollo y operacion.

### Riesgo 4. Baja adopcion o uso superficial

**Descripcion**: si la organizacion compra licencias pero no acompana con flujos, playbooks, responsables y medicion, el uso real puede ser bajo o improductivo.

**Impacto**:

1. Baja captura de valor.
2. Resistencia del equipo a estandarizar nuevas practicas.
3. Deterioro de la percepcion del programa frente a gerencia.

**Mitigaciones**:

1. Ejecutar pilotos controlados por frente funcional.
2. Nombrar owners por arquitectura, desarrollo, operaciones y datos.
3. Medir productividad, adopcion y valor generado por trimestre.

### Riesgo 5. Escalar demasiado pronto hacia ML propio sin base suficiente

**Descripcion**: intentar construir prediccion minera avanzada antes de consolidar datos, features, trazabilidad y gobierno puede elevar costo y reducir credibilidad.

**Impacto**:

1. Fracaso de PoC o modelos sin valor operativo.
2. Costos altos de compute y datos sin resultado usable.
3. Desalineacion entre IA generativa y analitica predictiva.

**Mitigaciones**:

1. Separar la ruta generativa de la ruta predictiva.
2. Consolidar primero gateway, RAG y observabilidad.
3. Escalar ML propio en T3 y T4 con datasets y ownership claro.

## 3. Recomendacion de gobierno

Se recomienda aprobar el programa bajo cinco controles obligatorios:

1. Gateway IA corporativo.
2. Politica de proveedores y modelos autorizados.
3. Cuotas, FinOps y observabilidad por equipo.
4. Politicas de datos, auditoria y SSO.
5. Revision ejecutiva trimestral de valor, costo y riesgo.

## 4. Conclusion

El portafolio IA recomendado es viable y defendible para la empresa siempre que se implemente como programa gobernado y escalonado. La mitigacion correcta no es reducir ambicion tecnica, sino ordenar la adopcion con reglas, metrica y responsables.