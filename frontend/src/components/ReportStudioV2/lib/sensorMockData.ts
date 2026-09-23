import type { SensorSelection } from '../components/layout/ZoneSensorPicker';

/**
 * Datos de prueba para SensorMultiChartWidget.tsx cuando la telemetría real
 * (backend, `/mining/telemetry/wizard/query`) todavía no tiene lecturas para
 * los sensores/rango elegidos -- pedido explícito 2026-09-04: "necesito data
 * para que se pinte bonito" mientras el backend/BD no tiene historial
 * cargado. El widget los usa SOLO como respaldo visible (ver
 * SensorMultiChartWidget.tsx: `usingMockData`, banner "DATOS DE PRUEBA"),
 * nunca reemplaza telemetría real que sí haya llegado.
 *
 * La forma de cada fila (`sensor_id`, `t`, `v`) es exactamente la que ya usa
 * el widget real (`SeriesRow` en SensorMultiChartWidget.tsx) para no tocar
 * nada del pipeline de render/gráficos -- `t` en el mismo formato Postgres
 * ("YYYY-MM-DD HH:MM:SS+TZ") que ya sabe interpretar `buildOptionFor`.
 */

export interface MockSeriesRow {
  sensor_id: string;
  t: string;
  v: number;
}

type SensorPattern = {
  base: number;
  amplitude: number;
  noise: number;
  /** Deriva lineal acumulada de principio a fin del rango (mm, kPa, etc. según el sensor) -- simula una tendencia real, no solo ruido. */
  drift: number;
  decimals: number;
};

/** Heurística por nombre/código del sensor (mismas categorías que ya se ven
 * en el Centro de Control: inclinómetros, radar GB-SAR, piezómetros, calidad
 * de aire) -- así el dato "de prueba" al menos tiene el orden de magnitud y
 * el tipo de variación correctos para cada tipo real, en vez de un número
 * aleatorio genérico 0-100 sin sentido físico. */
function patternFor(sel: SensorSelection): SensorPattern {
  const text = `${sel.code || ''} ${sel.name || ''}`.toLowerCase();
  if (/pm10|pm2\.?5|aire|calidad/.test(text)) {
    return { base: 32, amplitude: 14, noise: 4, drift: 6, decimals: 1 }; // µg/m³, ciclo diario + tendencia leve
  }
  if (/piez[oó]metro|poro|presi[oó]n/.test(text)) {
    return { base: 145, amplitude: 3, noise: 1.5, drift: 4, decimals: 1 }; // kPa, muy estable con deriva lenta
  }
  if (/inclin[oó]metro|talud|botadero/.test(text)) {
    return { base: 0, amplitude: 0.4, noise: 0.15, drift: 3.2, decimals: 2 }; // mm, deriva acumulada (desplazamiento)
  }
  if (/radar|gb-?sar|velocidad|desplaz/.test(text)) {
    return { base: 0.5, amplitude: 0.3, noise: 0.4, drift: 1.5, decimals: 2 }; // mm/día, mayormente bajo con picos
  }
  if (/temperat/.test(text)) {
    return { base: 18, amplitude: 6, noise: 1, drift: 0, decimals: 1 }; // °C, ciclo diario sin deriva
  }
  if (/humedad|hum[ií]/.test(text)) {
    return { base: 55, amplitude: 15, noise: 3, drift: 0, decimals: 0 }; // %HR
  }
  return { base: 50, amplitude: 20, noise: 5, drift: 0, decimals: 2 }; // genérico
}

/** Mismo generador determinístico por sensor (semilla = hash del sensorId) —
 * dos llamadas con el mismo sensor/rango dan el mismo gráfico, en vez de
 * saltar en cada re-render (confuso para revisar visualmente si "ya cargó" o
 * cambió de nuevo). */
function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

/** Formatea igual que Postgres serializa un timestamptz (con espacio, no
 * "T", y offset +00) -- el mismo formato que `buildOptionFor` en
 * SensorMultiChartWidget.tsx ya sabe convertir a epoch para el eje de
 * tiempo de ECharts. */
function toPgTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '+00');
}

/**
 * Genera lecturas horarias de prueba para cada sensor seleccionado, en el
 * rango [from, to]. Tope de 400 puntos por sensor (~16 días horarios) para
 * no inflar el payload si el usuario eligió un rango largo -- suficiente
 * para que cualquier tipo de gráfico (línea, área, barras, heatmap, etc.)
 * se vea con una tendencia creíble, no solo ruido plano.
 */
export function generateMockSensorSeries(
  selections: SensorSelection[],
  from: string,
  to: string,
): MockSeriesRow[] {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || selections.length === 0) {
    return [];
  }
  const spanMs = toMs - fromMs;
  const MAX_POINTS = 400;
  const hourMs = 60 * 60 * 1000;
  // Rangos cortos ("Última hora"): paso por minuto, si no quedarían 1-2 puntos.
  const minuteMs = 60 * 1000;
  const stepMs = spanMs <= 6 * hourMs
    ? Math.max(minuteMs, Math.ceil(spanMs / MAX_POINTS / minuteMs) * minuteMs)
    : Math.max(hourMs, Math.ceil(spanMs / MAX_POINTS / hourMs) * hourMs);

  const rows: MockSeriesRow[] = [];
  selections.forEach((sel) => {
    const pattern = patternFor(sel);
    const rand = seededRandom(hashString(sel.sensorId || sel.code || sel.name || 'sensor'));
    // Fase inicial aleatoria (pero determinística) para que sensores del
    // mismo tipo no queden todos en fase -- se ven como series distintas
    // reales, no copias desplazadas del mismo seno.
    const phase = rand() * Math.PI * 2;
    let i = 0;
    for (let t = fromMs; t <= toMs; t += stepMs, i += 1) {
      const progress = spanMs > 0 ? (t - fromMs) / spanMs : 0;
      const cyclePerDay = ((t - fromMs) / (24 * hourMs)) * Math.PI * 2;
      const seasonal = Math.sin(cyclePerDay + phase) * pattern.amplitude;
      const jitter = (rand() - 0.5) * 2 * pattern.noise;
      const drift = pattern.drift * progress;
      const value = pattern.base + seasonal + jitter + drift;
      rows.push({
        sensor_id: sel.sensorId,
        t: toPgTimestamp(new Date(t)),
        v: Number(value.toFixed(pattern.decimals)),
      });
    }
  });
  return rows;
}
