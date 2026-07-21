import { test, expect } from '@playwright/test'
import { dismissUserMaintenancePrompt, openCategory } from './helpers'

test('Dashboard shows KPIs and Map occupies full area on Map tab', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'mining_auth_session_v1',
      JSON.stringify({
        username: 'admin_e2e',
        fullName: 'E2E Admin',
        company: 'Minera Raura',
        role: 'admin',
        token: 'tok_e2e_admin',
      })
    )
  })
  await page.goto('/')
  await dismissUserMaintenancePrompt(page)

  // Ensure desktop viewport so tab labels are visible
  await page.setViewportSize({ width: 1280, height: 800 })

  // Dashboard by default
    await expect(page.getByText(/Prod\. Mensual/i)).toBeVisible()

  // Switch to Map tab and verify map viewer area is rendered
  await openCategory(page, 'Mapas')
  await page.getByRole('button', { name: 'Abrir Map', exact: true }).click()
  // "Unidad Minera Toquepala" ya no aparece en ningun lado de la app (contenido
  // desactualizado, verificado 2026-07-21) -- se reemplaza por el titulo real
  // y estable del visor de mapa (MapViewer.tsx, mapTitle por defecto).
  await expect(page.getByText(/Mapa Satelital Operacional/i)).toBeVisible({ timeout: 10000 })

  const mainContent = page.locator('.map-full').first()
  await expect(mainContent).toBeVisible({ timeout: 5000 })
  const box = await mainContent.boundingBox()
  expect(box.width).toBeGreaterThan(400)
  expect(box.height).toBeGreaterThan(300)
})
