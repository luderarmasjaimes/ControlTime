# La plataforma minera por dentro — explicación sencilla

**Para quién es este documento:** cualquier persona que quiera entender **cómo está armado el sistema por detrás** (el “backend”), sin ser experta en tecnología. También sirve para equipos de TI como **resumen en palabras simples** antes de entrar en detalle técnico.

**Relación con otros documentos:** aquí se explica **el mismo sistema** que en `BACKEND_DISENO_ARQUITECTURA.md`, pero con **menos tecnicismos** y más contexto del día a día.

---

## 1. Primero lo esencial: ¿qué hace esta plataforma?

En pocas palabras: es un **sistema web** para operaciones mineras que permite:

- **Entrar de forma segura** (usuarios, empresas, a veces reconocimiento facial).
- **Ver y analizar datos** de sensores (por ejemplo temperatura en una mina).
- **Dibujar lógica con bloques** (como un organigrama de decisiones) y **guardar** esas “recetas” para después.
- **Ver mapas** y generar **informes**.

Todo eso no vive “en el aire”: hay **programas que corren en servidores** y **bases de datos donde se guarda la información**. Eso es lo que este documento describe de forma sencilla.

---

## 2. Palabras que conviene conocer (glosario corto)

| Término | Qué significa en la práctica |
|--------|-------------------------------|
| **Backend** | La parte del sistema que **no ves en pantalla** pero que procesa datos, reglas y guarda información. |
| **Frontend** | Lo que **sí ves** en el navegador (pantallas, botones). |
| **Base de datos** | Un lugar **ordenado y seguro** donde se guardan registros (usuarios, lecturas, diagramas, etc.). Se parece a archivos muy estructurados, pero pensados para millones de filas. |
| **API** | Un “**mostrador de pedidos**”: el programa de pantalla pide algo (por ejemplo “dame las minas de esta empresa”) y el backend responde. |
| **Motor FORMULA** | Un programa **aparte** dedicado al **diagrama de bloques** y al análisis ligado a ese diagrama. |
| **Multi-tenant (varias empresas)** | El mismo sistema sirve a **varias empresas**; cada una solo ve **sus datos**. Se separa por “inquilino” (tenant), por ejemplo por empresa y mina. |
| **Contenedor / Docker** | Forma de **empaquetar** cada programa con lo que necesita para funcionar, para que sea **reproducible** en otro servidor. |

*Nota para TI:* los nombres técnicos (`sensors_db`, `formula`, puertos) están en el documento técnico detallado.

---

## 3. Una imagen mental: varias “oficinas” que colaboran

Imagina el sistema como **varias oficinas** en el mismo edificio:

1. **Recepción (pantalla web)** — Lo que el usuario ve. No guarda la verdad definitiva; **pide** datos y **muestra** resultados.
2. **Oficina principal de datos de operación** — Atiende login, informes, listados de sensores, etc. Tiene su **archivo maestro** (una base de datos).
3. **Oficina FORMULA** — Solo se ocupa del **diagrama de bloques** y de los **cálculos/análisis** ligados a ese diagrama. Tiene **otro archivo** (otra base de datos), para no mezclar todo con lo demás.
4. **Laboratorio de imágenes (IA)** — Cuando hace falta **analizar una foto o rostro**, esta oficina recibe la imagen y **devuelve un resultado** (por ejemplo si hay gafas o datos de calidad facial). La oficina principal le pide ayuda cuando hace falta.
5. **Sala de mapas** — Sirve **mapas** listos para mostrar (como un catálogo de planos digitales).

Nadie tiene que recordar los nombres internos; lo importante es: **no es un solo bloque monolítico invisible**, sino **varias piezas con tareas claras**.

---

## 4. ¿Por qué hay “dos archivos grandes” (dos bases de datos)?

Por **orden y seguridad**:

- **Una base** guarda lo “general”: usuarios, empresas, informes, muchos datos de operación y catálogos que la aplicación usa cada día.
- **Otra base** guarda lo del **diagrama FORMULA** y lo relacionado con **ese flujo de trabajo** (bloques, conexiones, historial de guardados de fórmulas, procedimientos de cálculo sobre lecturas).

Si algo falla o hay que hacer una copia de seguridad **solo del módulo de fórmulas**, es más fácil. Si todo estuviera mezclado en un solo lugar, sería más difícil de mantener.

---

## 5. Cómo llega la petición del usuario al programa correcto

El navegador habla con un **único sitio web** (misma dirección). Por detrás, un componente llamado **nginx** (un tipo de “conserje de tráfico”) **redirige**:

