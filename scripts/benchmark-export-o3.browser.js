// Benchmark real del criterio O3 (SPEC-007 T15): "export PDF/Word < 5 s para
// un informe de 50 páginas". Ver docs/decisions/183-*.md para la medición
// registrada y el diagnóstico completo.
//
// CÓMO CORRERLO: iniciar sesión normal en la app (cualquier rol con
// `informes.view` alcanza -- generar/descargar un export NO requiere
// `informes.edit`, ver ADR-016/080/182), abrir DevTools > Console en esa
// pestaña, y pegar este script completo. Usa la sesión ya autenticada del
// navegador (cookie `beemetry_access_token` + CSRF double-submit) -- nunca
// pide ni maneja una contraseña ni un token en texto plano.
//
// Por qué no es un script de Node/CI: el pipeline de export real (sidecar
// Puppeteer) exige un `report_id` real de un tenant real y una sesión
// autenticada -- no hay forma de generar eso sin credenciales de verdad, así
// que este benchmark es "on-demand contra un stack corriendo", igual que
// scripts/sse-load-test.js (ver docs/decisions/181-*.md).
//
// Uso: benchmarkExportO3('<report_id>', { pageCountHint: 50 })
// Elegir un informe real con ~50 páginas (ni un caso trivial de 1-2 páginas
// ni un catálogo de stress-test con docenas de gráficos por página) --
// GET /api/reports?limit=50 + inspeccionar `content_json.pages.length` de
// cada uno para encontrar un candidato representativo.

async function benchmarkExportO3(reportId, { pageCountHint = null, format = 'pdf', thresholdMs = 5000 } = {}) {
  function readCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  const csrf = readCookie('beemetry_csrf_token');

  const detRes = await fetch(`/api/reports/${reportId}`, { credentials: 'same-origin' });
  if (!detRes.ok) throw new Error(`No se pudo leer el informe ${reportId}: HTTP ${detRes.status}`);
  const det = await detRes.json();
  let cj = det.content_json;
  if (typeof cj === 'string') cj = JSON.parse(cj);
  const realPageCount = cj?.pages?.length ?? null;

  console.log(`[O3] Informe "${det.title}" — ${realPageCount} páginas reales` +
    (pageCountHint ? ` (objetivo de referencia: ${pageCountHint})` : ''));

  const postRes = await fetch(`/api/reports/${reportId}/export/${format}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: '{}',
  });
  if (postRes.status !== 202) {
    throw new Error(`No se pudo encolar el export: HTTP ${postRes.status} — ${await postRes.text()}`);
  }
  const { job_id: jobId } = await postRes.json();
  console.log(`[O3] Job ${jobId} encolado, polleando...`);

  const deadlineMs = Date.now() + 15 * 60 * 1000; // 15 min tope de seguridad
  let last = null;
  while (Date.now() < deadlineMs) {
    const r = await fetch(`/api/reports/${reportId}/export/jobs/${jobId}`, { credentials: 'same-origin' });
    last = await r.json();
    if (last.status === 'success' || last.status === 'failed') break;
    await new Promise((res) => setTimeout(res, 200));
  }
  if (!last || (last.status !== 'success' && last.status !== 'failed')) {
    throw new Error('Timeout esperando el job de export (15 min) — algo está genuinamente colgado.');
  }
  if (last.status === 'failed') {
    throw new Error(`Export falló: ${last.error_message || '(sin mensaje)'}`);
  }

  // `created_at`/`completed_at` vienen del RELOJ DEL SERVIDOR (Postgres) --
  // más confiable que medir tiempo de cliente (evita incluir latencia de red
  // del polling o el propio delay entre encolar y empezar a pollear).
  const startMs = Date.parse(last.started_at.replace(' ', 'T'));
  const endMs = Date.parse(last.completed_at.replace(' ', 'T'));
  const elapsedMs = endMs - startMs;
  const pass = elapsedMs < thresholdMs;

  console.log(`[O3] Completado en ${(elapsedMs / 1000).toFixed(2)}s ` +
    `(umbral: ${(thresholdMs / 1000).toFixed(1)}s) — ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  if (realPageCount) {
    console.log(`[O3] Tasa: ${(elapsedMs / realPageCount).toFixed(0)} ms/página`);
  }

  return { reportId, jobId, realPageCount, elapsedMs, thresholdMs, pass };
}

// Ejemplo de uso (reemplazar por un report_id real del tenant activo):
// await benchmarkExportO3('16ec20be-ddd7-4abf-8ffc-885a89bc198c', { pageCountHint: 50 });
