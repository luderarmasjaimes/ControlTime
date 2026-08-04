# Diagrama de bloques en texto (===) — Del lienzo FORMULA al Stored Procedure

Este archivo describe **en diagramas ASCII** (secciones con `===`) cómo pasa la información **desde el diagrama dibujado en el lienzo** hasta la **ejecución del procedimiento almacenado** `sp_proceso_temperatura` y el resultado para gráficos.

Sirve como **borrador** para copiar a Visio, draw.io, PlantUML u otra herramienta.

---

## 1. Vista global: lienzo → base de datos → API → SP

```
================================================================================
                    FLUJO GLOBAL (GENERACIÓN SP / ANÁLISIS)
================================================================================

    +---------------------------+
    |  USUARIO (navegador)      |
    |  Editor FORMULA (lienzo)  |
    +-------------+-------------+
                  |
                  |  Guarda bloques y conexiones
                  |  diagram_id = emp{id}_mina{id}
                  v
    +---------------------------+
    |  Motor FORMULA (API HTTP) |
    |  POST /api/block, etc.    |
    +-------------+-------------+
                  |
                  v
    +---------------------------+
    |  Base de datos FORMULA    |
    |  tablas: blocks,          |
    |           connections     |
    +-------------+-------------+
                  ^
                  |
    +-------------+-------------+
    |  Pantalla análisis        |
    |  POST /api/analysis/      |
    |       temperaturas        |
    +-------------+-------------+
                  |
                  v
    +---------------------------+
    |  sp_proceso_temperatura   |
    |  (PostgreSQL / PL-pgsql)  |
    +-------------+-------------+
                  |
                  |  Lee blocks + connections
                  |  del mismo diagram_id
                  |  + mineria_lecturas
                  v
    +---------------------------+
    |  Filas resultado          |
    |  (JSON al cliente → gráfico)|
    +---------------------------+
```

---

## 2. Qué parte del “dibujo” usa el SP

```
================================================================================
              MAPEO: TIPOS DE BLOQUE EN LIENZO  →  COMPORTAMIENTO EN SP
================================================================================

    +------------------+     +-----------------------------------------------+
    | BLOQUE INICIO    |     | Punto de entrada del grafo por cada lectura   |
    | (sin flechas     | --> | Debe existir UNO por diagrama tenant          |
    |  entrantes)      |     | (tipo INICIO / etiqueta / o con formula)      |
    +------------------+     +-----------------------------------------------+

    +------------------+     +-----------------------------------------------+
    | BLOQUE DECISIÓN  |     | Evalúa meta.formula.expression              |
    | blockType =      | --> | (ej. temperatura > 2) con variables actuales  |
    |  "decision"      |     | Sigue rama SI o NO (conexiones etiquetadas)   |
    +------------------+     +-----------------------------------------------+

    +------------------+     +-----------------------------------------------+
    | BLOQUE PROCESO   |     | Ejecuta pasos meta.formula.steps              |
    | (otros tipos)    | --> | Asignaciones tipo var = expresión             |
    +------------------+     | Una salida: siguiente bloque por conexión      |
                            +-----------------------------------------------+

    Variable inicial por lectura (fija en SP):
         temperatura := valor de la lectura en mineria_lecturas
```

---

## 3. Diagrama de bloques del procedimiento `sp_proceso_temperatura`

```
================================================================================
           sp_proceso_temperatura — VISTA LÓGICA (tipo diagrama de flujo)
================================================================================

                         +------------------+
                         |   INICIO SP      |
                         |   Parámetros:    |
                         | empresa, mina,   |
                         | variable, fechas |
                         +--------+---------+
                                  |
                                  v
                         +------------------+
                         | Validar params   |
                         | y fechas         |
                         +--------+---------+
                                  |
                         error ?---+--- ok
                                  |         |
                                  v         v
                         +-------------+   +----------------------+
                         | RAISE       |   | Cargar datos mina    |
                         | EXCEPTION   |   | y validar variable |
                         +-------------+   +----------+-----------+
                                                    |
                                                    v
                         +------------------------------------------+
                         | diagram_id :=                            |
                         |  'emp'||empresa||'_mina'||mina           |
                         +----------------------+-------------------+
                                                    |
                                                    v
                         +------------------------------------------+
                         | Buscar bloque INICIO en blocks           |
                         | (diagram_id, sin conexiones entrantes)  |
                         +----------------------+-------------------+
                                                    |
                                    no encontrado---+--- encontrado v_inicio
                                                    |         |
                                                    v         |
                                         +-------------+      |
                                         | RAISE       |      |
                                         | (sin INICIO)|      |
                                         +-------------+      |
                                                              |
                         +------------------------------------+
                         | FOR cada lectura en                |
                         | mineria_lecturas                   |
                         | (tenant, variable, rango fechas,  |
                         |  calidad >= 50)                    |
                         +------------------+-----------------+
                                            |
                                            v
                         +------------------------------------------+
                         | Inicializar por lectura:                 |
                         |  vars.temperatura = lectura.valor       |
                         |  bloque_actual = v_inicio               |
                         +------------------+-----------------------+
                                            |
                                            v
                    +-----------------------+------------------------+
                    |  BUCLE: recorrer grafo (máx. 50 pasos)        |
                    |  anti-ciclos con lista visitados               |
                    +-----------------------+------------------------+
                                            |
                                            v
                         +------------------------------------------+
                         | ¿bloque_actual es decisión?              |
                         | blockType = 'decision'                   |
                         +----------+---------------+---------------+
                                    | SI            | NO (proceso)
                                    v               v
                         +------------------+     +------------------------+
                         | Evaluar          |     | Ejecutar steps JSON    |
                         | expresión bool   |     | (asignaciones a vars)  |
                         +--------+---------+     +-----------+------------+
                                  |                         |
                                  v                         v
                         +------------------+     +------------------------+
                         | Elegir conexión  |     | Tomar UNA conexión     |
                         | SI / NO          |     | saliente (siguiente)   |
                         +--------+---------+     +-----------+------------+
                                  |                         |
                                  +------------+------------+
                                               |
                                               v
                         +------------------------------------------+
                         | ¿Hay siguiente bloque?                   |
                         +----------+---------------+---------------+
                                    | no            | sí
                                    v               |
                         +------------------+       |
                         | (fin recorrido   |       |
                         |  para esta      |       |
                         |  lectura)       |       |
                         +--------+---------+       |
                                    |               |
                                    v               |
                         +------------------+       |
                         | Emitir fila      |<------+
                         | resultado        |       (vuelve al bucle grafo)
                         | RETURN NEXT      |
                         +------------------+
                                    |
                                    v
                         +------------------+
                         | Siguiente      |
                         | lectura FOR    |
                         +------------------+
                                    |
                                    v
                         +------------------+
                         |   FIN SP       |
                         +------------------+
```

