import type { Page } from '@playwright/test'

/**
 * El shell principal (App.tsx) muestra un prompt "Mantenimiento de Usuarios"
 * en CADA carga de página para sesiones admin/supervisor (no solo en el
 * primer login real -- dispara en cualquier montaje con
 * `session?.company && canMaintain`, ver App.tsx). Las specs de e2e seedean
 * una sesión falsa admin/supervisor vía localStorage antes de `page.goto('/')`,
 * así que este prompt aparece siempre y bloquea cualquier click posterior
 * (p.ej. "Abrir Report") si no se descarta primero. No confundir con
 * `UserMaintenanceModal.tsx` (el modal real de mantenimiento, que sí se abre
 * a propósito en `user-maintenance.spec.ts`) -- este es solo el prompt de
 * "¿desea hacerlo ahora?" previo a ese modal.
 */
export async function dismissUserMaintenancePrompt(page: Page): Promise<void> {
  const dismissBtn = page.getByRole('button', { name: 'Ahora no' })
  if (await dismissBtn.isVisible().catch(() => false)) {
    await dismissBtn.click()
  }
}

/**
 * La navegación es de dos niveles (ADR-040): una categoría (p.ej.
 * "Reportes", "Mapas") que hay que abrir/expandir primero, y recién ahí
 * aparecen sus módulos ("Abrir Report", "Abrir Report v2", "Abrir Map",
 * etc.) como botones propios. Las specs viejas asumían una lista plana de
 * módulos visibles de entrada -- desactualizado desde que se introdujo ese
 * sistema de navegación.
 *
 * El nombre ACCESIBLE (ARIA) de cada botón de categoría es su `title`
 * (descripción larga, p.ej. "Mapa satelital de la operación y planos de
 * alta resolución."), NO la etiqueta corta visible ("Mapas") -- por eso
 * `getByRole('button', { name: 'Mapas' })` nunca matchea. Se busca por
 * TEXTO VISIBLE del botón en su lugar (el `<span>` interno sí dice
 * "Mapas"), con `.first()` porque el badge ("MAP", "Beta", etc.) queda
 * concatenado al mismo texto y podría, en teoría, dar más de un candidato.
 */
export async function openCategory(page: Page, categoryLabel: string): Promise<void> {
  const categoryBtn = page.locator('button').filter({ hasText: categoryLabel }).first()
  if (await categoryBtn.isVisible().catch(() => false)) {
    await categoryBtn.click()
  }
}

/**
 * "Mis Informes" (biblioteca de informes guardados, onOpenReportsAdmin) vive
 * dentro de la pestaña "Datos" del ribbon de ReportStudioV2 (RibbonToolbar.tsx,
 * grupo "Informes") -- no es visible con la pestaña "Inicio" (la que abre por
 * defecto). Hay que cambiar de pestaña del ribbon primero.
 *
 * Se usa texto visible (no accessible name/getByRole) para ambos clicks --
 * los botones del ribbon (RibbonBtn) llevan un `title` largo/descriptivo
 * distinto de su label corto visible, y distintas herramientas de
 * accesibilidad resuelven el nombre accesible de forma distinta para ese
 * patrón (title vs. contenido de texto) -- filtrar por texto visible evita
 * la ambigüedad por completo.
 */
export async function openMisInformes(page: Page): Promise<void> {
  await page.locator('button').filter({ hasText: 'Datos' }).first().click()
  await page.locator('button').filter({ hasText: 'Mis Informes' }).first().click()
}
