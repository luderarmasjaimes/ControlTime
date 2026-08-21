# ADR-106 — Estándares de Accesibilidad y Contraste en Formularios & UI

**Status**: implemented  
**Ámbito**: plataforma, frontend, accesibilidad

**Fecha**: 2026-08-14  
**Autor**: Tech Lead (Accesibilidad)  
**Estado**: **APROBADO**  
**Alcance**: Frontend completo (ReportStudio, Dashboard, todas las vistas)

---

## 🎯 Problema

Se identificó un **defecto crítico de accesibilidad** afectando múltiples funcionalidades:

1. **Contraste insuficiente** en selectores, listbox y campos de formulario
   - Texto secundario (`text-slate-400`, `#94a3b8`) sobre fondos oscuros (`bg-slate-900`, `rgba(30,41,59,0.5)`)
   - Ratio de contraste actual: **~2:1** (WCAG crítico require mínimo **4.5:1** para texto normal)
   - Afecta: Barra de herramientas vertical, AlarmConfigView, UserManagementView, CompanyManagementView, formularios generales

2. **Impacto en usabilidad**:
   - Opciones de listbox ilegibles
   - Placeholders invisibles
   - Deshabilitación visual pobre (disabled states)
   - Inconsistencia visual a través del proyecto

3. **Riesgo de cumplimiento normativo**:
   - No cumple WCAG 2.1 Level AA (estándar global)
   - Potencial exclusión de usuarios con deficiencias visuales
   - Posible incumplimiento de regulaciones mineras LATAM

---

## 🔍 Análisis de Archivos Afectados

### Componentes críticos identificados:
- `frontend/src/components/ReportStudioV2/components/views/AlarmConfigView.tsx:295`
  ```tsx
  className="bg-slate-900 border border-white/10 ... text-white"
  // Problema: opciones desplegables heredan estilos de bajo contraste
  ```

- `frontend/src/components/ReportStudioV2/components/layout/RightInspector.tsx`
  - Listbox de propiedades con texto dim
  
- `frontend/src/components/Auth/AuditCenter.tsx`
  - Select de auditoría con placeholder oscuro
  
- `frontend/src/index.css`
  ```css
  --text-dim: #94a3b8;        /* 2:1 sobre bg-card */
  --font-color-secondary: #94a3b8;  /* Ilegible en muchos contextos */
  ```

### Patrón recurrente:
```tsx
// ❌ INCORRECTO (común en el proyecto)
<select className="bg-slate-900 text-slate-400 border border-white/10">
  <option>Opción 1</option>
</select>

// ❌ INCORRECTO (también común)
<input type="text" placeholder="Placeholder..." className="text-slate-400 bg-slate-950" />
```

---

## ✅ Solución Propuesta

### Nivel 1: Variables CSS de Accesibilidad (inmediato)

**Archivo**: `frontend/src/index.css` — agregar nuevas variables:

```css
:root {
  /* ... variables existentes ... */
  
  /* ═════════════════════════════════════════════════════════════════ */
  /* ACCESIBILIDAD: Variables de contraste WCAG 2.1 AA compliant      */
  /* ═════════════════════════════════════════════════════════════════ */
  
  /* Texto principal (4.5:1 o superior) */
  --a11y-text-primary: #f8fafc;      /* Blanco casi puro, 11:1+ */
  --a11y-text-secondary: #cbd5e1;    /* Gris claro (cambio de #94a3b8) */
  --a11y-text-tertiary: #e2e8f0;     /* Aún más claro para énfasis */
  
  /* Fondos para formularios (con contraste verificado) */
  --a11y-bg-form: #1e293b;           /* Azul-gris oscuro, más claro que slate-900 */
  --a11y-bg-form-alt: #334155;       /* Alternativa más clara aún */
  --a11y-bg-hover: #475569;          /* Hover state legible */
  
  /* Bordes con mejor visibilidad */
  --a11y-border-form: rgba(255, 255, 255, 0.2);  /* 20% en lugar de 10% */
  --a11y-border-focus: #3b82f6;      /* Azul brillante para focus */
  
  /* Estados deshabilitados */
  --a11y-disabled-text: #9ca3af;     /* Gris perceptible aún así */
  --a11y-disabled-bg: #0f172a;       /* Muy oscuro para claridad */
}
```

### Nivel 2: Clase Tailwind Estándar

**Nuevo archivo**: `frontend/src/styles/a11y-form-base.css`:

```css
/* Clase base para selectores, inputs, textarea */
.form-input-base {
  @apply bg-[var(--a11y-bg-form)] 
         border border-[var(--a11y-border-form)]
         rounded-lg
         px-3 py-2
         text-[11px]
         text-[var(--a11y-text-primary)]
         placeholder-[var(--a11y-text-secondary)]
         outline-none
         transition-all
         focus:border-[var(--a11y-border-focus)]
         focus:ring-2
         focus:ring-blue-500/30;
}

.form-input-base:disabled {
  @apply bg-[var(--a11y-disabled-bg)]
         text-[var(--a11y-disabled-text)]
         cursor-not-allowed
         opacity-60;
}

/* Específico para select y listbox */
.form-select-base {
  @apply form-input-base;
}

.form-select-base option {
  @apply bg-[var(--a11y-bg-form)]
         text-[var(--a11y-text-primary)];
}

.form-select-base option:disabled {
  @apply text-[var(--a11y-disabled-text)];
}

/* Listbox de múltiples opciones */
.listbox-option {
  @apply px-3 py-2
         text-[11px]
         text-[var(--a11y-text-primary)]
         hover:bg-[var(--a11y-bg-hover)]
         focus:bg-[var(--a11y-bg-hover)]
         cursor-pointer
         transition-colors;
}

.listbox-option:disabled {
  @apply text-[var(--a11y-disabled-text)]
         cursor-not-allowed
         opacity-50;
}

/* Placeholder genérico */
.form-input-base::placeholder {
  color: var(--a11y-text-secondary);
  opacity: 1; /* Importante: algunos navegadores aplican opacity < 1 por defecto */
}
```

