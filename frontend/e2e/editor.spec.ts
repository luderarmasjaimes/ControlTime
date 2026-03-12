import { test, expect } from '@playwright/test'

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
  await page.getByRole('button', { name: 'Report' }).click()
  await expect(page.getByText(/Informe Geomecánico/i)).toBeVisible()
})
