import { test, expect } from '@playwright/test'
import { dismissUserMaintenancePrompt, openCategory } from './helpers'

test('Editor carga y muestra el encabezado del informe', async ({ page }) => {
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
  await openCategory(page, 'Reportes')
  await page.getByRole('button', { name: 'Abrir Report', exact: true }).click()
  await expect(page.getByText(/Informe Geomecánico/i)).toBeVisible()
})
