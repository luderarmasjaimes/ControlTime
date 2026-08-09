# ADR-042 — Nomenclatura de menús en lenguaje llano orientado a usuarios de operación minera

## Actualización 2026-07-27 — etiquetas operativas de una palabra

Para mejorar reconocimiento inmediato y evitar texto truncado en operación,
las categorías visibles pasan a: **Gestión, Control, Terreno, Mapas, Permisos
e Informes**. Las opciones administrativas se acortan a **Usuarios, Accesos y
Umbrales**. Los identificadores internos permanecen sin cambios y los
tooltips conservan la explicación completa.

**Status**: accepted (implementado y verificado en navegador real 2026-07-13)
**Fecha**: 2026-07-13
**Autores**: EC
**Ámbito**: plataforma

> Decisión de contenido/UX sobre el nav unificado en ADR-040; no cambia estructura ni
> agrupación de módulos, solo su nomenclatura.

## Contexto

Los nombres de categorías y módulos del menú principal habían acumulado terminología
técnica/de sistemas — "GIS", "HD", "Dual-Stream", "Geoservidor", "Gemelo 3D", "Motor
de Fórmula" — heredada del vocabulario de quienes construyeron cada pieza (ingeniería
de software, GIS, IoT) en vez del vocabulario de quienes **operan** la plataforma en
sitio (supervisores, geólogos, personal de seguridad, operadores de sala de control).
El pedido explícito de negocio fue simplificar para "usuarios mineros que buscan
simplicidad de uso y que puedan entender fácilmente".

## Decisión

Se renombran las 6 categorías y sus 18 módulos a lenguaje llano, eliminando
abreviaturas y jerga técnica que no aportan comprensión inmediata para el usuario
final. Regla de traducción aplicada consistentemente: **nombrar por lo que el usuario
logra hacer o ve**, no por la tecnología subyacente.

| Antes | Después |
|---|---|
| Mantenimiento | Administración |
| Monitoreo en tiempo real | Monitoreo en Vivo |
| Geotecnia y modelado 3D | Geotecnia y Modelo 3D |
| Mapas de faena y HD | Mapas de la Mina |
| Territorio y cumplimiento GIS | Terrenos y Permisos |
| Ingeniería y reportabilidad | Cálculos e Informes |
| Desplazamiento Acumulado | Movimiento del Terreno |
| Gemelo 3D Mina | Vista 3D de la Mina |
| Geoservidor Minero | Mapas Oficiales |
| Cumplimiento Territorial | Permisos por Zona |
| Mapa Geotécnico HD | Mapa Detallado |
| Video Vigilancia | Cámaras de Seguridad |
| Dual-Stream | Telemetría en Vivo |
| Motor de Fórmula | Calculadora Minera |
| Mantenimiento Usuario | Gestión de Usuarios |
| Config. de Alarmas | Configurar Alarmas |
| Redactor Técnico | Reporte Rápido |

Los tooltips de cada opción se reescribieron en la misma línea (frases cortas,
verbo+objeto, sin jerga). Los títulos internos que repetían el nombre dentro de la
propia vista (`GeotechWorkbench.tsx`, `TelemetryDashboard.tsx`, botón de acceso rápido
en `ReportsAdminModal.tsx`) se sincronizaron con el nuevo nombre — para no dejar un
nombre nuevo en el nav y el nombre viejo dentro de la pantalla misma.

### Reglas duras
- Los identificadores internos de enrutamiento (`name` en `TabDef`, usado en
  `activeTab === 'X'` y en `enterpriseGroups[].items`) **no se tocan** — son claves de
  código, no texto visible; solo `label`/`title`/`tip` (texto visible) se renombran.
  Esto evitó cualquier riesgo de romper el enrutamiento del shell al hacer un cambio
  que es puramente de contenido.
- Términos técnicos con significado operativo real para el sector (p.ej. "talud",
  "geotecnia", "telemetría") se conservan — el objetivo es eliminar jerga de
  *sistemas/software*, no vocabulario minero legítimo que el usuario objetivo ya
  conoce y espera encontrar.

## Consecuencias

### Positivas
- Nombres de menú comprensibles sin necesitar explicación adicional para el perfil de
  usuario objetivo (supervisor/geólogo/seguridad/operador), reduciendo curva de
  aprendizaje.
- Ningún riesgo de regresión funcional — cambio de solo contenido, sin tocar lógica de
  enrutamiento ni estructura de datos.

### Negativas / Trade-offs
- Algunos nombres técnicos "de marca" (p.ej. "Dual-Stream", que refería a una
  arquitectura Kinesis+Kafka específica) pierden precisión técnica para un lector
  familiarizado con la arquitectura interna — aceptado deliberadamente: el menú es
  para el usuario final de la plataforma, no para el equipo de ingeniería; la
  precisión técnica sigue documentada en el código y en los ADRs correspondientes
  (ADR-034).

### Neutras
- No requiere migración de datos ni cambios de esquema — es texto de UI puro.

## Alternativas descartadas

### Ofrecer dos nomenclaturas (modo "técnico" / modo "simplificado") conmutables por el usuario
Añadiría una superficie de configuración y un costo de mantenimiento doble (mantener
dos sets de labels sincronizados) sin un caso de uso concreto que lo pida — el negocio
pidió simplicidad para el usuario minero, no una opción configurable. Descartado por
sobre-alcance frente al pedido real.

## Referencias
- `frontend/src/App.tsx` (`tabs`, `enterpriseGroups`)
- `frontend/src/components/Dashboard/GeotechWorkbench.tsx`,
  `frontend/src/components/Dashboard/TelemetryDashboard.tsx`,
  `frontend/src/components/ReportStudioV2/components/modals/ReportsAdminModal.tsx`
- ADR-040 (sistema de diseño de navegación que aloja esta nomenclatura), ADR-034
  (detalle técnico de telemetría dual-stream / motor de alarmas, preservado a nivel de
  código y documentación aunque el nombre visible se simplificó)
