import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import ColorPalette from '../shared/ColorPalette';
import {
  buildThreeTierRules,
  CONDITION_LABELS,
  THREE_TIER_TEMPLATES,
  type ColorScaleFormat,
  type ConditionalFormatRule,
  type ConditionalFormatScope,
  type ConditionType,
  type ThreeTierTemplate,
} from '../../lib/tableConditionalFormat';
import type { TableCellSelectionInfo } from '../../lib/tableCellSelectionBridge';

interface ConditionalFormatEditorProps {
  rules: ConditionalFormatRule[];
  onChange: (rules: ConditionalFormatRule[]) => void;
  colorScales: ColorScaleFormat[];
  onColorScalesChange: (colorScales: ColorScaleFormat[]) => void;
  /** Selección de celdas ACTIVA de este mismo bloque (ver
   * lib/tableCellSelectionBridge.ts), ya filtrada por RightInspector.tsx
   * para que solo llegue si pertenece al bloque actualmente seleccionado.
   * `null` = no hay ninguna celda seleccionada ahora mismo (solo se puede
   * crear formato "para toda la tabla"). */
  activeSelection: TableCellSelectionInfo | null;
}

/** A qué acotar la PRÓXIMA regla/escala que se cree -- 'row'/'column' solo
 * están disponibles cuando la selección activa cae entera en una sola fila
 * o columna (una celda suelta cuenta para ambas a la vez). */
type ScopeChoice = 'table' | 'cells' | 'row' | 'column';

function scopeChoiceFor(scope: ConditionalFormatScope | undefined): ScopeChoice {
  return scope ? scope.type : 'table';
}

/** Texto corto para mostrar en la lista de reglas/escalas ya guardadas --
 * "" (nada) para las de toda la tabla, así no ensucia el resumen existente
 * cuando no hay acotamiento (el caso más común). */
function summarizeScope(scope: ConditionalFormatScope | undefined): string {
  if (!scope) return '';
  if (scope.type === 'row') return ` · Fila ${scope.row + 1}`;
  if (scope.type === 'column') return ` · Columna ${scope.column + 1}`;
  return ` · ${scope.cells.length} celda${scope.cells.length === 1 ? '' : 's'}`;
}

const NEEDS_SECOND_VALUE: ConditionType[] = ['between'];
const NUMERIC_CONDITIONS: ConditionType[] = ['greaterThan', 'lessThan', 'greaterOrEqual', 'lessOrEqual', 'equal', 'notEqual', 'between'];
const DEFAULT_BG = '#fecaca';
const DEFAULT_TEXT = '#991b1b';

function summarizeRule(rule: ConditionalFormatRule): string {
  const label = CONDITION_LABELS[rule.condition];
  const base = rule.condition === 'between' ? `${label} ${rule.value} y ${rule.value2 ?? '?'}` : `${label} "${rule.value}"`;
  return base + summarizeScope(rule.scope);
}

type ScaleCount = 1 | 2 | 3;

// Índices fijos dentro de scaleValues/scaleColors: 0=mínimo, 1=medio,
// 2=máximo. Con 2 escalas se usan solo 0 y 2 (el medio queda ignorado pero
// conservado en el estado, así no se pierde si el usuario prueba 3 y vuelve
// a 2). "1 escala" no arma nada nuevo acá -- una "escala" de un solo punto
// no tiene contra qué interpolar, así que ese caso apunta al flujo que ya
// existe (regla manual con un valor y un color, más abajo). Colores por
// defecto = los mismos rojo/amarillo/verde que usa Excel en su escala de 3
// colores por defecto.
const SCALE_STOP_INDEXES: Record<2 | 3, number[]> = { 2: [0, 2], 3: [0, 1, 2] };
const SCALE_STOP_LABELS: Record<2 | 3, string[]> = { 2: ['Mínimo', 'Máximo'], 3: ['Mínimo', 'Medio', 'Máximo'] };
const DEFAULT_SCALE_COLORS: [string, string, string] = ['#f8696b', '#ffeb84', '#63be7b'];

function summarizeScale(scale: ColorScaleFormat): string {
  return `Escala (${scale.stops.length}): ${scale.stops.map((s) => s.value).join(' → ')}${summarizeScope(scale.scope)}`;
}

