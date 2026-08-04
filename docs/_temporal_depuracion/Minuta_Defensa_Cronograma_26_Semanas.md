# Minuta de Defensa del Cronograma
## Plataforma Minera sobre VPS Linux en Lima
## Cronograma Oficial de 26 Semanas

**Objetivo de esta minuta**
Servir como guion de defensa para sustentar el cronograma ante gerencia, directorio, PMO o comite de aprobacion.

---

## 1. Mensaje de Apertura
El cronograma propuesto no es una distribucion cosmetica de tareas. Es una secuencia ejecutable de 26 semanas que prioriza continuidad operativa, control de riesgos, ocupacion efectiva del equipo y salida a produccion con gobierno real. La solucion se implementa sobre VPS Linux en Lima y consume datos desde la plataforma actual en AWS sin replicar una nueva arquitectura cloud para este alcance.

---

## 2. Mensajes Clave que se Deben Repetir
- El proyecto tiene 26 semanas reales, agrupadas en 2 etapas para lectura ejecutiva 4+2 meses.
- La nueva plataforma no se implementa en AWS; opera sobre VPS Linux en Lima.
- La dependencia con AWS existe solo como fuente externa de datos y se trata como riesgo formal de proyecto.
- La Etapa 1 entrega valor funcional real, no solo definiciones o documentos.
- La Etapa 2 esta diseñada para reducir riesgo de go-live, no para agregar complejidad innecesaria.
- La ocupacion del equipo fue rebalanceada para proteger el camino critico y mejorar productividad real.

---

## 3. Argumentos de Defensa por Tema
### 3.1 Por que 26 semanas y no 24
- Porque el programa incluye no solo construccion, sino tambien estabilizacion, UAT, marcha blanca y transferencia formal.
- Reducir artificialmente el calendario afectaria el cierre de riesgos y aumentaria la probabilidad de retrabajo en salida a produccion.
- Las 26 semanas permiten presentar 4+2 meses a gerencia sin perder control del calendario real.

### 3.2 Por que separar en 2 etapas
- Porque la gerencia necesita leer el programa en bloques de valor y no como una lista plana de tareas.
- La Etapa 1 entrega el nucleo funcional y deja a negocio ver valor temprano.
- La Etapa 2 concentra seguridad, continuidad, adopcion y salida a produccion.

### 3.3 Por que VPS Linux en Lima
- Mejora control operativo, costos y gobernanza de la plataforma objetivo.
- Reduce complejidad al evitar una nueva arquitectura cloud para este proyecto.
- Facilita una operacion mas alineada al contexto del cliente y sus restricciones.

### 3.4 Por que mantener dependencia con la plataforma actual en AWS
- Porque el alcance aprobado indica que la informacion proviene de la plataforma minera existente en produccion.
- Esa dependencia ya no es un supuesto oculto: fue convertida en riesgo formal con mitigacion y contingencia.
- El cronograma ya contempla validaciones tempranas para no descubrir este riesgo al final.

### 3.5 Por que la ocupacion del equipo no es uniforme
- Porque una planificacion senior no distribuye carga de forma plana; la asigna segun riesgo, especialidad y momento del proyecto.
- Arquitectura e infraestructura cargan fuerte al inicio.
- Backend domina el camino critico desde el mes 2.
- Frontend se intensifica cuando adopcion y experiencia de uso empiezan a influir en el riesgo del programa.
- QA escala cuando la solucion ya debe ser validada de forma integral.

---

## 4. Preguntas Dificiles y Respuestas Sugeridas
### Pregunta: Por que no migramos todo directamente y mas rapido?
**Respuesta sugerida:** Porque el objetivo no es solo mover componentes, sino asegurar continuidad, control y salida a produccion sin comprometer la operacion. El cronograma prioriza una transicion ejecutable, no una aceleracion aparente con alto riesgo de falla.

### Pregunta: Por que seguimos dependiendo de AWS si la nueva plataforma no ira en AWS?
**Respuesta sugerida:** Porque la fuente actual de informacion ya existe en esa plataforma. La nueva solucion no replica esa arquitectura, pero si debe consumir sus datos. Por eso la dependencia se gestiona como frente de integracion y riesgo formal.

### Pregunta: Por que la Etapa 2 parece tan fuerte en infraestructura, QA y soporte?
**Respuesta sugerida:** Porque ahi se decide la calidad real del go-live. El hardening, la recuperacion ante incidentes, el UAT y la marcha blanca son los elementos que evitan que un proyecto funcional falle al pasar a produccion.

### Pregunta: La carga de algunos perfiles parece alta, esta planificacion es realista?
**Respuesta sugerida:** Si. La carga fue rebalanceada segun especialidad y camino critico. Donde la exigencia es alta, tambien se definieron entregables, riesgos, mitigaciones y controles de seguimiento quincenal.

---

## 5. Cierre Recomendado de la Reunion
Solicitar aprobacion del cronograma de 26 semanas, confirmar la gobernanza quincenal de riesgos y asegurar desde el primer mes la participacion del equipo responsable de la fuente externa actual. Con eso, el programa queda listo para ejecutarse con disciplina, trazabilidad y foco en salida a produccion.
