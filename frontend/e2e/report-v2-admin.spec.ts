import { test, expect } from '@playwright/test'

function bootstrapSession() {
  localStorage.clear()
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

  localStorage.setItem(
    'mining_auth_users_v1',
    JSON.stringify([
      {
        username: 'admin_e2e',
        first_name: 'E2E',
        last_name: 'Admin',
        company: 'Minera Raura',
        role: 'admin',
        is_active: true,
      },
      {
        username: 'operador_e2e',
        first_name: 'Operador',
        last_name: 'Prueba',
        company: 'Minera Raura',
        role: 'operator',
        is_active: true,
      },
    ])
  )
}

test('Report v2 guarda informe y lo lista en Mis Informes', async ({ page }) => {
  await page.addInitScript(bootstrapSession)
  await page.goto('/')

  await page.setViewportSize({ width: 1400, height: 900 })
  await page.getByRole('button', { name: 'Abrir Report v2', exact: true }).click()

  page.once('dialog', async (dialog) => {
    await dialog.accept('Informe E2E Report V2')
  })

  await page.getByRole('button', { name: 'Guardar', exact: true }).click()

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const raw = localStorage.getItem('mining_reports_v1')
        if (!raw) return 0
        const rows = JSON.parse(raw)
        return Array.isArray(rows) ? rows.length : 0
      })
    })
    .toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Mis Informes', exact: true }).click()

  const dateInputs = page.locator('.ra-filters input[type="date"]')
  await dateInputs.nth(0).fill('2020-01-01')
  await dateInputs.nth(1).fill('2099-12-31')
  await page.getByRole('button', { name: 'Buscar', exact: true }).click()

  await expect(page.getByText(/Administraci.n de Informes T.cnicos/i)).toBeVisible()
  await expect(page.getByText('Informe E2E Report V2')).toBeVisible()
})

test('Report v2 abre visor de lectura desde administracion', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
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
    localStorage.setItem(
      'mining_auth_users_v1',
      JSON.stringify([
        {
          username: 'admin_e2e',
          first_name: 'E2E',
          last_name: 'Admin',
          company: 'Minera Raura',
          role: 'admin',
          is_active: true,
        },
        {
          username: 'operador_e2e',
          first_name: 'Operador',
          last_name: 'Prueba',
          company: 'Minera Raura',
          role: 'operator',
          is_active: true,
        },
      ])
    )
    localStorage.setItem(
      'mining_reports_v1',
      JSON.stringify([
        {
          id: 'rpt_e2e_001',
          title: 'Informe Seed E2E',
          projectName: 'Proyecto E2E',
          contentJson: JSON.stringify({
            document_id: 'doc_e2e_001',
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
          }),
          status: 'draft',
          createdBy: 'admin_e2e',
          createdByName: 'E2E Admin',
          reviewedBy: null,
          reviewedByName: null,
          reviewedAt: null,
          company: 'Minera Raura',
          createdAt: '2026-03-19T18:00:00.000Z',
          updatedAt: '2026-03-19T18:00:00.000Z',
          versionNumber: 1,
          deletedAt: null,
          shares: [],
        },
      ])
    )
  })

  await page.goto('/')
  await page.setViewportSize({ width: 1400, height: 900 })

  await page.getByRole('button', { name: 'Abrir Report v2', exact: true }).click()
  await page.getByRole('button', { name: 'Mis Informes', exact: true }).click()

  const dateInputs = page.locator('.ra-filters input[type="date"]')
  await dateInputs.nth(0).fill('2020-01-01')
  await dateInputs.nth(1).fill('2099-12-31')
  await page.getByRole('button', { name: 'Buscar', exact: true }).click()

  await page.getByText('Informe Seed E2E').click()
  await page.getByRole('button', { name: 'Leer', exact: true }).click()

  await expect(page.getByText(/MODO LECTURA/i)).toBeVisible()
  await expect(page.locator('.ro-title').filter({ hasText: 'Informe Seed E2E' })).toBeVisible()

  await page.locator('.ro-btn-close').click({ force: true })
  await expect(page.getByText(/MODO LECTURA/i)).not.toBeVisible()
})