/**
 * "Resaltar reglas de celdas" + "Escalas de color" de Excel, aplicado a
 * TableBlock.tsx: las reglas pintan fondo/texto de las celdas cuyo valor
 * (propio o resultado de fórmula, ver lib/tableFormulas.ts) cumpla una
 * condición puntual; las escalas de color interpolan el fondo de forma
 * continua entre 2 o 3 puntos (mínimo[/medio]/máximo) -- ver
 * lib/tableConditionalFormat.ts para el cálculo real de ambas. Además de
 * crear reglas manuales una por una, ofrece plantillas rápidas de 3 niveles
 * (bajo/medio/alto) que ya traen los colores resueltos -- el usuario solo
 * pone los dos umbrales. Vive en su propio archivo (no dentro de
 * RightInspector.tsx) para no seguir engordando ese componente -- solo
 * expone `rules`/`onChange` y `colorScales`/`onColorScalesChange`, el
 * llamador decide dónde persistirlas (element.props.conditionalFormats y
 * element.props.colorScales).
 */
function ConditionalFormatEditor({ rules, onChange, colorScales, onColorScalesChange, activeSelection }: ConditionalFormatEditorProps) {
  // A qué acotar la PRÓXIMA regla/escala (compartido entre el formulario de
  // regla manual y el de escala de color -- ambos leen de acá al guardar).
  // "Recordado" mientras el usuario cambia de selección: si elige 'row' y
  // luego selecciona algo que ya no forma una sola fila, effectiveScope
  // (abajo) cae de vuelta a 'table' para el guardado/resaltado, pero el
  // valor crudo se conserva por si vuelve a seleccionar una fila.
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>('table');
  const selectionCells = activeSelection?.cells || [];
  const selectionSingleRow = selectionCells.length > 0 && selectionCells.every((c) => c.row === selectionCells[0].row)
    ? selectionCells[0].row : null;
  const selectionSingleColumn = selectionCells.length > 0 && selectionCells.every((c) => c.column === selectionCells[0].column)
    ? selectionCells[0].column : null;
  const effectiveScopeChoice: ScopeChoice =
    scopeChoice === 'cells' && selectionCells.length > 0 ? 'cells'
    : scopeChoice === 'row' && selectionSingleRow !== null ? 'row'
    : scopeChoice === 'column' && selectionSingleColumn !== null ? 'column'
    : 'table';
  const buildScope = (): ConditionalFormatScope | undefined => {
    if (effectiveScopeChoice === 'cells') return { type: 'cells', cells: selectionCells };
    if (effectiveScopeChoice === 'row' && selectionSingleRow !== null) return { type: 'row', row: selectionSingleRow };
    if (effectiveScopeChoice === 'column' && selectionSingleColumn !== null) return { type: 'column', column: selectionSingleColumn };
    return undefined;
  };

  const [showForm, setShowForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [condition, setCondition] = useState<ConditionType>('greaterThan');
  const [value, setValue] = useState('');
  const [value2, setValue2] = useState('');
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BG);
  const [textColor, setTextColor] = useState(DEFAULT_TEXT);

  const [activeTemplate, setActiveTemplate] = useState<ThreeTierTemplate | null>(null);
  const [templateMin, setTemplateMin] = useState('');
  const [templateMax, setTemplateMax] = useState('');

  // Escala de color (ver DEFAULT_SCALE_COLORS/SCALE_STOP_* arriba) --
  // scaleValues/scaleColors son SIEMPRE de largo 3 (mín/medio/máx); con
  // scaleCount=2 el índice 1 (medio) simplemente no se usa al construir la
  // escala, pero se conserva por si el usuario alterna entre 2 y 3.
  const [editingScaleId, setEditingScaleId] = useState<string | null>(null);
  const [scaleCount, setScaleCount] = useState<ScaleCount>(2);
  const [scaleValues, setScaleValues] = useState<[string, string, string]>(['', '', '']);
  const [scaleColors, setScaleColors] = useState<[string, string, string]>(DEFAULT_SCALE_COLORS);
  // Color de TEXTO por punto -- opcional (vacío = no pisa el color de texto
  // normal de la celda), a diferencia del fondo que siempre tiene un valor.
  const [scaleTextColors, setScaleTextColors] = useState<[string, string, string]>(['', '', '']);

  const resetForm = () => {
    setCondition('greaterThan');
    setValue('');
    setValue2('');
    setBackgroundColor(DEFAULT_BG);
    setTextColor(DEFAULT_TEXT);
    setShowForm(false);
    setEditingRuleId(null);
  };

  const startNewRule = () => {
    resetForm();
    setShowForm(true);
    setActiveTemplate(null);
  };

  const resetScaleForm = () => {
    setEditingScaleId(null);
    setScaleCount(2);
    setScaleValues(['', '', '']);
    setScaleColors(DEFAULT_SCALE_COLORS);
    setScaleTextColors(['', '', '']);
  };

  // Clic en una escala YA guardada -- carga sus stops en el mismo formulario
  // para editarla en el sitio (mismo criterio que startEditRule). Si tiene 2
  // stops, van a los índices mín/máx (0/2) y el medio queda en su default.
  const startEditScale = (scale: ColorScaleFormat) => {
    const count: 2 | 3 = scale.stops.length === 3 ? 3 : 2;
    const indexes = SCALE_STOP_INDEXES[count];
    const nextValues: [string, string, string] = ['', '', ''];
    const nextColors: [string, string, string] = [...DEFAULT_SCALE_COLORS];
    const nextTextColors: [string, string, string] = ['', '', ''];
    scale.stops.forEach((stop, i) => {
      const idx = indexes[i];
      nextValues[idx] = stop.value;
      nextColors[idx] = stop.backgroundColor;
      nextTextColors[idx] = stop.textColor || '';
    });
    setScaleCount(count);
    setScaleValues(nextValues);
    setScaleColors(nextColors);
    setScaleTextColors(nextTextColors);
    setEditingScaleId(scale.id);
    setScopeChoice(scopeChoiceFor(scale.scope));
  };

  const scaleStopIndexes = scaleCount === 1 ? [] : SCALE_STOP_INDEXES[scaleCount];
  const scaleStopLabels = scaleCount === 1 ? [] : SCALE_STOP_LABELS[scaleCount];
  const scaleNumericValues = scaleStopIndexes.map((idx) => Number(scaleValues[idx]));
  const scaleValuesValid =
    scaleStopIndexes.length > 0 &&
    scaleStopIndexes.every((idx) => scaleValues[idx].trim() !== '') &&
    scaleNumericValues.every((n) => Number.isFinite(n)) &&
    scaleNumericValues.every((n, i) => i === 0 || n > scaleNumericValues[i - 1]);

  const saveScale = () => {
    if (!scaleValuesValid) return;
    const stops = scaleStopIndexes.map((idx) => ({
      value: scaleValues[idx].trim(),
      backgroundColor: scaleColors[idx],
      textColor: scaleTextColors[idx] || undefined,
    }));
    const scope = buildScope();
    if (editingScaleId) {
      onColorScalesChange(colorScales.map((s) => (s.id === editingScaleId ? { ...s, stops, scope } : s)));
    } else {
      const newScale: ColorScaleFormat = { id: `cs-${Date.now()}-${Math.round(Math.random() * 1e6)}`, stops, scope };
      onColorScalesChange([...(colorScales || []), newScale]);
    }
    resetScaleForm();
  };

  const removeScale = (id: string) => {
    onColorScalesChange((colorScales || []).filter((s) => s.id !== id));
    if (editingScaleId === id) resetScaleForm();
  };

  // Clic en una regla YA guardada -- carga sus datos en el mismo formulario
  // para editarla en el sitio, en vez de tener que borrarla y rehacerla.
  const startEditRule = (rule: ConditionalFormatRule) => {
    setCondition(rule.condition);
    setValue(rule.value);
    setValue2(rule.value2 || '');
    setBackgroundColor(rule.backgroundColor || DEFAULT_BG);
    setTextColor(rule.textColor || DEFAULT_TEXT);
    setEditingRuleId(rule.id);
    setShowForm(true);
    setActiveTemplate(null);
    setScopeChoice(scopeChoiceFor(rule.scope));
  };

  const saveRule = () => {
    if (!value.trim()) return;
    const patch = {
      condition,
      value: value.trim(),
      value2: NEEDS_SECOND_VALUE.includes(condition) ? value2.trim() : undefined,
      backgroundColor: backgroundColor || undefined,
      textColor: textColor || undefined,
      scope: buildScope(),
    };
    if (editingRuleId) {
      onChange(rules.map((r) => (r.id === editingRuleId ? { ...r, ...patch } : r)));
    } else {
      const newRule: ConditionalFormatRule = { id: `cf-${Date.now()}-${Math.round(Math.random() * 1e6)}`, ...patch };
      onChange([...(rules || []), newRule]);
    }
    resetForm();
  };

  const removeRule = (id: string) => {
    onChange((rules || []).filter((r) => r.id !== id));
    if (editingRuleId === id) resetForm();
  };

  const applyTemplate = () => {
    if (!activeTemplate) return;
    const min = Number(templateMin);
    const max = Number(templateMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return;
    const scope = buildScope();
    const newRules = buildThreeTierRules(activeTemplate, min, max).map((r) => ({ ...r, scope }));
    onChange([...(rules || []), ...newRules]);
    setActiveTemplate(null);
    setTemplateMin('');
    setTemplateMax('');
  };

  return (
    <div
      className="input-group"
      title="Pinta automáticamente celdas cuyo valor cumpla una condición -- como el Formato condicional de Excel"
      style={{ marginTop: 8 }}
    >
      <label>Formato Condicional</label>

      {/* A qué acotar la PRÓXIMA regla/escala que se guarde -- "Toda la
         tabla" siempre disponible; el resto aparece solo si hay una
         selección de celdas activa en el lienzo AHORA MISMO (ver
         lib/tableCellSelectionBridge.ts). "Fila"/"Columna" solo si esa
         selección cae entera en una sola fila/columna (una celda suelta
         cuenta para ambas). Esto NO mueve ni filtra las reglas ya
         guardadas -- cada una conserva el scope que tenía al crearse. */}
      <div className="conditional-format-scope">
        <span className="conditional-format-scope-label">Aplicar a</span>
        <div className="conditional-format-scope-options">
          <button
            type="button"
            className={`conditional-format-scope-btn${effectiveScopeChoice === 'table' ? ' is-active' : ''}`}
            onClick={() => setScopeChoice('table')}
          >
            Toda la tabla
          </button>
          {selectionCells.length > 0 && (
            <button
              type="button"
              className={`conditional-format-scope-btn${effectiveScopeChoice === 'cells' ? ' is-active' : ''}`}
              onClick={() => setScopeChoice('cells')}
              title="La selección de celdas que tienes activa ahora mismo en la tabla"
            >
              {selectionCells.length === 1 ? '1 celda' : `${selectionCells.length} celdas`}
            </button>
          )}
          {selectionSingleRow !== null && (
            <button
              type="button"
              className={`conditional-format-scope-btn${effectiveScopeChoice === 'row' ? ' is-active' : ''}`}
              onClick={() => setScopeChoice('row')}
            >
              Fila {selectionSingleRow + 1}
            </button>
          )}
          {selectionSingleColumn !== null && (
            <button
              type="button"
              className={`conditional-format-scope-btn${effectiveScopeChoice === 'column' ? ' is-active' : ''}`}
              onClick={() => setScopeChoice('column')}
            >
              Columna {selectionSingleColumn + 1}
            </button>
          )}
        </div>
      </div>

      {(rules || []).length > 0 && (
        <div className="conditional-format-list">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`conditional-format-row${editingRuleId === rule.id ? ' conditional-format-row--active' : ''}`}
              role="button"
              tabIndex={0}
              title="Clic para editar esta regla"
              onClick={() => startEditRule(rule)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEditRule(rule); } }}
            >
              <span
                className="conditional-format-swatch"
                style={{ background: rule.backgroundColor || 'transparent', color: rule.textColor || '#334155' }}
              >
                Aa
              </span>
              <span className="conditional-format-summary">{summarizeRule(rule)}</span>
              <button
                type="button"
                className="conditional-format-delete"
                title="Eliminar esta regla"
                onClick={(e) => { e.stopPropagation(); removeRule(rule.id); }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="conditional-format-scales" title="Degradado continuo entre 1, 2 o 3 colores según el valor de la celda -- como Format Style '2-Color Scale' / '3-Color Scale' en Excel">
        <span className="conditional-format-templates-label">Escala de color</span>
        {(colorScales || []).length > 0 && (
          <div className="conditional-format-list">
            {colorScales.map((scale) => (
              <div
                key={scale.id}
                className={`conditional-format-row${editingScaleId === scale.id ? ' conditional-format-row--active' : ''}`}
                role="button"
                tabIndex={0}
                title="Clic para editar esta escala"
                onClick={() => startEditScale(scale)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEditScale(scale); } }}
              >
                <span
                  className="conditional-format-swatch conditional-format-swatch--gradient"
                  style={{ background: `linear-gradient(to right, ${scale.stops.map((s) => s.backgroundColor).join(', ')})` }}
                />
                <span className="conditional-format-summary">{summarizeScale(scale)}</span>
                <button
                  type="button"
                  className="conditional-format-delete"
                  title="Eliminar esta escala"
                  onClick={(e) => { e.stopPropagation(); removeScale(scale.id); }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="conditional-format-scale-count">
          {([1, 2, 3] as ScaleCount[]).map((n) => (
            <button
              key={n}
              type="button"
              className={`conditional-format-scale-count-btn${scaleCount === n ? ' is-active' : ''}`}
              // OJO: NO limpiar editingScaleId acá -- a diferencia de elegir
              // una plantilla fija (acción alternativa excluyente a editar
              // una regla), esto es un modificador de la ESCALA que ya se
              // está creando/editando (p.ej. pasar de 2 a 3 puntos a mitad
              // de editar una existente). Limpiarlo hacía que "Guardar
              // cambios" se comportara como "Aplicar escala" y creara una
              // escala duplicada en vez de actualizar la que se editaba.
              onClick={() => setScaleCount(n)}
              style={{color:"white"}}
            >
              {n}
            </button>
          ))}
        </div>

        {scaleCount === 1 ? (
          <p className="conditional-format-scale-hint">
            Una escala de 1 solo color es lo mismo que "Agregar regla manual" más abajo (un valor, un color).
          </p>
        ) : (
          <div className="conditional-format-form">
            {editingScaleId && (
              <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>Editando escala existente</p>
            )}
            {scaleStopIndexes.map((idx, i) => (
              <div className="conditional-format-scale-stop" key={idx}>
                <span className="conditional-format-scale-stop-label">{scaleStopLabels[i]}</span>
                <input
                  className="input-premium"
                  type="number"
                  placeholder="valor"
                  value={scaleValues[idx]}
                  onChange={(e) => {
                    const next = [...scaleValues] as [string, string, string];
                    next[idx] = e.target.value;
                    setScaleValues(next);
                  }}
                />
                <ColorPalette
                  value={scaleColors[idx]}
                  title={`Color de fondo en el punto "${scaleStopLabels[i]}"`}
                  align="right"
                  onChange={(color) => {
                    const next = [...scaleColors] as [string, string, string];
                    next[idx] = color;
                    setScaleColors(next);
                  }}
                />
                <ColorPalette
                  value={scaleTextColors[idx] || '#334155'}
                  title={`Color de texto en el punto "${scaleStopLabels[i]}" (opcional)`}
                  align="right"
                  allowClear
                  onChange={(color) => {
                    const next = [...scaleTextColors] as [string, string, string];
                    next[idx] = color;
                    setScaleTextColors(next);
                  }}
                  onClear={() => {
                    const next = [...scaleTextColors] as [string, string, string];
                    next[idx] = '';
                    setScaleTextColors(next);
                  }}
                  // Trigger a medida: el swatch liso por defecto es indistinguible
                  // del de fondo (mismo cuadrado). Una "A" del color elegido dentro
                  // del mismo botón deja claro que este es el color de TEXTO.
                  renderTrigger={(trigger) => (
                    <button
                      type="button"
                      className="color-palette-trigger conditional-format-scale-text-trigger"
                      title={`Color de texto en el punto "${scaleStopLabels[i]}" (opcional)`}
                      onMouseDown={trigger.onMouseDown}
                      onClick={trigger.onClick}
                    >
                      <span style={{ color: scaleTextColors[idx] || '#94a3b8' }}>A</span>
                    </button>
                  )}
                />
              </div>
            ))}
            <div
              className="conditional-format-scale-preview"
              style={{ background: `linear-gradient(to right, ${scaleStopIndexes.map((idx) => scaleColors[idx]).join(', ')})` }}
            />
            <div className="conditional-format-actions">
              {editingScaleId && <button type="button" className="btn-premium-outline" onClick={resetScaleForm}>Cancelar</button>}
              <button type="button" className="btn-premium" onClick={saveScale} disabled={!scaleValuesValid}>
                {editingScaleId ? 'Guardar cambios' : 'Aplicar escala'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="conditional-format-templates" title="A diferencia de la escala de arriba, acá cada franja tiene un color FIJO -- sin degradado entre ellas">
        <span className="conditional-format-templates-label">Plantillas rápidas (bandas fijas, bajo / medio / alto)</span>
        <div className="conditional-format-templates-grid">
          {THREE_TIER_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className={`conditional-format-template-swatch${activeTemplate?.id === tpl.id ? ' is-active' : ''}`}
              title={tpl.label}
              onClick={() => { setActiveTemplate(tpl); setShowForm(false); setEditingRuleId(null); }}
            >
              <span style={{ background: tpl.low.backgroundColor }} />
              <span style={{ background: tpl.mid.backgroundColor }} />
              <span style={{ background: tpl.high.backgroundColor }} />
            </button>
          ))}
        </div>
      </div>

      {activeTemplate && (
        <div className="conditional-format-form">
          <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', lineHeight: 1.35 }}>
            {activeTemplate.label}: por debajo del mínimo usa el primer color, entre mínimo y máximo el color medio,
            desde el máximo el último.
          </p>
          <div className="conditional-format-values">
            <input className="input-premium" type="number" placeholder="Mínimo" value={templateMin} onChange={(e) => setTemplateMin(e.target.value)} />
            <input className="input-premium" type="number" placeholder="Máximo" value={templateMax} onChange={(e) => setTemplateMax(e.target.value)} />
          </div>
          <div className="conditional-format-actions">
            <button type="button" className="btn-premium-outline" onClick={() => setActiveTemplate(null)}>Cancelar</button>
            <button
              type="button"
              className="btn-premium"
              onClick={applyTemplate}
              disabled={!templateMin.trim() || !templateMax.trim() || Number(templateMin) >= Number(templateMax)}
            >
              Aplicar plantilla
            </button>
          </div>
        </div>
      )}

      {!showForm ? (
        <button
          type="button"
          className="btn-premium-outline"
          style={{ width: '100%', marginTop: 6 }}
          onClick={startNewRule}
        >
          <Plus size={13} style={{ marginRight: 6 }} /> Agregar regla manual
        </button>
      ) : (
        <div className="conditional-format-form">
          {editingRuleId && (
            <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>Editando regla existente</p>
          )}
          <select
            className="input-premium"
            value={condition}
            onChange={(e) => setCondition(e.target.value as ConditionType)}
          >
            {(Object.keys(CONDITION_LABELS) as ConditionType[]).map((key) => (
              <option key={key} value={key}>{CONDITION_LABELS[key]}</option>
            ))}
          </select>
          <div className="conditional-format-values">
            <input
              className="input-premium"
              type={NUMERIC_CONDITIONS.includes(condition) ? 'number' : 'text'}
              placeholder={condition === 'textContains' ? 'texto a buscar' : 'valor'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {NEEDS_SECOND_VALUE.includes(condition) && (
              <input
                className="input-premium"
                type="number"
                placeholder="y"
                value={value2}
                onChange={(e) => setValue2(e.target.value)}
              />
            )}
          </div>
          <div className="conditional-format-colors">
            <span>Fondo</span>
            <ColorPalette
              value={backgroundColor}
              title="Color de fondo cuando se cumple la condición"
              align="right"
              allowClear
              onChange={setBackgroundColor}
              onClear={() => setBackgroundColor('')}
            />
            <span>Texto</span>
            <ColorPalette
              value={textColor}
              title="Color de texto cuando se cumple la condición"
              align="right"
              allowClear
              onChange={setTextColor}
              onClear={() => setTextColor('')}
            />
          </div>
          <div className="conditional-format-actions">
            <button type="button" className="btn-premium-outline" onClick={resetForm}>Cancelar</button>
            <button type="button" className="btn-premium" onClick={saveRule} disabled={!value.trim()}>
              {editingRuleId ? 'Guardar cambios' : 'Guardar regla'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ConditionalFormatEditor;
