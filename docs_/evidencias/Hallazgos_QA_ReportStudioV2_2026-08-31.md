# Hallazgos técnicos — ReportStudioV2 (sesión de generación de informe en vivo)

**Fecha:** 2026-08-31
**Reportado por:** Luder Armas (vía sesión de Claude Code, automatización de navegador sobre `http://localhost:5173`, tenant Alpayana)
**Contexto:** Durante la construcción manual/automatizada de un informe técnico directamente en el lienzo del editor ReportStudioV2 (módulo Informes → Reporte), se identificaron 5 defectos reales y reproducibles. Se documentan aquí como hallazgo de QA, no como parte del contenido del informe.

---

## 1. [CRÍTICO] Indicador "✓ Guardado" no refleja el estado real de persistencia

**Severidad:** Crítica — riesgo de pérdida de datos del usuario.

**Descripción:** El editor muestra un indicador de guardado exitoso ("✓ Guardado") en la barra de herramientas incluso cuando la sesión de autenticación ha expirado y la llamada de guardado contra el backend falla. El usuario recibe una confirmación visual falsa de que su trabajo está persistido.

**Evidencia:** Se construyó en vivo un informe (portada, ficha de control, resumen ejecutivo, sección de diagnóstico KPI con tarjetas e indicadores, tabla de KPIs corporativos) que alcanzó ~25 versiones internas del editor (contador local "Versión: v25"), con el indicador de guardado en estado positivo durante todo el proceso. Tras un ciclo de expiración de sesión → recarga de página → nuevo login, el mismo informe (`rep_2026_01`) se reabrió en **"Versión: v1"**, en blanco. Se revisó el listado completo de "Mis Informes" (Administración de Informes Técnicos → 15 informes del tenant Alpayana) y **ninguno de los 15 registros corresponde** a ese contenido ni a esa ventana horaria — el trabajo no fue persistido en ningún momento del lado del servidor pese a la señal visual de éxito.

**Impacto:** Cualquier usuario que trabaje sesiones largas en el editor puede perder horas de trabajo sin ninguna advertencia, porque la UI le confirma falsamente que está a salvo.

**Recomendación:** El indicador de guardado debe basarse en la confirmación HTTP 2xx real del endpoint de guardado (no en estado optimista de cliente), y debe degradarse a un estado de error visible y persistente (no un toast que desaparece) si la llamada falla — especialmente si la causa es un 401/403 por expiración de sesión, en cuyo caso además se debería ofrecer reautenticación in-place sin perder el buffer local del documento.

---

## 2. [ALTO] Expiración de sesión independiente en el sub-módulo de telemetría/KPI del wizard

**Severidad:** Alta.

**Descripción:** El selector "Tipo de sensor" del wizard de inserción de gráfico de sensor en tiempo real apareció vacío (sin opciones). La UI mostró un toast genérico "Request failed with status code 500". La inspección de la petición de red real mostró:

```
GET /api/mining/telemetry/wizard/catalog?tenant_id=... → 403 Forbidden
```

es decir, un error de autorización (sesión/token insuficiente para ese tenant en ese momento), no un error 500 de servidor como indicaba el mensaje al usuario.

**Impacto:** Mensaje de error engañoso que dificulta el diagnóstico (dirige al usuario a pensar en un fallo de servidor en vez de un problema de sesión).

**Recomendación:** Propagar el código de estado HTTP real al mensaje de error mostrado al usuario, y distinguir explícitamente errores 401/403 (con acción "Iniciar sesión de nuevo") de errores 5xx.

---

## 3. [ALTO] Recargar la página puede cerrar la sesión completamente en vez de refrescarla

**Severidad:** Alta.

**Descripción:** Al intentar resolver el error 403 del hallazgo #2 mediante una recarga completa de página (`F5` / navegación al mismo URL), la sesión no se refrescó silenciosamente mediante el refresh token (HttpOnly, según ADR-082) — en su lugar, la aplicación cerró sesión por completo, forzando un nuevo login manual.

**Impacto:** Comportamiento inconsistente del refresh token: en otras ocasiones de la misma sesión de trabajo, una recarga sí mantuvo la sesión activa. La condición exacta que dispara el fallo (token de acceso ya demasiado próximo a expirar en el momento de la recarga) no quedó determinística, lo que sugiere una condición de carrera entre la expiración del access token y el intento de refresh automático.

**Recomendación:** Revisar la lógica de refresh en el interceptor HTTP del frontend para asegurar que se intenta el refresh *antes* de que el access token expire (no solo tras un 401), y agregar reintento automático de la petición original tras un refresh exitoso.

---

## 4. [MEDIO] El iframe de "Cálculo" bloquea la navegación superior tras cargarse

**Severidad:** Media — bloquea el flujo de trabajo pero tiene solución (recarga completa).

**Descripción:** El sub-tab "Cálculo" dentro de Informes carga un iframe que embebe `/formula/index.html`. Una vez que este iframe termina de cargar, **todos los clics posteriores en la navegación superior dejan de responder** — incluyendo botones de Área completamente ajenos al iframe (p. ej. "Abrir Control"). Se confirmó reproducible más de una vez en la misma sesión.

