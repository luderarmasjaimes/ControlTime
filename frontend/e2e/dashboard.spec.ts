import { test, expect } from '@playwright/test'

test('Dashboard shows KPIs and Map occupies full area on Map tab', async ({ page }) => {
  await page.goto('http://localhost:4173/')

  // Ensure desktop viewport so tab labels are visible
  await page.setViewportSize({ width: 1280, height: 800 })

  // Dashboard by default
  await expect(page.getByText(/Producción \(kt\)/i)).toBeVisible()

  // Switch to Map and verify container occupies the main content area
  await page.getByText('Map', { exact: true }).click()
  // wait for the map overlay UI to appear
  await expect(page.getByText(/Visor Satelital/i)).toBeVisible({ timeout: 10000 })
  // measure main content area where map should render
  const mainContent = page.locator('main .flex-1').first()
  await expect(mainContent).toBeVisible({ timeout: 5000 })
  const box = await mainContent.boundingBox()
  expect(box.width).toBeGreaterThan(400)
  expect(box.height).toBeGreaterThan(300)
})