---

## 4. Detalle del bucle “un bloque del lienzo” (subdiagrama)

```
================================================================================
              DENTRO DEL BUCLE: UN BLOQUE (como en el lienzo)
================================================================================

                    +----------------------+
                    | Leer bloque_actual   |
                    | de tabla blocks      |
                    | (mismo diagram_id)   |
                    +-----------+----------+
                                |
                +---------------+---------------+
                |                               |
                v                               v
    +-----------------------+       +---------------------------+
    | TIPO DECISIÓN       |       | TIPO PROCESO              |
    |                       |       |                           |
    | 1) Leer expresión    |       | 1) Leer steps[]         |
    |    en meta.formula   |       | 2) Por cada step:        |
    | 2) fn_eval_expr_bool |       |    si es "a = b":        |
    | 3) Buscar conexión   |       |    fn_eval_expr_numeric  |
    |    backwardLabel     |       |    actualizar vars       |
    |    = SI o NO         |       | 3) Una conexión salida   |
    | 4) Si no hay etiqueta|       +-------------+-------------+
    |    orden por id:     |                     |
    |    1ª=SI, 2ª=NO      |                     |
    +-----------+----------+                     |
                |                                 |
                +----------------+----------------+
                                 |
                                 v
                    +----------------------+
                    | siguiente = to_id    |
                    | o NULL si no hay     |
                    +----------------------+
```

---

## 5. Cadena cliente → SP (solo análisis temperatura)

```
================================================================================
              DESDE EL BOTÓN / GRÁFICO HASTA EL SP
================================================================================

    +----------------------+
    | Cliente (analisis)   |
    | POST body JSON:      |
    | empresa_id, mina_id, |
    | variable_id,         |
    | fecha_inicio, fin    |
    +----------+-----------+
               |
               v
    +----------------------+
    | formula_engine       |
    | arma SELECT FROM     |
    | sp_proceso_temperatura(...)
    | LIMIT 2000           |
    +----------+-----------+
               |
               v
    +----------------------+
    | PostgreSQL ejecuta SP|
    | (lee blocks/conn.    |
    |  con diagram_id      |
    |  emp_e_mina_m)       |
    +----------+-----------+
               |
               v
    +----------------------+
    | Respuesta JSON       |
    | rows[] al navegador  |
    +----------------------+
```

---

## 6. Notas para pasar a Visio

1. Cada bloque entre `+---+` puede ser **un rectángulo**; los rombos son **decisiones**.  
2. Las líneas `|` y `v` indican **flechas** (conectar salidas hacia abajo o a los lados).  
3. El **diagrama 3** es el más grande: en Visio suele dividirse en **dos páginas**: (A) validaciones + búsqueda INICIO, (B) bucle por lectura + recorrido del grafo.  
4. El **diagram_id** debe coincidir con el del lienzo: `emp{id_empresa}_mina{id_mina}`.

---

## 7. Referencia rápida de nombres

| Elemento              | Dónde vive                          |
|-----------------------|-------------------------------------|
| Dibujo del usuario    | Tablas `blocks`, `connections`      |
| Aislamiento por tenant| Columna `diagram_id`                |
| Lecturas a procesar   | Tabla `mineria_lecturas`            |
| Lógica de cálculo     | Función `sp_proceso_temperatura`    |
| Expresiones numéricas | Función `fn_eval_expr_numeric`       |
| Expresiones booleanas | Función `fn_eval_expr_bool`         |

---

*Generado para documentación y trazabilidad lienzo → SP. Ajustar detalles si el código evoluciona.*