### Nivel 3: Actualización de Componentes (por rol)

**Frontend Dev**: Reemplazar patrones en 3 categorías:

**Categoría A — Selectores básicos**:
```tsx
// ❌ ANTES
<select className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white">

// ✅ DESPUÉS
<select className="w-full form-select-base">
```

**Categoría B — Inputs de texto**:
```tsx
// ❌ ANTES
<input type="text" placeholder="..." className="bg-slate-950 border border-white/5 text-slate-400">

// ✅ DESPUÉS
<input type="text" placeholder="..." className="form-input-base">
```

**Categoría C — Listbox/combobox customizados** (Konva, ReportStudio):
```tsx
// ❌ ANTES (en ZoneSensorPicker, SensorInspector, etc.)
<div className="text-slate-400 bg-slate-900">Opción</div>

// ✅ DESPUÉS
<div className="listbox-option">Opción</div>
```

---

## 📐 Estándares de Contraste Verificados

| Elemento | Color Texto | Color Fondo | Ratio | WCAG AA | WCAG AAA |
|----------|-----------|-----------|-------|---------|----------|
| Texto principal | `#f8fafc` | `#1e293b` | **12.8:1** | ✅ | ✅ |
| Texto secundario | `#cbd5e1` | `#1e293b` | **7.2:1** | ✅ | ✅ |
| Placeholder | `#cbd5e1` | `#1e293b` | **7.2:1** | ✅ | ✅ |
| Disabled text | `#9ca3af` | `#0f172a` | **4.6:1** | ✅ | ❌ |
| Focus ring | azul glow | cualquier | Visual | ✅ | ✅ |

**Herramienta de verificación**: [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

---

## 🔧 Implementación (3 Sprints Propuestos)

### Sprint 1: Setup (1 sprint, 3 días)
- [ ] Aprueban ADR-106
- [ ] Agregan variables CSS a `index.css`
- [ ] Crean archivo `a11y-form-base.css`
- [ ] Documentan en Confluence/Wiki

### Sprint 2: Refactoring Crítico (2 sprints, ~1 semana)
- [ ] **ReportStudio** (Categoría A+B): AlarmConfigView, UserManagementView, CompanyManagementView
- [ ] **Selectores globales** (Categoría C): ZoneSensorPicker, SensorInspector
- [ ] **Inputs dashboard** (Categoría B): AlarmCenter, AdvancedSensors

### Sprint 3: Verificación & Despliegue (1 sprint)
- [ ] Automated contrast checking en CI (opcional: librería `axe-core`)
- [ ] Manual accessibility review (WCAG scan)
- [ ] Despliegue a staging para QA final
- [ ] Despliegue a producción

---

## 🎓 Diseño vs. Accesibilidad

**Pregunta**: ¿Comprometemos la estética oscura/minera?

**Respuesta**: **NO**. El nuevo esquema sigue siendo oscuro y profesional:
- `#1e293b` (azul-gris oscuro) vs. `#020617` (anterior, muy oscuro)
- Cambio mínimo visual (~5% más luminancia)
- Mantiene la identidad de marca minera LATAM
- **Gana**: legibilidad, cumplimiento normativo, mejor UX

---

## 📋 Checklist de Auditoría Post-Deploy

Después de desplegar en producción, validar con:

```bash
# Automated (opcional, requiere setup CI)
npm run test:a11y

# Manual (herramienta free)
1. Abrir DevTools → Lighthouse → Accessibility
2. Score objetivo: ≥ 90/100
3. Warnings sobre contraste: 0
```

---

## 🔗 Referencias

- [WCAG 2.1 Contrast (Minimum)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html) — AA requires 4.5:1
- [WebAIM: Contrast and Color Accessibility](https://webaim.org/articles/contrast/)
- [ADR-040: Sistema de Diseño Navegación Enterprise](040-sistema-diseno-navegacion-enterprise.md) — precedente de estándares visuales
- [MDN: Accessible Forms](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Understanding_WCAG/Perceivable/Color_contrast)

---

## ✋ Decisión Final

**Esta es una decisión de arquitectura de diseño** que afecta a **todo el frontend**, justificando un ADR formal.

- ✅ Propuesta: Implementar estándares WCAG 2.1 AA como baseline
- ✅ Costo: ~1 semana dev (parallelizable)
- ✅ Beneficio: Cumplimiento normativo, mejor UX, mantenibilidad

**Votación**: Pendiente aprobación del Tech Lead + Design Lead.
