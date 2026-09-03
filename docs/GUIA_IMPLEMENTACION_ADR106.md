# 🎨 GUÍA DE IMPLEMENTACIÓN — ADR-106 Accesibilidad de Formularios

**Fecha**: 2026-08-14  
**Audiencia**: Frontend Dev Team  
**Duración estimada**: 1 semana (parallelizable)  
**Criticidad**: Alta (defecto de accesibilidad WCAG)

---

## 📋 Resumen Ejecutivo

Se identificó un **defecto crítico** de contraste en formularios afectando múltiples vistas. La solución es aplicar estándares **WCAG 2.1 AA** a través de nuevas clases CSS reutilizables.

### Antes ❌
```tsx
<select className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white">
  {/* Opciones prácticamente ilegibles */}
</select>
```

### Después ✅
```tsx
<select className="w-full form-select-base">
  {/* Opciones legibles, contraste 7.2:1 verificado */}
</select>
```

**Beneficios**:
- Cumplimiento WCAG 2.1 AA (requisito normativo)
- Mejor UX para usuarios con deficiencias visuales
- Código más limpio y reutilizable
- Estilos consistentes en todo el proyecto

---

## ✅ PASO 1: Verificar Setup (10 minutos)

### 1.1 Confirmar archivos creados

```bash
# En terminal, desde raíz del proyecto
ls -la frontend/src/a11y-form-base.css
ls -la docs/decisions/106-accesibilidad-contraste-formularios-ui.md

# Deberían existir ambos archivos
# Output esperado: -rw-r--r-- (permisos lectura)
```

### 1.2 Verificar variables CSS en index.css

```bash
# Buscar las nuevas variables
grep "a11y-text-primary" frontend/src/index.css
grep "a11y-bg-form" frontend/src/index.css

# Output esperado:
# --a11y-text-primary: #f8fafc;
# --a11y-bg-form: #1e293b;
# (+ 8 variables más)
```

### 1.3 Importar CSS en App.tsx

**Archivo**: `frontend/src/components/ReportStudioV2/App.tsx`

Agregar esta línea en el bloque de imports (después de otros CSS):

```tsx
// ... otros imports ...
import '../../../a11y-form-base.css';  // ← Agregrar aquí
```

O alternativamente, en `frontend/src/App.tsx`:

```tsx
import './a11y-form-base.css';  // ← Agregrar aquí
```

**Verificación**: Ejecutar dev server y abrir DevTools → Console. No debe haber errores de CSS.

---

## 🔍 PASO 2: Auditar Componentes (3-4 horas)

### 2.1 Archivos a revisar (prioridad):

**CRÍTICA** (afecta el flujo principal):
- [ ] `components/ReportStudioV2/components/views/AlarmConfigView.tsx` — línea 295
- [ ] `components/ReportStudioV2/components/views/UserManagementView.tsx`
- [ ] `components/ReportStudioV2/components/views/CompanyManagementView.tsx`
- [ ] `components/Auth/AuditCenter.tsx`

**ALTA** (afecta múltiples usuarios):
- [ ] `components/ReportStudioV2/components/layout/ZoneSensorPicker.tsx`
- [ ] `components/ReportStudioV2/components/layout/SensorInspector.tsx`
- [ ] `components/Dashboard/AlarmCenter.tsx`
- [ ] `components/Platform/PlatformRegionBar.tsx`

**MEDIA** (menor frecuencia de uso):
- [ ] `components/Dashboard/AdvancedSensors.tsx`
- [ ] `components/Formula/FormulaEngineEmbed.tsx`
- [ ] Otros componentes con `<select>` o `<input>`

### 2.2 Patrón de búsqueda (copiar en VS Code Find):

```regex
bg-slate-900.*border.*white/10|bg-slate-950.*text-slate-|placeholder.*slate-
```

Esto encontrará la mayoría de selectores problemáticos.

### 2.3 Checklist de auditoría por archivo:

Para CADA archivo, responder:

- ¿Contiene `<select>`, `<input>`, `<textarea>`?
- ¿Usaron `bg-slate-900`, `bg-slate-950`, o `text-slate-400` directamente?
- ¿Hay `listbox` customizados con opciones renderizadas en React?
- ¿Los placeholders son visibles?

---

## 🛠️ PASO 3: Reemplazos de Código (3-5 horas)

### 3.1 CATEGORÍA A: Selectores HTML nativos

