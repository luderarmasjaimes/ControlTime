import { test, expect } from '@playwright/test'
import { dismissUserMaintenancePrompt, openCategory, openMisInformes, realLogin } from './helpers'

// Cuenta real pre-existente (no fake token): larmas / Alpayana / 123456.
const REAL_CREDS = { company: 'Alpayana', username: 'larmas', password: '123456' }

test('Report v2 guarda informe y lo lista en Mis Informes', async ({ page }) => {
  await realLogin(page, REAL_CREDS)
  await page.goto('/')
  await dismissUserMaintenancePrompt(page)

  await page.setViewportSize({ width: 1400, height: 900 })
  await openCategory(page, 'Informes')
  await page.getByRole('button', { name: 'Abrir Informes', exact: true }).click()

  // Titulo unico por corrida para no chocar con informes de corridas previas
  // (el backend real persiste entre ejecuciones, a diferencia del
  // localStorage fake de antes).
  const reportTitle = `Informe E2E Report V2 ${Date.now()}`
  // Con login real, "Guardar" persiste vía POST /api/reports (backend real,
  // ver reportsStorage.ts/api.ts) -- ya no escribe en localStorage
  // ('mining_reports_v1' era solo el mirror del flujo offline/fake-token
  // anterior). Se espera la respuesta real de creación en vez de sondear esa
  // clave, que con un guardado online nunca se vuelve a poblar.
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  const saveModal = page.locator('.ra-sub-modal')
  await expect(saveModal.getByText(/Nombrar informe nuevo/i)).toBeVisible()
  await saveModal.getByPlaceholder(/Informe Técnico Integral/i).fill(reportTitle)

  const [createResponse] = await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/reports') && res.request().method() === 'POST'),
    saveModal.getByRole('button', { name: 'Guardar', exact: true }).click(),
  ])
  expect(createResponse.ok()).toBeTruthy()

  await openMisInformes(page)

  const dateInputs = page.locator('.ra-filters input[type="date"]')
  await dateInputs.nth(0).fill('2020-01-01')
  await dateInputs.nth(1).fill('2099-12-31')
  await page.getByRole('button', { name: 'Buscar', exact: true }).click()

  await expect(page.getByText(/Administraci.n de Informes T.cnicos/i)).toBeVisible()
  await expect(page.getByText(reportTitle)).toBeVisible()
})

test('Report v2 abre visor de lectura desde administracion', async ({ page }) => {
  const loginResult = await realLogin(page, REAL_CREDS)

  // El visor read-only lista informes reales del backend (fetchReports),
  // no un mirror en localStorage -- se siembra el informe semilla via API
  // real (mismo token de la sesion) antes de navegar, en vez de escribir
  // 'mining_reports_v1' (ese key ya no lo lee nada en el flujo online).
  const seedTitle = `Informe Seed E2E ${Date.now()}`
  const seedContentJson = JSON.stringify({
    document_id: 'doc_e2e_seed',
    pages: [
      {
        page_number: 1,
        elements: [
          {
            id: 'txt_1',
            type: 'text',
            x: 80,
            y: 120,
            width: 320,
            height: 100,
            zIndex: 1,
            props: {
              text: 'Texto de prueba para visor read-only E2E.',
              fontFamily: 'Arial',
              fontSize: 16,
              fontColor: '#0f172a',
              textAlign: 'left',
              lineHeight: 1.35,
            },
          },
        ],
      },
    ],
    meta: { author: 'E2E', version: 1 },
  })

  const seedResponse = await page.request.post(`${loginResult.backendUrl}/api/reports`, {
    headers: { Authorization: `Bearer ${loginResult.token}` },
    data: { title: seedTitle, project_id: null, content_json: seedContentJson, status: 'draft' },
  })
  expect(seedResponse.ok()).toBeTruthy()

  await page.goto('/')
  await dismissUserMaintenancePrompt(page)
  await page.setViewportSize({ width: 1400, height: 900 })

  await openCategory(page, 'Informes')
  await page.getByRole('button', { name: 'Abrir Informes', exact: true }).click()
  await openMisInformes(page)

  const dateInputs = page.locator('.ra-filters input[type="date"]')
  await dateInputs.nth(0).fill('2020-01-01')
  await dateInputs.nth(1).fill('2099-12-31')
  await page.getByRole('button', { name: 'Buscar', exact: true }).click()

  await page.getByText(seedTitle).click()
  await page.getByRole('button', { name: 'Leer', exact: true }).click()

  await expect(page.getByText(/MODO LECTURA/i)).toBeVisible()
  await expect(page.locator('.ro-title').filter({ hasText: seedTitle })).toBeVisible()

  await page.locator('.ro-btn-close').click({ force: true })
  await expect(page.getByText(/MODO LECTURA/i)).not.toBeVisible()
})
