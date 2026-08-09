import { test, expect, type Page } from '@playwright/test';
import { openCategory } from './helpers';

test.use({ serviceWorkers: 'block' });

const SESSION = {
  userId: 'map-e2e', username: 'map_e2e', fullName: 'Map QA', company: 'Alpayana',
  tenantId: '11111111-1111-1111-1111-111111111111', role: 'operator', loginType: 'user',
  token: '', loggedAt: new Date().toISOString(),
};

async function tileCoverage(page: Page): Promise<number> {
  return page.locator('.leaflet-container').evaluate((container) => {
    const viewport = container.getBoundingClientRect();
    const tiles = Array.from(container.querySelectorAll<HTMLImageElement>('.leaflet-tile-loaded'))
      .map((tile) => tile.getBoundingClientRect())
      .filter((rect) => rect.width > 1 && rect.height > 1);
    let total = 0;
    let covered = 0;
    for (let y = viewport.top + 16; y < viewport.bottom; y += 32) {
      for (let x = viewport.left + 16; x < viewport.right; x += 32) {
        total += 1;
        if (tiles.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) {
          covered += 1;
        }
      }
    }
    return total ? covered / total : 0;
  });
}

async function expectPainted(page: Page, timeout = 2000) {
  await expect.poll(() => tileCoverage(page), { timeout, intervals: [50, 100, 200] }).toBeGreaterThan(0.97);
}

test('mapa repinta sin huecos al redimensionar, mover y hacer zoom', async ({ page }) => {
  await page.addInitScript((session) => {
    localStorage.clear();
    localStorage.setItem('mining_auth_session_v1', JSON.stringify(session));
  }, SESSION);

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/map/markers') return route.fulfill({ json: { markers: [] } });
    if (path === '/api/map/official-zones') {
      return route.fulfill({ json: { type: 'FeatureCollection', features: [] } });
    }
    if (path === '/api/map/compliance-intersections') return route.fulfill({ json: { intersections: [] } });
    return route.fulfill({ json: {} });
  });

  let tileRequests = 0;
  await page.route(/^https:\/\/mt[0-3]\.google\.com\/vt\//, async (route) => {
    tileRequests += 1;
    // Latencia moderada y variable para simular la conexión minera sin hacer
    // el test dependiente de Internet ni del estado puntual de Google.
    await new Promise((resolve) => setTimeout(resolve, 35 + (tileRequests % 5) * 25));
    const label = new URL(route.request().url()).searchParams;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
      <rect width="256" height="256" fill="#315f47"/><path d="M0 128h256M128 0v256" stroke="#75a88a"/>
      <text x="8" y="20" fill="white" font-size="12">${label.get('z')}/${label.get('x')}/${label.get('y')}</text>
    </svg>`;
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
  });

  await page.setViewportSize({ width: 1500, height: 850 });
  await page.goto('/');
  await openCategory(page, 'Mapas');
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expectPainted(page);

  // Cambio de tamaño solo del contenedor: no dispara window.resize. Esta es
  // la regresión exacta de las capturas (host flex crece, mapa queda pequeño).
  const host = page.locator('.map-full');
  await host.evaluate((element: HTMLElement) => { element.style.maxWidth = '680px'; });
  await expectPainted(page);
  await host.evaluate((element: HTMLElement) => { element.style.maxWidth = 'none'; });
  await expectPainted(page);

  const map = page.locator('.leaflet-container');
  const box = await map.boundingBox();
  if (!box) throw new Error('Mapa sin dimensiones');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -650);
  await expectPainted(page);

  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await expectPainted(page);

  expect(tileRequests).toBeGreaterThan(20);
});

test('proveedor satelital real completa el viewport después de zoom y paneo', async ({ page }, testInfo) => {
  test.skip(process.env.MAP_E2E_REAL_TILES !== '1', 'Prueba de red explícita; no se ejecuta en CI offline');
  await page.addInitScript((session) => {
    localStorage.clear();
    localStorage.setItem('mining_auth_session_v1', JSON.stringify(session));
  }, SESSION);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/map/markers') return route.fulfill({ json: { markers: [] } });
    if (path === '/api/map/official-zones') return route.fulfill({ json: { type: 'FeatureCollection', features: [] } });
    if (path === '/api/map/compliance-intersections') return route.fulfill({ json: { intersections: [] } });
    return route.fulfill({ json: {} });
  });

  const tileFailures: string[] = [];
  const tileResponses: Array<{ host: string; status: number }> = [];
  page.on('requestfailed', (request) => {
    if (/\/\/mt[0-3]\.google\.com\/vt\//.test(request.url())) tileFailures.push(request.url());
  });
  page.on('response', (response) => {
    if (/\/\/mt[0-3]\.google\.com\/vt\//.test(response.url())) {
      tileResponses.push({ host: new URL(response.url()).host, status: response.status() });
    }
  });

  await page.setViewportSize({ width: 1500, height: 850 });
  await page.goto('/');
  const started = Date.now();
  await openCategory(page, 'Mapas');
  await expectPainted(page, 12000);
  const initialPaintMs = Date.now() - started;

  const map = page.locator('.leaflet-container');
  const box = await map.boundingBox();
  if (!box) throw new Error('Mapa sin dimensiones');
  const actionStarted = Date.now();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -500);
  await expectPainted(page, 12000);
  const zoomPaintMs = Date.now() - actionStarted;

  const panStarted = Date.now();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await expectPainted(page, 12000);
  const panPaintMs = Date.now() - panStarted;

  await testInfo.attach('tile-network-metrics.json', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ initialPaintMs, zoomPaintMs, panPaintMs, tileFailures: tileFailures.length, tileResponses }, null, 2)),
  });
  console.info(`[map-real-metrics] ${JSON.stringify({ initialPaintMs, zoomPaintMs, panPaintMs, tileFailures: tileFailures.length, tileResponses: tileResponses.length })}`);
  expect(tileResponses.length).toBeGreaterThan(15);
  expect(tileResponses.every((response) => response.status === 200)).toBe(true);
  expect(tileFailures).toHaveLength(0);
});
