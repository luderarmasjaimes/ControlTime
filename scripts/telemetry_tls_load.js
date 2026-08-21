#!/usr/bin/env node
"use strict";

const tls = require("tls");

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} debe ser un entero positivo`);
  }
  return value;
}

const cfg = {
  host: process.env.TARGET_HOST || "127.0.0.1",
  port: intEnv("TARGET_PORT", 8443),
  connections: intEnv("CONNECTIONS", 1000),
  rate: intEnv("RATE", 1000),
  durationSec: intEnv("DURATION_SEC", 10),
  sensorCount: intEnv("SENSOR_COUNT", 100000),
  sensorPrefix: process.env.SENSOR_PREFIX || "BENCH100K-",
  connectBatch: intEnv("CONNECT_BATCH", 100),
  connectIntervalMs: intEnv("CONNECT_INTERVAL_MS", 50),
  drainTimeoutMs: intEnv("DRAIN_TIMEOUT_MS", 10000),
};

const state = {
  connectAttempted: 0,
  connected: 0,
  connectErrors: 0,
  closed: 0,
  attempted: 0,
  written: 0,
  writeErrors: 0,
  backpressure: 0,
  ok: 0,
  err: 0,
  unexpected: 0,
  latencySamples: [],
};

const sockets = [];
let stopping = false;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function createConnection() {
  state.connectAttempted++;
  const socketState = { socket: null, buffer: "", pending: [], head: 0 };
  const socket = tls.connect({
    host: cfg.host,
    port: cfg.port,
    rejectUnauthorized: false,
    servername: "localhost",
  });
  socketState.socket = socket;

  socket.setNoDelay(true);
  socket.on("secureConnect", () => {
    state.connected++;
    sockets.push(socketState);
  });
  socket.on("data", (chunk) => {
    socketState.buffer += chunk.toString("utf8");
    for (;;) {
      const nl = socketState.buffer.indexOf("\n");
      if (nl < 0) break;
      const line = socketState.buffer.slice(0, nl).trim();
      socketState.buffer = socketState.buffer.slice(nl + 1);
      const started = socketState.pending[socketState.head++];
      if (started !== undefined && (state.ok + state.err) % 100 === 0) {
        state.latencySamples.push(Number(process.hrtime.bigint() - started) / 1e6);
      }
      if (line === "OK") state.ok++;
      else if (line === "ERR") state.err++;
      else state.unexpected++;
      if (socketState.head > 4096 && socketState.head * 2 > socketState.pending.length) {
        socketState.pending = socketState.pending.slice(socketState.head);
        socketState.head = 0;
      }
    }
  });
  socket.on("error", () => {
    if (!socket.authorized && !socket.encrypted) state.connectErrors++;
  });
  socket.on("close", () => { state.closed++; });
}

async function connectAll() {
  while (state.connectAttempted < cfg.connections) {
    const n = Math.min(cfg.connectBatch, cfg.connections - state.connectAttempted);
    for (let i = 0; i < n; i++) createConnection();
    await new Promise((resolve) => setTimeout(resolve, cfg.connectIntervalMs));
  }
  const deadline = Date.now() + 30000;
  while (state.connected + state.connectErrors < cfg.connections && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (state.connected === 0) throw new Error("No se pudo establecer ninguna conexión TLS");
}

function sendOne(sequence) {
  const target = sockets[sequence % sockets.length];
  if (!target || target.socket.destroyed || !target.socket.writable) {
    state.writeErrors++;
    return;
  }
  const sensorN = (sequence % cfg.sensorCount) + 1;
  const sensorCode = `${cfg.sensorPrefix}${String(sensorN).padStart(6, "0")}`;
  const value = (20 + (sensorN % 1000) / 100).toFixed(2);
  state.attempted++;
  target.pending.push(process.hrtime.bigint());
  if (!target.socket.write(`${sensorCode},${value},0\n`)) state.backpressure++;
  state.written++;
}

async function runLoad() {
  const total = cfg.rate * cfg.durationSec;
  const start = process.hrtime.bigint();
  let sent = 0;
  while (sent < total) {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const shouldHaveSent = Math.min(total, Math.floor(elapsedMs * cfg.rate / 1000));
    while (sent < shouldHaveSent) sendOne(sent++);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return Number(process.hrtime.bigint() - start) / 1e9;
}

async function waitForAcks() {
  const deadline = Date.now() + cfg.drainTimeoutMs;
  while (state.ok + state.err + state.unexpected < state.written && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function closeAll() {
  stopping = true;
  for (const target of sockets) target.socket.destroy();
}

async function main() {
  const wallStart = new Date().toISOString();
  await connectAll();
  const actualDurationSec = await runLoad();
  await waitForAcks();
  closeAll();

  const lat = state.latencySamples.sort((a, b) => a - b);
  const summary = {
    test: "telemetry_tls_load",
    startedAt: wallStart,
    config: cfg,
    actualDurationSec: Number(actualDurationSec.toFixed(3)),
    achievedWriteRate: Number((state.written / actualDurationSec).toFixed(1)),
    connections: {
      attempted: state.connectAttempted,
      established: state.connected,
      errors: state.connectErrors,
      closed: state.closed,
    },
    messages: {
      attempted: state.attempted,
      written: state.written,
      ok: state.ok,
      err: state.err,
      unexpected: state.unexpected,
      missingAck: state.written - state.ok - state.err - state.unexpected,
      writeErrors: state.writeErrors,
      backpressureSignals: state.backpressure,
    },
    ackLatencyMs: {
      samples: lat.length,
      p50: percentile(lat, 0.50),
      p95: percentile(lat, 0.95),
      p99: percentile(lat, 0.99),
      max: lat.length ? lat[lat.length - 1] : null,
    },
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (state.err || state.unexpected || summary.messages.missingAck || state.connectErrors) {
    process.exitCode = 2;
  }
}

process.on("SIGINT", () => {
  if (!stopping) closeAll();
  process.exitCode = 130;
});

main().catch((error) => {
  closeAll();
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
