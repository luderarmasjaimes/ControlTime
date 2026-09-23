#!/usr/bin/env node
/**
 * Prueba de carga real del WebSocket del mapa (`/ws`, map_aggregator.cpp +
 * ws_broadcast.cpp) -- mismo propósito y metodología que la prueba de 200
 * conexiones SSE de ADR-181 (docs/decisions/181-sse-kpis-pool-conexiones-en-vez-de-asio-strands.md),
 * pero para el canal `map_markers_diff` en vez de `/api/live/kpi`.
 *
 * Qué mide:
 *   1. Cuántas de N conexiones WS concurrentes logran conectar y quedar
 *      registradas (ver WsRegistry -- una conexión sin sesión válida se
 *      acepta pero nunca recibe push, así que esto también valida que el
 *      auth_token viaja bien en el handshake).
 *   2. Latencia de un endpoint de control (`GET /api/map/markers`) ANTES de
 *      abrir las N conexiones (baseline) vs. DURANTE que las N conexiones
 *      siguen abiertas -- si el modelo thread-per-connection (cada WS = 1
 *      hilo del SO bloqueado en io_context->run(), ver main.cpp) degrada al
 *      resto de la plataforma bajo carga, debe verse aquí.
 *   3. Errores de conexión/cierre inesperado durante la ventana de espera.
 *
 * Uso:
 *   node scripts/map-ws-load-test.js --token "$AUTH_TOKEN" [--api http://localhost:8080] [--concurrency 200] [--hold-seconds 30]
 *
 * El AUTH_TOKEN es el access token real de una sesión ya logueada (el mismo
 * valor que usarías en `Authorization: Bearer ...`). Este script NO hace
 * login por sí mismo -- correrlo requiere que el usuario obtenga el token
 * desde su propia sesión de navegador/terminal (mismo patrón que
 * sse-load-test.js en ADR-181: el login programático con contraseña no se
 * ejecuta desde una sesión de Claude Code bajo ninguna circunstancia).
 *
 * Sin dependencias -- usa el WebSocket y fetch globales de Node >= 22.
 */

const args = process.argv.slice(2);
function argVal(name, def) {
    const idx = args.indexOf(`--${name}`);
    if (idx === -1 || idx === args.length - 1) return def;
    return args[idx + 1];
}

const TOKEN = argVal('token', process.env.AUTH_TOKEN || '');
const API_BASE = (argVal('api', 'http://localhost:8080')).replace(/\/$/, '');
const WS_BASE = API_BASE.replace(/^http/, 'ws');
const CONCURRENCY = parseInt(argVal('concurrency', '200'), 10);
const HOLD_SECONDS = parseInt(argVal('hold-seconds', '30'), 10);
const CONTROL_PATH = '/api/map/markers';
const CONTROL_INTERVAL_MS = 2000;

if (!TOKEN) {
    console.error('Falta --token (o env AUTH_TOKEN). Ver comentario del script para cómo obtenerlo.');
    process.exit(1);
}

function nowMs() { return Number(process.hrtime.bigint() / 1000000n); }

