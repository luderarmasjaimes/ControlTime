import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const OUTPUT_DIR = path.resolve(process.cwd(), 'demo-videos');
const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:5173';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function setCaption(page, text) {
  await page.evaluate((caption) => {
    let el = document.getElementById('demo-caption-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-caption-overlay';
      el.style.position = 'fixed';
      el.style.left = '50%';
      el.style.bottom = '28px';
      el.style.transform = 'translateX(-50%)';
      el.style.maxWidth = '78vw';
      el.style.padding = '14px 18px';
      el.style.borderRadius = '10px';
      el.style.background = 'rgba(15,23,42,0.78)';
      el.style.color = '#f8fafc';
      el.style.fontFamily = 'Segoe UI, Arial, sans-serif';
      el.style.fontSize = '26px';
      el.style.fontWeight = '600';
      el.style.lineHeight = '1.25';
      el.style.zIndex = '2147483647';
      el.style.textAlign = 'center';
      el.style.boxShadow = '0 8px 28px rgba(0,0,0,0.45)';
      document.body.appendChild(el);
    }
    el.textContent = caption;
  }, text);
}

async function clickIfVisible(page, role, nameRegex) {
  try {
    const locator = page.getByRole(role, { name: nameRegex }).first();
    if (await locator.isVisible({ timeout: 1200 })) {
      await locator.click({ timeout: 2000 });
      return true;
    }
  } catch {}
  return false;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function openTab(page, tabName) {
  const strict = new RegExp(`^Abrir\\s+${escapeRegExp(tabName)}$`, 'i');
  if (await clickIfVisible(page, 'button', strict)) {
    return true;
  }
  const flexible = new RegExp(`Abrir\\s+${escapeRegExp(tabName)}`, 'i');
  return clickIfVisible(page, 'button', flexible);
}

async function safeAction(fn) {
  try {
    await fn();
  } catch {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSegment(page, caption, durationMs, action) {
  const segmentStart = Date.now();
  console.log(`[segment] ${caption} (${Math.round(durationMs / 1000)}s)`);
  await setCaption(page, caption);
  if (action) {
    await safeAction(action);
  }
  const elapsed = Date.now() - segmentStart;
  const remaining = durationMs - elapsed;
  if (remaining > 0) {
    await sleep(remaining);
  }
}

function findNewestVideoFile(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.webm'))
    .map((name) => ({ name, fullPath: path.join(dir, name), mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? files[0].fullPath : null;
}

function convertToMp4IfPossible(inputWebm, outMp4) {
  const check = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (check.status !== 0) {
    return { converted: false, reason: 'ffmpeg no disponible en PATH' };
  }

  const result = spawnSync(
    'ffmpeg',
    ['-y', '-i', inputWebm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', outMp4],
    { stdio: 'inherit' }
  );

  if (result.status === 0) {
    return { converted: true };
  }
  return { converted: false, reason: 'fallo la conversion con ffmpeg' };
}

async function main() {
  ensureDir(OUTPUT_DIR);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-web-security'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: OUTPUT_DIR,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    localStorage.setItem(
      'mining_auth_session_v1',
      JSON.stringify({
        username: 'bastian_admin',
        fullName: 'Bastian Admin',
        company: 'BEEMETRY',
        role: 'admin',
        token: 'tok_demo_bastian',
        loginType: 'company',
      })
    );
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  await safeAction(async () => {
    if (await clickIfVisible(page, 'button', /Ahora no/i)) {
      await sleep(1200);
    }
    await clickIfVisible(page, 'button', /Cancelar/i);
    await clickIfVisible(page, 'button', /Cerrar/i);
  });

  const startAt = Date.now();
  console.log(`[start] Grabacion iniciada en ${new Date(startAt).toISOString()}`);

  await runSegment(page, 'Plataforma Biometrica + Sistema de Informes Tecnicos Mineros con IA', 20000);
  await runSegment(page, 'Recorrido completo opcion por opcion de la aplicacion web', 20000);

  await runSegment(page, 'Opciones globales: exportar captura para reporte.', 15000, async () => {
    await clickIfVisible(page, 'button', /Exportar captura para reporte/i);
    await sleep(2500);
    await clickIfVisible(page, 'button', /Cerrar|Cancelar|Ahora no/i);
  });

  await runSegment(page, 'Opciones globales: menu rapido de acciones.', 15000, async () => {
    await clickIfVisible(page, 'button', /Opciones rapidas/i);
    await sleep(3000);
    await clickIfVisible(page, 'button', /Opciones rapidas/i);
  });

  await runSegment(page, 'Accesos de administracion: auditoria y mantenimiento de usuarios.', 20000, async () => {
    await clickIfVisible(page, 'button', /Abrir auditoria/i);
    await sleep(3000);
    await clickIfVisible(page, 'button', /Cerrar|Cancelar|Ahora no/i);
    await clickIfVisible(page, 'button', /^Usuarios$/i);
    await sleep(3500);
    await clickIfVisible(page, 'button', /Cerrar|Cancelar|Ahora no/i);
  });

  const tabFlow = [
    { name: 'Dashboard', caption: 'Dashboard: vista ejecutiva y estado general de operacion.', durationMs: 20000 },
    { name: 'Sensores Técnicos', caption: 'Sensores Tecnicos: telemetria e indicadores por tipo de sensor.', durationMs: 18000 },
    { name: 'Inclinometer', caption: 'Inclinometro: comportamiento geomecanico y estabilidad del terreno.', durationMs: 18000 },
    { name: 'Displacement Cumulative', caption: 'Desplazamiento acumulado: seguimiento de deformacion historica.', durationMs: 18000 },
    { name: '3D', caption: 'Escena 3D: visualizacion espacial para analisis tecnico.', durationMs: 16000 },
    { name: 'Map', caption: 'Mapa base: navegacion geografica de contexto operacional.', durationMs: 16000 },
    { name: 'Mapa Detallado', caption: 'Mapa detallado: capas y revision precisa de zonas criticas.', durationMs: 20000 },
    { name: 'Surveillance', caption: 'Vigilancia: panel visual de seguimiento operativo.', durationMs: 16000 },
    {
      name: 'Report',
      caption: 'Reporte clasico: redaccion rapida con guardado de cambios.',
      durationMs: 20000,
      action: async () => {
        await clickIfVisible(page, 'button', /Guardar Cambios/i);
      },
    },
    { name: 'Report v2', caption: 'Informe Minero v2: editor multipagina con bloques avanzados.', durationMs: 18000 },
  ];

  for (const step of tabFlow) {
    await runSegment(page, step.caption, step.durationMs, async () => {
      await openTab(page, step.name);
      if (step.action) {
        await step.action();
      }
    });
  }

  await runSegment(page, 'Biblioteca de bloques: insercion y edicion de Texto.', 25000, async () => {
    await openTab(page, 'Report v2');
    await clickIfVisible(page, 'button', /^Texto$/i);
    await page.mouse.dblclick(540, 300);
    const area = page.locator('textarea').first();
    if (await area.isVisible({ timeout: 2500 })) {
      await area.fill('Informe tecnico minero: se identifican variaciones geomecanicas controladas y se recomiendan acciones preventivas de sostenimiento.');
    }
  });

  await runSegment(page, 'Asistencia IA: correccion ortografica y mejora de redaccion del contenido tecnico.', 30000, async () => {
    await clickIfVisible(page, 'button', /Corregir Ortograf/i);
    await sleep(2000);
    await clickIfVisible(page, 'button', /Mejorar Redacci/i);
  });

  await runSegment(page, 'Evidencia cartografica: captura de MAPA, previsualizacion e insercion en el informe.', 40000, async () => {
    await clickIfVisible(page, 'button', /^MAPA$/i);
    await sleep(5000);
    await clickIfVisible(page, 'button', /Capturar Mapa/i);
    await sleep(6000);
    await clickIfVisible(page, 'button', /INSERTAR/i);
  });

  await runSegment(page, 'Gestion documental: guardar informe y abrir administracion de reportes.', 30000, async () => {
    await clickIfVisible(page, 'button', /Guardar/i);
    await sleep(2000);
    await clickIfVisible(page, 'button', /Administraci[oó]n|Informes|Reportes/i);
    await sleep(4000);
    await clickIfVisible(page, 'button', /Cerrar|Cancelar|Ahora no/i);
  });

  await runSegment(page, 'Cierre tecnico: validacion final y continuidad de operacion.', 10000, async () => {
    await clickIfVisible(page, 'button', /Guardar/i);
  });

  const elapsed = Date.now() - startAt;
  const remaining = 420000 - elapsed;
  if (remaining > 0) {
    await runSegment(page, 'Demostracion completada: recorrido integral de la plataforma.', remaining);
  }

  const elapsedMs = Date.now() - startAt;
  console.log(`[done] Tiempo total de sesion: ${Math.round(elapsedMs / 1000)}s`);

  await context.close();
  await browser.close();

  const newestVideo = findNewestVideoFile(OUTPUT_DIR);
  if (!newestVideo) {
    throw new Error('No se encontro video .webm generado por Playwright.');
  }

  const mp4Path = path.join(OUTPUT_DIR, 'demo-plataforma-7min.mp4');
  const conversion = convertToMp4IfPossible(newestVideo, mp4Path);

  console.log('--- RESULTADO ---');
  console.log(`WEBM generado: ${newestVideo}`);
  if (conversion.converted) {
    console.log(`MP4 generado: ${mp4Path}`);
  } else {
    console.log(`MP4 no generado: ${conversion.reason}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