**ANTES**:
```tsx
<select className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50">
  <option>Opción 1</option>
  <option>Opción 2</option>
</select>
```

**DESPUÉS**:
```tsx
<select className="w-full form-select-base">
  <option>Opción 1</option>
  <option>Opción 2</option>
</select>
```

**Aplicar en**:
- `AlarmConfigView.tsx:295` (`<select>` de operadores)
- `AlarmConfigView.tsx:301` (`<select>` de severidad)
- `UserManagementView.tsx` (cualquier select)
- `AuditCenter.tsx` (select de filtros)

### 3.2 CATEGORÍA B: Inputs de texto

**ANTES**:
```tsx
<input 
  type="text" 
  placeholder="Buscar por ID, sensor o zona..."
  className="bg-slate-950 border border-white/5 text-slate-400 rounded px-3 py-2"
/>
```

**DESPUÉS**:
```tsx
<input 
  type="text" 
  placeholder="Buscar por ID, sensor o zona..."
  className="form-input-base"
/>
```

**Aplicar en**:
- `AlarmCenter.tsx:308` (search input)
- `AuditCenter.tsx` (inputs de filtro)
- Cualquier `<input type="text">` con clases de contraste bajo

### 3.3 CATEGORÍA C: Listbox customizados (lo más importante)

**ANTES** (Ejemplo de `ZoneSensorPicker.tsx`):
```tsx
<div className="bg-slate-900 border border-white/10 rounded-lg p-2">
  {sensors.map(sensor => (
    <div 
      key={sensor.id}
      className="text-slate-400 hover:bg-slate-800 px-3 py-2 cursor-pointer"
    >
      {sensor.name}
    </div>
  ))}
</div>
```

**DESPUÉS**:
```tsx
<div className="listbox-container">
  {sensors.map(sensor => (
    <div 
      key={sensor.id}
      className={`listbox-option ${selectedIds.has(sensor.id) ? 'selected' : ''}`}
    >
      {sensor.name}
    </div>
  ))}
</div>
```

**Aplicar en**:
- `ZoneSensorPicker.tsx` (opciones de sensores)
- `SensorInspector.tsx` (lista de sensores seleccionados)
- `SensorMultiChartInspector.tsx` (si tiene listbox)
- Cualquier dropod-wn/combobox customizado con 

### 3.4 CATEGORÍA D: Labels y help text

**ANTES**:
```tsx
<label className="text-[8px] text-slate-500 font-bold uppercase">
  Nombre de la Regla
</label>
```

**DESPUÉS**:
```tsx
<label className="form-label">
  Nombre de la Regla
</label>
```

---

## 📐 PASO 4: Verificación Visual (2-3 horas)

### 4.1 Checklist visual en dev server

Para CADA componente actualizado:

1. **Abrir componente en navegador** (dev server con `npm run dev`)
2. **Verificar en luz normal**:
   - [ ] Texto es legible (sin squinting)
   - [ ] Placeholder visible pero distinguible
   - [ ] Bordes visibles al focus
   - [ ] Hover state claro
3. **Verificar estados**:
   - [ ] Input normal
   - [ ] Input con valor
   - [ ] Input focused
   - [ ] Input disabled
   - [ ] Input con error (si aplica)
4. **Verificar selectores**:
   - [ ] Desplegable se abre
   - [ ] Opciones son legibles
   - [ ] Selección visual clara
   - [ ] Scroll funciona si hay muchas opciones

### 4.2 Test con herramientas:

**Opción 1: Lighthouse** (más rápido)
```bash
# Abrir DevTools → Lighthouse → Accessibility
# Ejecutar audit
# Objetivo: 0 warnings sobre contraste
```

**Opción 2: WebAIM** (más preciso)
```
1. Abrir https://webaim.org/resources/contrastchecker/
2. Copiar colores de variables CSS
3. Verificar cada combinación:
   - #f8fafc (texto) sobre #1e293b (fondo) → debe ser 12:1
   - #cbd5e1 (texto) sobre #1e293b (fondo) → debe ser 7:1+
```

### 4.3 Test de usabilidad:

- [ ] Usar teclado para navegar (Tab)
- [ ] Verificar focus visible en todos los campos
- [ ] Probar en navegador oscuro (si aplica)
- [ ] Probar en zoom 200% (para usuarios con deficiencias visuales)

---

## 🚀 PASO 5: Despliegue (30 minutos)

### 5.1 Crear rama feature

```bash
git checkout -b feature/adr-106-a11y-form-contrast
```