**Impacto:** El usuario queda atascado en la vista de Cálculo sin poder navegar a ningún otro módulo mediante clics; la única salida encontrada fue una recarga completa de la página (con el riesgo de pérdida de sesión del hallazgo #3).

**Recomendación:** Investigar si el iframe de fórmulas está capturando eventos de teclado/mouse a nivel de documento padre (p. ej. un listener global no removido en cleanup, o un `iframe` con foco robado y un overlay/z-index invisible que intercepta clics). Priorizar por ser un bloqueo total de navegación sin salida vía UI.

---

## 5. [BAJO] Duplicación de texto al editar celdas de tabla en el lienzo

**Severidad:** Baja — cosmético, con solución manual (aunque poco fiable).

**Descripción:** Al editar una celda de una tabla ya insertada en el lienzo mediante doble-clic + `Ctrl+A` + escritura de texto nuevo, el contenido anterior no siempre se reemplaza limpiamente — se observó texto duplicado/concatenado (ej. "Categoria2", "Valor Valor actualactualactual"). Se probaron varias estrategias de reemplazo (End+Shift+Home+Delete; triple-clic+Backspace; 40× Backspace) sin corregirlo de forma consistente.

**Impacto:** Requiere reintentos manuales repetidos del usuario para editar contenido de tablas ya existentes; en un caso llevó a borrar accidentalmente una columna completa al intentar corregirlo.

**Recomendación:** Revisar el manejador de selección/reemplazo de texto en las celdas de tabla del editor canvas (posible problema de sincronización entre el modelo de datos de la celda y el estado del cursor/selección tras un `Ctrl+A`).

---

## 6. [MEDIO] El endpoint de listado de informes (`GET /api/reports`) devuelve 403 mientras que crear (`POST /api/reports`) funciona correctamente

**Severidad:** Media — no bloquea el guardado, pero rompe la confianza del usuario en la UI de administración.

**Descripción:** Se guardó un informe nuevo desde el editor (título "Diagnostico Riesgos Mineros 56 Sensores - Lienzo 2026-08-31") y la petición de red confirma persistencia real y exitosa:

```
POST /api/reports → 201 Created
{"status":"created","id":"4f36ccd0-8234-4888-b411-4b98a823cfe9","version_number":1}
```

Sin embargo, al abrir inmediatamente después el modal "Administración de Informes Técnicos" para verificar que apareciera en la lista, la petición de listado falló:

```
GET /api/reports?tenant_id=c7dacc61-ccf5-449b-842f-8a5f15b4a48e → 403 Forbidden
```

El modal, en lugar de mostrar un error, se degrada silenciosamente a un estado "0 informes en total" / "No se encontraron informes con los filtros seleccionados" — indistinguible en la UI de un tenant que genuinamente no tiene informes. Además, el selector "UNIDAD MINERA" del modal solo ofrece las opciones "Beemetry (admin) — actual" y "Empresa Prueba QA…", sin incluir "Alpayana" (el tenant/cliente activo en el resto de la aplicación), lo que sugiere una desincronización entre el tenant activo de la sesión y el tenant que el modal de administración intenta consultar.

**Impacto:** Un usuario que guarda un informe y luego revisa "Mis Informes" para confirmarlo puede concluir erróneamente que el guardado falló (refuerza el problema de confianza del hallazgo #1), cuando en realidad el dato sí quedó persistido en el backend — solo el endpoint de lectura/listado está negando el acceso.

**Recomendación:** Alinear los permisos de lectura (`GET /api/reports`) con los de escritura (`POST /api/reports`) para el mismo `tenant_id` de sesión, y hacer que el modal de administración muestre un mensaje de error explícito (no una lista vacía) cuando la petición de listado responde 4xx/5xx.

**Hallazgo relacionado — mismo patrón en un segundo endpoint:** en la misma sesión, y para el mismo `tenant_id` (`c7dacc61-ccf5-449b-842f-8a5f15b4a48e`), el wizard de inserción de gráfico de sensores (hallazgo #2) también falló con:

```
GET /api/mining/telemetry/wizard/catalog?tenant_id=c7dacc61-ccf5-449b-842f-8a5f15b4a48e → 403 Forbidden
```

Esto indica que el problema no es un caso aislado de un único endpoint, sino un patrón: para este `tenant_id`, la sesión actual puede **escribir** (`POST /api/reports` → 201) pero no puede **leer/listar** en al menos dos endpoints distintos (`GET /api/reports`, `GET /api/mining/telemetry/wizard/catalog`). Esto apunta a una causa raíz común, probablemente en la capa de autorización que valida permisos de lectura por tenant, y debería revisarse de forma centralizada en vez de parchear endpoint por endpoint.

---

## Resumen para priorización

| # | Hallazgo | Severidad | Bloqueante |
|---|----------|-----------|------------|
| 1 | Indicador de guardado falso-positivo | Crítica | Sí (riesgo de pérdida de datos) |
| 2 | Mensaje de error 500 en vez de 403 real | Alta | No (pero dificulta diagnóstico) |
| 3 | Recarga de página cierra sesión en vez de refrescar | Alta | Sí (obliga a relogin) |
| 4 | Iframe de Cálculo bloquea navegación superior | Media | Sí (sin salida vía UI) |
| 5 | Duplicación de texto al editar celdas de tabla | Baja | No |
| 6 | Listado de informes (403) desincronizado del guardado (201) | Media | No (pero erosiona confianza) |

Se recomienda atender el hallazgo #1 con máxima prioridad antes de promover ReportStudioV2 a uso productivo sin supervisión, dado que expone a cualquier usuario a pérdida silenciosa de trabajo. El hallazgo #6 se descubrió intentando verificar, precisamente, que el hallazgo #1 no se repitiera: esta vez el guardado sí persistió en el backend (confirmado por la respuesta `201 Created` de la API), pero la UI de administración no lo reflejó, lo cual sigue siendo una fuente de desconfianza justificada para el usuario.
