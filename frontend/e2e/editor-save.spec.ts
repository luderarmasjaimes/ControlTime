import { test, expect } from '@playwright/test'

test('Navegar a Report y pulsar Guardar Cambios', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Abrir Report', exact: true }).click()
  const saveBtn = page.getByRole('button', { name: /Guardar Cambios/i })
  await expect(saveBtn).toBeVisible()
  await saveBtn.click()
  // No hay acción de guardado implementada; solo verificamos que el click no falle
  await expect(saveBtn).toBeEnabled()
})
