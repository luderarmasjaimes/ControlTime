import { test, expect } from '@playwright/test'

test('Navegar a Report y pulsar Guardar Cambios', async ({ page }) => {
  await page.goto('http://localhost:4173/')
  await page.getByText('Report').click()
  const saveBtn = page.getByRole('button', { name: /Guardar Cambios/i })
  await expect(saveBtn).toBeVisible()
  await saveBtn.click()
  // No hay acción de guardado implementada; solo verificamos que el click no falle
  await expect(saveBtn).toBeEnabled()
})
