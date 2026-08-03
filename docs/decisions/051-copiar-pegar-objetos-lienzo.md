# ADR-051 — Copiar/pegar de objetos en el lienzo (portapapeles interno, no del sistema operativo)

**Status**: implemented (verificado 2026-07-17)
**Fecha**: 2026-07-17
**Autores**: EC
**Ámbito**: reports

## Contexto

El negocio pidió poder seleccionar un objeto del lienzo (texto, imagen, tabla, gráfico, KPI, sensor, mapa), copiarlo, y pegarlo de nuevo en el mismo informe — un flujo básico de edición que no existía: seleccionar un bloque y presionar Ctrl+C/Ctrl+V no producía ningún efecto.

## Decisión

Se implementa copiar/pegar **dentro del lienzo** (un "portapapeles" propio de la aplicación, en memoria/estado del editor) — no se integra con el portapapeles real del sistema operativo ni permite copiar entre pestañas/ventanas del navegador. Al pegar, el bloque se clona con un `id` nuevo y se desplaza levemente respecto al original (mismo patrón visual que `duplicatePage`/duplicar página) para que sea evidente que es una copia y no quede exactamente superpuesto al original.

Disponible por atajo de teclado (Ctrl+C/Ctrl+V, con el bloque seleccionado y foco fuera de un campo de texto) y desde el menú contextual (clic derecho sobre el objeto seleccionado) — mismo criterio de "doble acceso rápido" que el selector de ajuste de texto (ADR-049).

### Reglas duras
- Copiar/pegar no cruza el límite del informe abierto — no hay portapapeles persistente entre informes distintos ni entre sesiones.
- Los bloques de plataforma fijos (`header`/`footer`/`cover`, ADR-046/048) no son copiables — no tiene sentido duplicar un elemento que ya se genera automáticamente por página.

## Consecuencias

### Positivas
- Cubre el flujo de edición esperado sin la complejidad de integrar con la Clipboard API del navegador (que además requiere permisos y tiene soporte inconsistente para tipos de dato ricos como "un bloque JSON de este editor").

### Negativas / Trade-offs
- No se puede copiar un objeto de un informe y pegarlo en otro informe distinto (abrir otra pestaña/ventana) — limitación aceptada, no pedida por el negocio a la fecha.

## Alternativas descartadas

### Integración con la Clipboard API del sistema operativo (`navigator.clipboard`)
Permitiría copiar/pegar entre informes distintos (pestañas separadas), pero exige serializar el bloque a un formato que el sistema operativo entienda (o usar `ClipboardItem` con un MIME type custom, soporte limitado entre navegadores) y gestionar permisos de portapapeles — complejidad no justificada por el pedido real ("copiar y pegar en el mismo lienzo").

## Referencias
- `frontend/src/components/ReportStudioV2/store/useEditorStore.ts`
- `frontend/src/components/ReportStudioV2/components/document/PageCanvas.tsx` (menú contextual, atajos de teclado)
- ADR-046, ADR-048 (elementos de plataforma fijos, no copiables)
