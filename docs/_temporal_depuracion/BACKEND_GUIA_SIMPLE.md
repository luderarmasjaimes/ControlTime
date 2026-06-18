# Cómo funciona el “motor” de la plataforma (versión fácil de leer)

Este texto explica **qué hace cada parte importante del sistema por detrás** de la aplicación minera. Está escrito para que lo entienda **tanto alguien de tecnología como alguien de operaciones o gerencia**, sin perder el sentido de cómo está montado todo.

---

## 1. Idea general (en una frase)

La aplicación que ves en pantalla es la **puerta de entrada**. Detrás hay **varios programas especializados** que trabajan juntos: uno gestiona usuarios e informes, otro guarda y calcula las **fórmulas con diagramas de bloques**, otro ayuda con **reconocimiento facial / imagen**, y hay **bases de datos** donde se guarda la información de forma ordenada.

Piensa en una **minindustria**: cada taller hace una cosa y pasa el trabajo al siguiente cuando hace falta.

---

## 2. Analogía simple: restaurante

| En la vida real | En esta plataforma |
|-----------------|-------------------|
| El comensal pide en el mostrador | El **usuario** usa el navegador (la web) |
| El mostrador recibe el pedido y lo manda a cocina o barra | Un **servidor web ligero** (nginx) recibe la petición y la envía al programa correcto |
| Cocina prepara platos distintos | El **programa principal** (backend) gestiona login, informes, datos de sensores, etc. |
| Hay un chef solo para postres | El **motor FORMULA** solo se ocupa de diagramas de bloques y análisis ligados a eso |
| La despensa guarda ingredientes | Las **bases de datos** guardan datos de forma permanente |
| Un proveedor externo trae algo listo | El **servicio de inteligencia artificial** analiza imágenes cuando hace falta |

Nadie espera que el cliente entre a la cocina: igual, el usuario **no habla directamente** con la base de datos; siempre pasa por los programas que hacen de “mostrador”.

---

## 3. Las piezas principales (quién es quién)

### 3.1 La web que ves (frontend)

Es lo que carga en el **navegador**: pantallas, botones, el editor de fórmulas, los mapas, etc.  
**No es donde se guardan los datos importantes** a largo plazo; es la **interfaz**. Los datos viven en servidores (bases de datos) detrás.

**Para no TI:** Es el “escritorio” de la aplicación.  
**Para TI:** SPA estática servida por nginx, con proxy a APIs.

---

### 3.2 El “mostrador” que reparte las peticiones (nginx en el contenedor frontend)

Cuando el navegador pide algo, este componente mira la **dirección** y decide:

- Si empieza por **`/api/`** → lo manda al **programa principal** (backend).
- Si empieza por **`/formula-api/`** → lo manda al **motor FORMULA**.

Así **no se mezclan** las dos cosas: cada programa recibe solo lo suyo.

**Para no TI:** Es el **conmutador** que enruta el tráfico.  
**Para TI:** Reverse proxy path-based hacia `web:8081` y `formula_engine:8020`.

---

### 3.3 El programa principal (backend / servicio “web”)

Hace de **centro operativo** para muchas funciones:

- Inicio de sesión y permisos.
- Informes, proyectos, datos del tablero.
- Datos de sensores y mapas (según lo que esté programado).
- Conexión con el servicio de **imagen / rostro** cuando la pantalla lo necesita.

Se conecta a la base de datos grande del proyecto (**sensores_db**), donde está buena parte de la información de empresa, lecturas, usuarios, etc.

**Para no TI:** Es el **cerebro administrativo** de la plataforma.  
**Para TI:** Monolito C++, HTTP, PostgreSQL/Timescale `sensors_db`, integración con `ai_engine`.

---

### 3.4 El motor FORMULA (servicio dedicado)

Es un programa aparte que **solo vive para**:

- Guardar y mostrar el **diagrama de bloques** (cajas y flechas).
- Ejecutar **análisis** que dependen de ese diagrama (por ejemplo temperatura según reglas guardadas).
- Guardar el **historial de “sesiones”** cuando alguien guarda una fórmula con nombre y fechas.

Tiene **su propia base de datos** (**formula**), separada de la principal. Eso ayuda a que un problema en un lado no tire abajo el otro y a hacer copias de seguridad más claras.

**Para no TI:** Es el **taller de fórmulas**: dibujas el flujo aquí y los resultados salen según esas reglas.  
**Para TI:** Servicio C++ (Boost.Beast), PostgreSQL `formula_db`, `diagram_id` multitenant.

---

### 3.5 Las bases de datos (dónde vive la información)

