/**
 * Geometria minima del dashboard de sensores.
 *
 * El bloque combina una leyenda lateral fija con una grilla de graficos. La
 * altura debe calcularse con las columnas que REALMENTE caben despues de
 * descontar esa leyenda; asumir `chartCount` columnas fue la causa del scroll
 * interno y del segundo grafico recortado en informes ya guardados.
 */
export const SENSOR_DASHBOARD_CARD_MIN_WIDTH = 280;
export const SENSOR_DASHBOARD_CARD_MIN_HEIGHT = 220;
export const SENSOR_DASHBOARD_GAP = 8;
export const SENSOR_DASHBOARD_SIDEBAR_WIDTH = 160;
export const SENSOR_DASHBOARD_ROOT_PADDING = 8;
export const SENSOR_DASHBOARD_HEADER_HEIGHT = 28;
export const SENSOR_DASHBOARD_SINGLE_HEIGHT = 260;

export interface SensorDashboardLayout {
  columns: number;
  rows: number;
  minHeight: number;
}

export function sensorDashboardLayout(
  chartCount: number,
  blockWidth: number,
  hasSidebar = true,
): SensorDashboardLayout {
  const count = Math.max(1, Math.floor(Number.isFinite(chartCount) ? chartCount : 1));
  if (count === 1) {
    return { columns: 1, rows: 1, minHeight: SENSOR_DASHBOARD_SINGLE_HEIGHT };
  }

  const safeWidth = Math.max(SENSOR_DASHBOARD_CARD_MIN_WIDTH, Number.isFinite(blockWidth) ? blockWidth : 0);
  const sidebarAndGap = hasSidebar ? SENSOR_DASHBOARD_SIDEBAR_WIDTH + SENSOR_DASHBOARD_GAP : 0;
  const gridWidth = Math.max(
    SENSOR_DASHBOARD_CARD_MIN_WIDTH,
    safeWidth - SENSOR_DASHBOARD_ROOT_PADDING * 2 - sidebarAndGap,
  );
  const columns = Math.max(
    1,
    Math.min(
      count,
      Math.floor((gridWidth + SENSOR_DASHBOARD_GAP) / (SENSOR_DASHBOARD_CARD_MIN_WIDTH + SENSOR_DASHBOARD_GAP)),
    ),
  );
  const rows = Math.ceil(count / columns);
  const cardsHeight = rows * SENSOR_DASHBOARD_CARD_MIN_HEIGHT + (rows - 1) * SENSOR_DASHBOARD_GAP;
  // 8 px adicionales absorben diferencias de font metrics/subpixel entre el
  // navegador interactivo y Chromium headless sin introducir scroll.
  const minHeight = SENSOR_DASHBOARD_ROOT_PADDING * 2 + SENSOR_DASHBOARD_HEADER_HEIGHT + cardsHeight + 8;
  return { columns, rows, minHeight };
}

export function sensorChartTypes(props: Record<string, unknown> | null | undefined): string[] {
  const many = Array.isArray(props?.chartTypes)
    ? props.chartTypes.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  if (many.length) return many;
  return typeof props?.chartType === 'string' && props.chartType ? [props.chartType] : ['line'];
}

export function sensorDashboardMinHeight(
  props: Record<string, unknown> | null | undefined,
  blockWidth: number,
): number {
  return sensorDashboardLayout(sensorChartTypes(props).length, blockWidth, true).minHeight;
}
