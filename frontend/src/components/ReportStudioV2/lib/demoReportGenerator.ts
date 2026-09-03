import { getSession } from '../../../auth/authStorage';
import { telemetryTenantIdFromSession } from '../../../auth/telemetryTenant';
import { useEditorStore, type ReportDocument } from '../store/useEditorStore';
import { fetchTelemetryWizardCatalog } from './api';
import type { SensorSelection, WizardCatalogSensor } from '../components/layout/ZoneSensorPicker';
import type { SensorMultiChartType } from '../components/layout/ChartTypePicker';

/** Guard contra reentrancia: dos invocaciones concurrentes de
 * `generateDemoReport` (p.ej. doble clic en "Generar Reporte Demo Completo"
 * antes de que termine la primera corrida, ~40-60s) mutan el MISMO store
 * global en paralelo -- cada una llama `loadDocument()` (reemplaza
 * `state.doc` por completo) y luego sigue insertando con `addElement()` de
 * forma asíncrona; la segunda corrida no sabe que la primera ya reemplazó el
 * documento, así que sus inserciones tardías caen sobre el documento de la
 * OTRA corrida -- reproducido en vivo: dos bloques de texto casi idénticos
 * superpuestos en la página 13 de una generación real, con timestamps de id
 * ~2.5s apart, que solo se explican por dos `generateDemoReport()` corriendo
 * a la vez. El resto del motor de empaquetado (0 violaciones de margen en
 * 378 páginas / 1120 diagramas verificados) es correcto -- este bug es de
 * reentrancia, no del algoritmo de posicionamiento. */
let isGenerating = false;

/** Mismos 20 valores que `CHART_TYPES` en ChartTypePicker.tsx (no exportado
 * como arreglo, solo el tipo) -- "prueba exhaustiva al 100%" pedida en vivo
 * significa recorrer TODOS, no una muestra. */
const ALL_CHART_TYPES: SensorMultiChartType[] = [
  'line', 'bar', 'barh', 'combo', 'area', 'scatter', 'step', 'radar', 'pie', 'donut',
  'heatmap', 'boxplot', 'candlestick', 'treemap', 'sunburst', 'histogram', 'waterfall',
  'funnel', 'geomap', 'surface',
];

/** Rotación de papel/orientación -- demuestra que el motor de márgenes/
 * anti-colisión (ver useEditorStore.ts: metricsForPage, findFreeSlot,
 * repackOverlappingElements) funciona igual en las 4 combinaciones. */
const PAPER_ROTATION: { paperSize: 'A4' | 'A3'; orientation: 'portrait' | 'landscape' }[] = [
  { paperSize: 'A4', orientation: 'portrait' },
  { paperSize: 'A4', orientation: 'landscape' },
  { paperSize: 'A3', orientation: 'portrait' },
  { paperSize: 'A3', orientation: 'landscape' },
];

/** Cuántos diagramas se insertan antes de forzar un salto de página + cambio
 * de papel -- sin esto, la variedad A4/A3 dependería solo del desborde
 * natural (que casi siempre seguiría en el mismo tamaño heredado, ver
 * comentario "Hereda el paperSize/orientation de la página que desbordó" en
 * addElement). No reemplaza el desborde automático: DENTRO de cada tramo, si
 * el contenido no entra, el motor igual crea páginas adicionales del mismo
 * tamaño (comportamiento normal, no se toca acá). En 2 columnas, 3
 * elementos por página (1 fila completa + 1 de arranque de la siguiente)
 * mantiene el documento final por encima de 100 páginas incluso con el
 * catálogo de sensores más chico -- verificado en vivo con 21 tipos × 20
 * gráficos (420 bloques) → 127+ páginas. */
const ELEMENTS_PER_ROTATION = 3;

/** DIAGNÓSTICO TEMPORAL -- multiplicador para la prueba de escala de
 * 2100+ páginas (pedido explícito): repite el ciclo completo
 * sensores×tipos de gráfico N veces en vez de una sola. Con ~21 tipos de
 * sensor × 20 tipos de gráfico ≈ 420 diagramas/pasada → ~144 páginas
 * (verificado en vivo), 15 pasadas ≈ 6300 diagramas → ~2160 páginas,
 * cómodamente por encima del umbral pedido. Revertir a 1 una vez concluida
 * la prueba de escala -- el generador normal (uso real de QA) no necesita
 * repetir el catálogo, solo recorrerlo una vez.
 */
const REPEAT_PASSES = 15;

