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
 * sistema de navegación. Los módulos ya abiertos/expandidos no necesitan
 * reabrir la categoría (`isVisible` sobre el botón de módulo directamente).
 */
export async function openCategory(page: Page, categoryName: string): Promise<void> {
  const categoryBtn = page.getByRole('button', { name: categoryName, exact: true })
  if (await categoryBtn.isVisible().catch(() => false)) {
    await categoryBtn.click()
  }
}
