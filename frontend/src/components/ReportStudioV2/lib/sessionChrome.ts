/* Resuelve el nombre de la unidad minera desde la sesión activa de forma
 * defensiva: AuthGateway aún no emite un campo único y estable para esto —
 * distintos flujos de login han usado distintas claves a lo largo del
 * proyecto (miningUnit/unitName/mineUnit/site, ver App.tsx raíz). Se
 * centraliza aquí para que encabezado, carátula, ReadOnlyViewer y el motor
 * de exportación PDF siempre lean la misma fuente y nunca queden en blanco. */
export function resolveMiningUnitName(session: unknown): string {
  const s = (session || {}) as Record<string, unknown>;
  const raw = [s.miningUnit, s.unitName, s.mineUnit, s.site]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return (raw || 'Unidad Principal').trim();
}