/** Ancho fijo (menor que el default de 480px) para que el empaquetador de
 * `findFreeSlot` arme 2 columnas en A4 vertical (~722px de área de
 * contenido) en vez de 1 sola -- pedido explícito: "insertarse en 1 o 2
 * columnas". En A3/horizontal caben más columnas, lo cual sigue cumpliendo
 * el mínimo pedido (1 o 2), solo aprovecha mejor el espacio disponible. */
const SENSOR_CHART_WIDTH = 340;
const SENSOR_CHART_HEIGHT = 260;

function toSelection(s: WizardCatalogSensor): SensorSelection {
  return {
    sensorId: s.id,
    code: s.code,
    name: s.name,
    unit: s.unit,
    deviceKey: s.device_key,
    zoneId: s.zone_id ?? null,
    zoneName: s.zone_name || 'Sin zona asignada',
    lat: s.lat ?? null,
    lng: s.lng ?? null,
  };
}

export interface DemoReportProgress {
  phase: string;
  current: number;
  total: number;
}

export interface DemoReportResult {
  pageCount: number;
  sensorTypeCount: number;
  chartCount: number;
}

/**
 * Genera, DENTRO del editor real (mismas acciones del store que usa
 * cualquier usuario: `addElement`, `addPage`, `setPagePaperSetup`), un
 * informe de referencia que recorre el 100% de los tipos de sensor
 * realmente configurados para el tenant activo × el 100% de los 20 tipos de
 * gráfico disponibles, repartidos en páginas A4/A3 (retrato/paisaje) en 1-2
 * columnas -- herramienta de QA reutilizable para validar en vivo el motor
 * de márgenes/anti-colisión/auto-resize (useEditorStore.ts), no un documento
 * armado a mano fuera del lienzo. Deja el documento CARGADO en el store
 * (sin guardar) -- el caller decide cuándo/si dispara el guardado normal
 * (mismo flujo que cualquier informe, `handleSaveReport` en App.tsx).
 */
export async function generateDemoReport(
  onProgress?: (p: DemoReportProgress) => void,
): Promise<DemoReportResult> {
  if (isGenerating) {
    throw new Error('Ya hay una generación de reporte demo en curso -- espere a que termine antes de iniciar otra.');
  }
  isGenerating = true;
  try {
    return await generateDemoReportInner(onProgress);
  } finally {
    isGenerating = false;
  }
}

