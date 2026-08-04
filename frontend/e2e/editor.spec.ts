import { test, expect } from '@playwright/test'
import { dismissUserMaintenancePrompt, openCategory, realLogin } from './helpers'

const REAL_CREDS = { company: 'Alpayana', username: 'larmas', password: '123456' }

test('Editor carga y muestra el encabezado del informe', async ({ page }) => {
  await realLogin(page, REAL_CREDS)
  await page.goto('/')
  await dismissUserMaintenancePrompt(page)
  await openCategory(page, 'Informes')
  await page.getByRole('button', { name: 'Abrir Reporte', exact: true }).click()
  await expect(page.getByText(/Informe Geomecánico/i)).toBeVisible()
})
