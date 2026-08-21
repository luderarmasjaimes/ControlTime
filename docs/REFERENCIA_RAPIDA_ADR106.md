# 🔍 REFERENCIA RÁPIDA — ADR-106 Búsqueda y Reemplazo

**Uso**: Copiar/pegar patrones en VS Code Find/Replace para actualizar componentes rápidamente.

---

## 🔎 PATRONES DE BÚSQUEDA (Regex)

### Buscar: Selectores con bajo contraste

```regex
bg-slate-900.*border.*white/10
```

**Componentes encontrados**: 
- AlarmConfigView.tsx
- AuditCenter.tsx
- Otros archivos con select

### Buscar: Inputs con bajo contraste

```regex
bg-slate-950.*text-slate-
```

**Componentes encontrados**:
- Multiple inputs en formularios
- Search fields

### Buscar: Listbox/div con opciones

```regex
text-slate-400.*hover:bg-slate-800
```

**Componentes encontrados**:
- ZoneSensorPicker.tsx
- SensorInspector.tsx

### Buscar: Placeholders oscuros

```regex
placeholder-slate-|placeholder.*#|placeholder.*text-slate
```

---

## 🔄 PATRONES DE REEMPLAZO

### TIPO 1: SELECT nativo

**Find**:
```regex
<select\s+className="w-full\s+bg-slate-900\s+border\s+border-white/10\s+rounded-lg\s+px-3\s+py-2\s+text-\[11px\]\s+text-white\s+outline-none\s+focus:border-indigo-500/50"
```

**Replace**:
```
<select className="w-full form-select-base"
```

---

### TIPO 2: INPUT de texto

**Find**:
```regex
<input\s+type="text"\s+className="[^"]*bg-slate-95[0-9][^"]*text-slate-4[0-9]{2}[^"]*"
```

**Replace** (manual, pero patrón):
```
<input type="text" className="form-input-base"
```

---

### TIPO 3: DIV con opciones (listbox)

**Find**:
```regex
<div\s+className="[^"]*bg-slate-900[^"]*border[^"]*white/10[^"]*">\s*\{(.*?)\}\s*</div>
```

**Replace** (manual):
```
<div className="listbox-container">
  {$1}
</div>
```

---

## 📝 COMPONENTES A BUSCAR MANUALMENTE

### AlarmConfigView.tsx

**Líneas problemáticas**:
- **295**: select de operadores
- **301**: select de severidad  
- **343**: input de nombre de regla
- **349**: input de sensor_id

**Patrón común**:
```tsx
className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white"
```

**Reemplazo**:
```tsx
className="w-full form-select-base"  // para select
className="w-full form-input-base"   // para input
```

---

### UserManagementView.tsx

**Líneas problemáticas**:
- Cualquier `<select>` o `<input>` con estilos oscuros

**Patrón**:
```tsx
className="... bg-slate-900 ... text-slate-"
```

**Reemplazo**:
```tsx
className="form-input-base"
```

---

### ZoneSensorPicker.tsx

**Líneas problemáticas**:
- Div con listbox de sensores
- Opciones renderizadas con `map()`

**Patrón**:
```tsx
<div className="... bg-slate-900 ... text-slate-400 ... hover:bg-slate-800 ...">
  {sensors.map(s => ...)}
</div>
```

**Reemplazo**:
```tsx
<div className="listbox-container">
  {sensors.map(s => (
    <div className="listbox-option">
      {s.name}
    </div>
  ))}
</div>
```

---

## 🎯 CHECKLIST DE COMPONENTES

Use esta lista para auditar cada archivo:

### ReportStudio

- [ ] AlarmConfigView.tsx — `<select>` operadores ✓
- [ ] AlarmConfigView.tsx — `<select>` severidad ✓
- [ ] UserManagementView.tsx — todos los campos ✓
- [ ] CompanyManagementView.tsx — todos los campos ✓
- [ ] ZoneSensorPicker.tsx — listbox sensores ✓
- [ ] SensorInspector.tsx — listbox sensores ✓
- [ ] SensorMultiChartInspector.tsx — si aplica ✓

### Dashboard

- [ ] AlarmCenter.tsx — search input ✓
- [ ] AdvancedSensors.tsx — selectores ✓