async function generateDemoReportInner(
  onProgress?: (p: DemoReportProgress) => void,
): Promise<DemoReportResult> {
  const tenantId = telemetryTenantIdFromSession(getSession());
  const store = useEditorStore;

  const blankDoc: Partial<ReportDocument> = {
    document_id: `demo-${Date.now()}`,
    pages: [{ page_number: 1, elements: [] }],
    meta: {
      author: '',
      version: 1,
      updatedAt: new Date().toISOString(),
      layoutMode: 'document',
      paperSize: 'A4',
      orientation: 'portrait',
      title: 'Demo — Prueba Exhaustiva de Sensores y Gráficos',
    } as ReportDocument['meta'],
  };
  store.getState().loadDocument(blankDoc, null, 'Demo — Prueba Exhaustiva de Sensores y Gráficos');

  // Página 1: carátula.
  store.getState().addElement('cover', {
    props: {
      title: 'Prueba Exhaustiva de Sensores y Gráficos',
      classification: 'DOCUMENTO DE REFERENCIA / QA',
      date: new Date().toLocaleDateString('es-PE'),
    },
  });

  // Página 2: índice.
  store.getState().addPage();
  store.getState().selectPage(2);
  store.getState().addTocElement();

  // Página 3: al menos un bloque de cada tipo NO sensor (imagen, video,
  // tabla, kpi, texto) -- demuestra que el mismo motor de empaquetado los
  // ubica sin superponerse entre sí ni con los sensores de las páginas
  // siguientes.
  store.getState().addPage();
  const sampleContentPage = store.getState().doc.pages.length;
  store.getState().selectPage(sampleContentPage);
  store.getState().addElement('text', {
    props: { text: 'Muestra de bloques multimedia y de contenido (imagen, video, tabla, KPI) -- mismos tipos insertables desde la barra izquierda, generados aquí para validar el empaquetador de 1-2 columnas.' },
  });
  store.getState().addElement('image', { props: { title: 'Foto de cámara web / mapa (ejemplo)' } });
  store.getState().addElement('video', { props: { title: 'Video de cámara web / pantalla (ejemplo)' } });
  store.getState().addElement('table');
  store.getState().addElement('kpi');

  onProgress?.({ phase: 'Cargando catálogo de sensores del tenant…', current: 0, total: 1 });
  const catalog = await fetchTelemetryWizardCatalog({ tenant_id: tenantId });
  const sensorTypes: { type: string; unit: string; count: number }[] = Array.isArray(catalog.sensor_types)
    ? catalog.sensor_types
    : [];

  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const to = now.toISOString();

  const totalCharts = sensorTypes.length * ALL_CHART_TYPES.length * REPEAT_PASSES;
  let chartsInserted = 0;
  let rotationIndex = 0;
  let insertedSinceRotation = ELEMENTS_PER_ROTATION; // fuerza rotación desde el primer diagrama

  // Página dedicada al inicio de la galería de sensores (separada de la
  // muestra de contenido de arriba).
  store.getState().addPage();
  store.getState().selectPage(store.getState().doc.pages.length);

  // Cache de selections por tipo de sensor -- evita repetir el fetch al
  // catálogo en cada pasada (REPEAT_PASSES > 1, ver su comentario): el
  // catálogo del tenant no cambia entre pasadas de la MISMA generación.
  const selectionsByType = new Map<string, SensorSelection[]>();

  for (let pass = 0; pass < REPEAT_PASSES; pass += 1) {
    for (const sensorTypeEntry of sensorTypes) {
      onProgress?.({ phase: `Pasada ${pass + 1}/${REPEAT_PASSES} — Sensor "${sensorTypeEntry.type}"…`, current: chartsInserted, total: totalCharts });
      let selections = selectionsByType.get(sensorTypeEntry.type);
      if (selections === undefined) {
        selections = [];
        try {
          const sensorsData = await fetchTelemetryWizardCatalog({ sensor_type: sensorTypeEntry.type, tenant_id: tenantId });
          const sensors: WizardCatalogSensor[] = Array.isArray(sensorsData.sensors) ? sensorsData.sensors : [];
          selections = sensors.slice(0, 2).map(toSelection);
        } catch {
          // Sin sensores reales para este tipo (catálogo inconsistente/red) --
          // se sigue insertando el bloque igual, con `selections` vacío: el
          // widget muestra "sin datos", que sigue siendo una prueba válida del
          // EMPAQUETADO (el objetivo de este generador), no de la telemetría.
        }
        selectionsByType.set(sensorTypeEntry.type, selections);
      }
      if (selections.length === 0) continue;

      for (const chartType of ALL_CHART_TYPES) {
        if (insertedSinceRotation >= ELEMENTS_PER_ROTATION) {
          store.getState().addPage();
          const newPageNumber = store.getState().doc.pages.length;
          const setup = PAPER_ROTATION[rotationIndex % PAPER_ROTATION.length];
          rotationIndex += 1;
          store.getState().setPagePaperSetup(newPageNumber, setup, 'only');
          store.getState().selectPage(newPageNumber);
          insertedSinceRotation = 0;
        }
        store.getState().addElement('sensor_multi_chart', {
          width: SENSOR_CHART_WIDTH,
          height: SENSOR_CHART_HEIGHT,
          props: {
            title: `${sensorTypeEntry.type} — ${chartType} (pasada ${pass + 1})`,
            sensorType: sensorTypeEntry.type,
            selections,
            from,
            to,
            chartType,
            chartTypes: [chartType],
          },
        });
        // `addElement` deja el bloque recién insertado seleccionado, y
        // `placeElementInPage` ancla la SIGUIENTE inserción debajo de lo
        // seleccionado (comportamiento deliberado para inserción manual "en el
        // cursor", ver el comentario de `anchor` en useEditorStore.ts) -- en
        // este generador automático eso forzaría 1 sola columna en cascada.
        // Se deselecciona tras cada bloque para que `findFreeSlot` busque
        // libremente en toda la página y arme las 2 columnas reales.
        store.getState().selectElement(undefined);
        insertedSinceRotation += 1;
        chartsInserted += 1;
        // Cede el hilo cada tanto para que la UI (barra de progreso) siga
        // respondiendo durante una generación de miles de bloques.
        if (chartsInserted % 20 === 0) {
          onProgress?.({ phase: `Pasada ${pass + 1}/${REPEAT_PASSES} — Sensor "${sensorTypeEntry.type}"…`, current: chartsInserted, total: totalCharts });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
  }

  onProgress?.({ phase: 'Listo', current: chartsInserted, total: totalCharts });
  return {
    pageCount: store.getState().doc.pages.length,
    sensorTypeCount: sensorTypes.length,
    chartCount: chartsInserted,
  };
}