Hay **dos “archiveros” grandes**:

1. **sensors_db** — Usuarios, empresas, minas, lecturas, informes, catálogos que alimentan pantallas y análisis “generales”.
2. **formula** — Bloques y conexiones del diagrama, datos mineros que usa el procedimiento de cálculo, historial de fórmulas guardadas.

**Para no TI:** Son las **bodegas** donde todo queda registrado con orden.  
**Para TI:** PostgreSQL; una con Timescale para series temporales donde aplica.

---

### 3.6 El servicio de inteligencia artificial (imagen / rostro)

Analiza **imágenes** (por ejemplo en procesos de verificación facial). El programa principal le **pide** un resultado; este servicio **devuelve** un análisis. No sustituye al resto del sistema: **trabaja por encargo**.

**Para no TI:** Es un **especialista** al que se llama solo cuando hace falta.  
**Para TI:** Python, ONNX, expuesto en red interna, healthcheck.

---

### 3.7 El servidor de mapas (teselas)

Sirve **mapas base** (como capas de fondo) para que la aplicación los muestre sin calcularlos desde cero cada vez.

**Para no TI:** Es el **atlas digital** que la app consulta.  
**Para TI:** mbtileserver, volumen de datos de mapas.

---

## 4. Flujo cotidiano en palabras simples

### Alguien entra a la aplicación

1. El navegador pide la pantalla al **nginx**.  
2. Si hay que comprobar usuario o cargar datos de informes, se usa el **programa principal** y la base **sensores_db**.  
3. Si abre el **editor de fórmulas**, las peticiones van al **motor FORMULA** y la base **formula**.

### Alguien guarda una fórmula desde la pantalla de análisis

1. El sistema **toma una foto** del diagrama actual (lista de bloques y conexiones) **para la empresa y mina correctas**.  
2. Esa foto se guarda en el historial (**formula_sessions**).  
3. Así, después se puede **volver a cargar** ese dibujo sin rehacerlo a mano.

### Alguien pide un gráfico de temperatura procesada

1. El motor FORMULA lee las **reglas del diagrama** y las **lecturas** guardadas.  
2. Aplica la lógica (incluido un procedimiento almacenado en base de datos).  
3. Devuelve filas listas para graficar.

---

## 5. Por qué está todo “partido” en varios módulos

| Ventaja | Explicación sencilla |
|---------|----------------------|
| **Orden** | Cada cosa tiene su lugar: fórmulas no mezclan tablas con el login. |
| **Seguridad y mantenimiento** | Si hay que arreglar el editor de diagramas, se acota el trabajo. |
| **Escalado** | En el futuro se puede dar más potencia solo al pedazo que lo necesite. |
| **Copias de seguridad** | Se puede respaldar la base de fórmulas aparte de la operativa. |

---

## 6. Palabras que a veces confunden (mini glosario)

| Término | Qué significa aquí |
|---------|-------------------|
| **Backend** | Todo lo que corre en servidores y no es la pantalla del usuario. |
| **API** | Forma ordenada de pedir y recibir datos entre programas. |
| **Contenedor / Docker** | Empaquetar un programa con lo que necesita para ejecutarse igual en distintos servidores. |
| **Proxy** | Intermediario que recibe la petición y la pasa al sitio correcto. |
| **Multi-tenant** | Varios clientes (empresas) usan la misma aplicación, pero sus datos están **separados** (por empresa, mina, etc.). |
| **diagram_id** | Etiqueta interna que identifica **de quién es** cada diagrama de bloques. |

---

## 7. Relación con el documento técnico

Si necesitas **nombres exactos de servicios, puertos y rutas HTTP**, está el documento **`BACKEND_DISENO_ARQUITECTURA.md`**.  
Este archivo (**`BACKEND_GUIA_SIMPLE.md`**) es la **versión narrada y sencilla** del mismo mundo, para reuniones mixtas (TI + negocio + gerencia).

---

## 8. Resumen de una línea por pieza

- **Frontend:** Lo que ves y en lo que haces clic.  
- **Nginx:** Reparte las peticiones entre el programa principal y FORMULA.  
- **Programa principal:** Login, informes, datos operativos; base **sensores_db**.  
- **Motor FORMULA:** Diagramas y análisis ligados a ellos; base **formula**.  
- **Servicio de IA:** Análisis de imagen cuando la aplicación lo solicita.  
- **Mapas:** Sirve capas para los mapas en pantalla.

---

*Documento orientado a lectura rápida y comprensión compartida entre equipos técnicos y no técnicos.*
