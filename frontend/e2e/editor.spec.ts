import { test, expect } from '@playwright/test'

test('Editor carga y muestra el encabezado del informe', async ({ page }) => {
  await page.goto('http://localhost:4173/')
  await page.getByText('Report').click()
  await expect(page.locator('text=Informe Geomecánico')).toBeVisible()
})