- Las peticiones que empiezan por **`/api/…`** → van al **programa principal** (login, informes, catálogos para análisis, etc.).
- Las peticiones que empiezan por **`/formula-api/…`** → van al **motor FORMULA** (guardar bloques, leer el estado del diagrama, análisis de temperatura, historial de sesiones de fórmula, etc.).

Así **no se pisan** las responsabilidades: cada “oficina” escucha en su mostrador.

**En una frase para no técnicos:** el usuario ve una sola página; por detrás, el sistema **sabe a qué equipo interno enviar cada tarea**.

---

## 6. El módulo FORMULA, explicado sin código

### ¿Qué es?

Es la parte donde se **arma un diagrama** (cajas y flechas) que representa **reglas o pasos** sobre datos mineros (por ejemplo temperatura).

### ¿Dónde se guarda?

- El **dibujo** (bloques y líneas) se guarda en la base **del motor FORMULA**, identificado por **empresa y mina**, para que cada cliente vea solo lo suyo.

### ¿Qué más hace?

- Puede **ejecutar análisis** usando datos de lecturas (por ejemplo temperatura en un rango de fechas) según las reglas del diagrama.
- Permite **guardar un “recorte”** de esa sesión (historial) para auditoría o para volver a cargar un diseño.

### Idea clave que ya corrigieron en el producto

Para **guardar bien** el dibujo desde la pantalla de análisis, hay que pedir el estado del diagrama **indicando de qué empresa y mina es**. Si no se indica, el sistema podría pensar que no hay nada dibujado. Eso es un detalle de implementación, pero explica por qué a veces “el historial mostraba algo pero el lienzo no”: el **recorte guardado** podía estar vacío por ese motivo.

---

## 7. El módulo de inteligencia artificial (IA)

**Rol simple:** recibir **imágenes** (por ejemplo del flujo biométrico) y **devolver resultados** que el programa principal usa para decidir o registrar.

**No es** “la base de datos de la mina”: es un **servicio especializado** que el backend llama cuando hace falta. Así se puede **actualizar modelos** o escalar ese servicio sin tocar todo lo demás.

---

## 8. Los mapas (tileserver)

Sirven **mapas base** (capas que se ven encima del terreno). Es un servicio **de lectura**: entrega archivos de mapa que la aplicación muestra al usuario.

---

## 9. Flujos del día a día (texto paso a paso)

### A) Usuario edita el diagrama FORMULA

```
Usuario abre el editor
        → La pantalla pide al motor FORMULA: “muéstrame el diagrama de esta empresa/mina”
        → El usuario mueve bloques
        → La pantalla envía los cambios al motor FORMULA
        → El motor guarda en su base de datos
```

### B) Usuario pide un análisis de temperatura

```
Usuario elige fechas y variable
        → La pantalla pide al motor FORMULA que ejecute el análisis
        → El motor usa las lecturas guardadas y las reglas del diagrama
        → Devuelve filas de resultado para gráficos o tablas
```

### C) Usuario guarda la fórmula en historial

```
Usuario confirma guardar
        → El sistema toma una “foto” del diagrama (lista de bloques y conexiones)
        → Esa foto y los datos del formulario se guardan como registro de historial
```

*(Para TI: las rutas exactas y nombres de tablas están en el documento técnico.)*

---

## 10. ¿Qué llevarse a una reunión con gerencia no técnica?

Mensajes útiles:

1. **“Tenemos varios servicios especializados, no un solo bloque opaco.”** — Facilita mantenimiento y evolución.
2. **“Los datos de operación y los del editor de fórmulas están separados por diseño.”** — Reduce riesgo de mezclar responsabilidades.
3. **“El acceso del usuario pasa por un solo portal web; por detrás el tráfico se enruta de forma ordenada.”** — Buena práctica de seguridad y claridad.
4. **“La IA es un servicio de apoyo para imágenes/rostro, no reemplaza la base de datos operativa.”** — Alinea expectativas.

---

## 11. Dónde profundizar

| Si necesitas… | Lee… |
|---------------|------|
| Nombres técnicos, puertos, diagramas ASCII detallados | `BACKEND_DISENO_ARQUITECTURA.md` |
| Scripts de base de datos | carpeta `db_scripts/` y `formula_engine/*.sql` |
| Cómo se construye el sistema | `docker-compose.yml` |

---

## 12. Control del documento

| Versión | Fecha | Descripción |
|---------|-------|-------------|
| 1.0 | 2026-04-08 | Primera versión en lenguaje sencillo para audiencias mixtas (TI y no TI). |

---

*Fin del documento.*