async function measureControlLatency() {
    const t0 = nowMs();
    try {
        const res = await fetch(`${API_BASE}${CONTROL_PATH}?limit=50`, {
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
        const ms = nowMs() - t0;
        return { ok: res.ok, status: res.status, ms };
    } catch (err) {
        return { ok: false, status: 0, ms: nowMs() - t0, error: String(err) };
    }
}

function summarize(samples) {
    const ok = samples.filter((s) => s.ok);
    if (ok.length === 0) return { count: samples.length, ok: 0, avgMs: null, p95Ms: null, minMs: null, maxMs: null };
    const times = ok.map((s) => s.ms).sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
    return {
        count: samples.length, ok: ok.length,
        avgMs: Number(avg.toFixed(2)), p95Ms: p95,
        minMs: times[0], maxMs: times[times.length - 1],
    };
}

async function main() {
    console.log(`[map-ws-load-test] target=${WS_BASE}/ws concurrency=${CONCURRENCY} hold=${HOLD_SECONDS}s`);

    console.log('\n[1/4] Midiendo latencia baseline de control (sin carga WS)...');
    const baselineSamples = [];
    for (let i = 0; i < 10; i++) {
        baselineSamples.push(await measureControlLatency());
        await new Promise((r) => setTimeout(r, 200));
    }
    const baseline = summarize(baselineSamples);
    console.log('  baseline:', baseline);

    console.log(`\n[2/4] Abriendo ${CONCURRENCY} conexiones WS concurrentes...`);
    let connected = 0;
    let failed = 0;
    let closedEarly = 0;
    let diffMessages = 0;
    const sockets = [];
    const connectPromises = [];

    for (let i = 0; i < CONCURRENCY; i++) {
        const p = new Promise((resolve) => {
            let settled = false;
            const ws = new WebSocket(`${WS_BASE}/ws?auth_token=${encodeURIComponent(TOKEN)}`);
            const timer = setTimeout(() => {
                if (!settled) { settled = true; failed++; resolve(); }
            }, 10000);
            ws.addEventListener('open', () => {
                if (settled) return;
                settled = true; clearTimeout(timer); connected++; resolve();
            });
            ws.addEventListener('message', (ev) => {
                try {
                    const payload = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
                    if (payload?.channel === 'map_markers_diff') diffMessages++;
                } catch (_) { /* frame no-JSON, ignorar */ }
            });
            ws.addEventListener('error', () => {
                if (!settled) { settled = true; clearTimeout(timer); failed++; resolve(); }
            });
            ws.addEventListener('close', () => {
                if (settled && sockets.includes(ws)) closedEarly++;
            });
            sockets.push(ws);
        });
        connectPromises.push(p);
        // Escalonar un poco la apertura para no saturar el backlog TCP de golpe
        // (el objetivo es medir carga sostenida, no un thundering herd del
        // propio test).
        if (i % 20 === 0) await new Promise((r) => setTimeout(r, 15));
    }
    await Promise.all(connectPromises);
    console.log(`  conectadas=${connected} fallidas=${failed}`);

    console.log(`\n[3/4] Manteniendo conexiones ${HOLD_SECONDS}s, midiendo latencia de control bajo carga...`);
    const underLoadSamples = [];
    const endAt = Date.now() + HOLD_SECONDS * 1000;
    while (Date.now() < endAt) {
        underLoadSamples.push(await measureControlLatency());
        await new Promise((r) => setTimeout(r, CONTROL_INTERVAL_MS));
    }
    const underLoad = summarize(underLoadSamples);
    console.log('  bajo carga:', underLoad);
    console.log(`  diffs 'map_markers_diff' recibidos durante la ventana: ${diffMessages}`);

    console.log('\n[4/4] Cerrando conexiones...');
    sockets.forEach((ws) => { try { ws.close(); } catch (_) {} });
    await new Promise((r) => setTimeout(r, 500));

    console.log('\n========== RESULTADO ==========');
    console.log(`Conexiones:        ${connected}/${CONCURRENCY} OK, ${failed} fallidas, ${closedEarly} cerradas antes de tiempo`);
    console.log(`Baseline control:  avg=${baseline.avgMs}ms p95=${baseline.p95Ms}ms (${baseline.ok}/${baseline.count} OK)`);
    console.log(`Bajo carga:        avg=${underLoad.avgMs}ms p95=${underLoad.p95Ms}ms (${underLoad.ok}/${underLoad.count} OK)`);
    const degradedFactor = baseline.avgMs ? (underLoad.avgMs / baseline.avgMs) : null;
    if (degradedFactor != null) {
        console.log(`Factor de degradación: ${degradedFactor.toFixed(2)}x`);
    }
    const pass = connected === CONCURRENCY && failed === 0 && (degradedFactor == null || degradedFactor < 3);
    console.log(`Veredicto: ${pass ? 'PASS' : 'REVISAR'}`);
    console.log('================================\n');
    process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