### 5.2 Commit con mensaje claro

```bash
git add frontend/src/a11y-form-base.css \
         frontend/src/index.css \
         frontend/src/components/ReportStudioV2/components/views/AlarmConfigView.tsx \
         frontend/src/components/ReportStudioV2/components/views/UserManagementView.tsx

git commit -m "ADR-106: Aplicar estándares WCAG 2.1 AA en formularios

- Agregar variables CSS de accesibilidad (--a11y-*)
- Crear clases base: form-input-base, form-select-base, listbox-*
- Reemplazar selectores con bajo contraste en AlarmConfigView
- Reemplazar selectores con bajo contraste en UserManagementView
- Verificación visual: Lighthouse Accessibility ≥ 90

Refs: ADR-106, docs/decisions/106-accesibilidad-contraste-formularios-ui.md"
```

### 5.3 Push y PR

```bash
git push origin feature/adr-106-a11y-form-contrast
# Crear PR en GitHub con descripción de cambios
```

### 5.4 QA / Revisión

- [ ] Code review por otro dev (verificar clases aplicadas)
- [ ] Visual review por UX/Designer
- [ ] Test Accessibility en staging
- [ ] Aprobación del Tech Lead

### 5.5 Merge a main

```bash
# Después de aprobación
git checkout main
git merge --squash feature/adr-106-a11y-form-contrast
git push origin main
```

---

## 📋 Componentes Específicos — Ejemplos de Reemplazo

### Ejemplo 1: AlarmConfigView.tsx (línea 295)

**ANTES**:
```tsx
<select className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
  value={ruleForm.operator}
  onChange={(e) => setRuleForm({...ruleForm, operator: e.target.value})}
>
  {OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
</select>
```

**DESPUÉS**:
```tsx
<select className="w-full form-select-base"
  value={ruleForm.operator}
  onChange={(e) => setRuleForm({...ruleForm, operator: e.target.value})}
>
  {OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
</select>
```

### Ejemplo 2: ZoneSensorPicker.tsx (listbox customizado)

**ANTES**:
```tsx
<div className="flex gap-2 p-2 bg-slate-900 border border-white/10 rounded-lg max-h-48 overflow-y-auto">
  {filteredSensors.map(sensor => (
    <div
      key={sensor.id}
      onClick={() => toggleSensor(sensor)}
      className={`px-3 py-2 rounded cursor-pointer text-slate-400 hover:bg-slate-800 ${
        selectedIds.has(sensor.id) ? 'bg-slate-700 text-white' : ''
      }`}
    >
      {sensor.sensor_code}
    </div>
  ))}
</div>
```

**DESPUÉS**:
```tsx
<div className="listbox-container">
  {filteredSensors.map(sensor => (
    <div
      key={sensor.id}
      onClick={() => toggleSensor(sensor)}
      className={`listbox-option ${selectedIds.has(sensor.id) ? 'selected' : ''}`}
    >
      {sensor.sensor_code}
    </div>
  ))}
</div>
```

---

## 🐛 Solución de Problemas

### Problema: "¿Qué clase uso para botones?"

**Respuesta**: 
- Botones principales: `.form-button-primary`
- Botones secundarios: `.form-button-secondary`

### Problema: "¿Qué color de focus usar?"

**Respuesta**: 
Usa `--a11y-border-focus` (#3b82f6, azul). Ya está definido y cumple WCAG.

### Problema: "Mi componente tiene estilos inline muy específicos"

**Respuesta**: 
Convierte a clases. Si necesitas override, agrégalo a `a11y-form-base.css` bajo un comentario con la razón.

### Problema: "El placeholder sigue invisible"

**Respuesta**: 
Verifica que NO tengas `opacity-0` u `hidden` en el campo. El CSS base ya maneja placeholders.

---

## ✋ Decisión Final

**Requerimiento**: Aplicar a TODO el proyecto, no solo ReportStudio.

**Prioridad de rollout**:
1. ReportStudio (esta semana)
2. Dashboard (próxima semana)
3. Auth/Admin (en paralelelo si hay dev disponible)

---

## 📞 Contacto

Si tienes dudas:
1. Revisar [ADR-106](../decisions/106-accesibilidad-contraste-formularios-ui.md)
2. Revisar archivo CSS: `frontend/src/a11y-form-base.css`
3. Consultar al Tech Lead

---

**¡Gracias por mejorar la accesibilidad del proyecto! 🎉**