### Auth & Admin

- [ ] AuditCenter.tsx — select filtros ✓
- [ ] TenantSwitcher.tsx — select empresa ✓
- [ ] PlatformRegionBar.tsx — select región ✓

---

## 🧪 COMANDO PARA BUSCAR TODAS INSTANCIAS

**PowerShell**:
```powershell
# Buscar todos los archivos con problemas de contraste
Get-ChildItem -Path "frontend/src" -Recurse -Include "*.tsx" | 
  Select-String -Pattern "bg-slate-9[05]0.*text-slate-|text-slate-4[0-9]{2}.*bg-slate-9[05]0" |
  Select-Object Path, LineNumber, Line
```

**Bash**:
```bash
# Buscar en terminal
grep -rn "bg-slate-9[05]0.*text-slate-\|text-slate-4[0-9][0-9].*bg-slate-9[05]0" frontend/src --include="*.tsx"
```

**VS Code Find** (Regex mode):
```
bg-slate-9[05]0.*text-slate-4[0-9]{2}
```

---

## 💡 TIPS DE REEMPLAZO

### Tip 1: Reemplazar solo CLASS, no todo

Si tienes:
```tsx
<select className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50" disabled>
```

Reemplaza SOLO el className:
```tsx
<select className="w-full form-select-base" disabled>
```

(Mantén otros atributos como `disabled`, `value`, `onChange`, etc.)

### Tip 2: Preserve estructura

Si es multilinea:
```tsx
<select
  className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
  value={value}
  onChange={handler}
>
```

Reemplaza a:
```tsx
<select
  className="w-full form-select-base"
  value={value}
  onChange={handler}
>
```

### Tip 3: Listbox con múltiples DIV

Si el listbox tiene estructura anidada:
```tsx
<div className="bg-slate-900 border border-white/10">
  <div className="p-2 space-y-1">
    {items.map(item => (
      <div className="text-slate-400 hover:bg-slate-800">{item}</div>
    ))}
  </div>
</div>
```

Usa:
```tsx
<div className="listbox-container">
  {items.map(item => (
    <div className="listbox-option">{item}</div>
  ))}
</div>
```

---

## ✅ VERIFICACIÓN POST-REEMPLAZO

Después de cada reemplazo:

1. **Código compila sin errores**:
   ```bash
   npm run build
   ```

2. **No hay warnings CSS**:
   - Abrir DevTools → Console
   - Verificar que no haya error de CSS

3. **Componente se ve bien**:
   - Dev server con `npm run dev`
   - Verificar contraste visualmente
   - Probar focus, hover, disabled states

4. **Lighthouse audit**:
   ```bash
   # En DevTools: Lighthouse → Accessibility
   # Score esperado: ≥90
   ```

---

## 🆘 PROBLEMAS COMUNES

### Problema: "No encuentro el patrón en el archivo"

**Solución**:
1. Abre el archivo en VS Code
2. Usa Ctrl+F (Find)
3. Escribe: `bg-slate-900`
4. Usa Find All (Ctrl+Shift+F) para ver en todo el proyecto

### Problema: "Mi regex no funciona"

**Solución**:
1. Habilita Regex mode en Find (clica el botón `.*`)
2. Prueba patrones más simples primero
3. Copia exactamente de esta documentación

### Problema: "Reemplacé pero el componente sigue feo"

**Solución**:
1. Verifica que importaste `a11y-form-base.css`
2. Usa DevTools → Inspect → Verifica que clase está aplicada
3. Chequea que no haya conflicto de estilos inline posteriores

---

## 📞 REFERENCIA CRUZADA

| Problema | Solución |
|----------|----------|
| Contraste bajo en select | Usar `form-select-base` |
| Contraste bajo en input | Usar `form-input-base` |
| Listbox opciones ilegibles | Usar `listbox-option` |
| Label oscura | Usar `form-label` |
| Placeholder invisible | `form-input-base` maneja automáticamente |
| Error message | Usar `form-error-message` |
| Help text | Usar `form-help-text` |

---

**¡Listo para actualizaciones! Usa esta referencia mientras implementas ADR-106.** 🚀
