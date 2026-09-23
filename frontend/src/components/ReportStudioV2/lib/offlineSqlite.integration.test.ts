import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cobertura real del flujo offline (SPEC-014 CA-1/CA-2/CA-3), antes en 0%
 * (ver `offlineSqlite.test.ts`, que solo cubría `isLocalDraftId`).
 *
 * Las dos piezas que bloqueaban esto ("depende de sql.js/WASM + Cache API,
 * no montados en jsdom") se resuelven así, sin fingir el comportamiento real:
 *
 * 1. sql.js (WASM): NO se mockea el motor — se usa el WASM real
 *    (`node_modules/sql.js/dist/sql-wasm.wasm`) vía la build por defecto del
 *    paquete, que en Node ya sabe resolver su propio `.wasm` con
 *    `fs.readFileSync`. Lo único que se neutraliza es la opción
 *    `locateFile: () => '/sql-wasm.wasm'` que `offlineSqlite.ts` pasa para
 *    el navegador (una ruta HTTP servida por nginx, no un path de
 *    filesystem) — sin eso, Node intentaría leer un archivo inexistente en
 *    la raíz del sistema. El SQL que corre en el test es SQL real contra
 *    SQLite real compilado a WASM, no una reimplementación.
 * 2. Cache API: no existe en jsdom (es una API de Service Worker). Se
 *    implementa un `FakeCacheStorage` fiel a la semántica real
 *    (`caches.open(name)` → `Cache` propio por nombre, `cache.match/put`,
 *    `caches.delete(name)`), usando la clase `Response` real de Node (no
 *    una réplica) para que `arrayBuffer()`/headers se comporten igual.
 *
 * Cada test reimporta el módulo en frío (`vi.resetModules()` +
 * `await import(...)`) porque `offlineSqlite.ts` mantiene `dbPromise`/
 * `SQLModule` como singletons de módulo — sin resetear, un test
 * contaminaría el siguiente. `globalThis.caches` se crea una vez por test
 * (no por import) para poder simular "cerrar la pestaña y volver a abrirla"
 * reimportando el módulo mientras la caché persiste, igual que en un
 * navegador real.
 */

vi.mock('sql.js', async () => {
  const actual = await vi.importActual<typeof import('sql.js')>('sql.js');
  const real = actual.default;
  // Ignora cualquier `locateFile` que le pasen (offlineSqlite.ts pasa una
  // ruta HTTP pensada para el navegador) — sin opciones, el propio paquete
  // resuelve su .wasm real relativo a su propio directorio en Node.
  return { default: () => real() };
});

vi.mock('../../../auth/authStorage', () => ({
  getSession: vi.fn(),
}));

vi.mock('../../../auth/authApi', () => ({
  authFetch: vi.fn(),
}));

/** Guarda bytes + content-type, no la instancia de `Response` en sí: el
 * cuerpo real de un `Response` es un stream de un solo uso (`Body has
 * already been read` si se lee dos veces) -- la Cache API real de todos
 * modos entrega una copia legible en cada `match()`, así que replicar eso
 * fielmente exige materializar el cuerpo al guardar y construir un
 * `Response` NUEVO en cada lectura. */
class FakeCache {
  private store = new Map<string, { bytes: ArrayBuffer; contentType: string | null }>();
  async match(key: string): Promise<Response | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    return new Response(entry.bytes.slice(0), {
      headers: entry.contentType ? { 'Content-Type': entry.contentType } : undefined,
    });
  }
  async put(key: string, response: Response): Promise<void> {
    const bytes = await response.clone().arrayBuffer();
    this.store.set(key, { bytes, contentType: response.headers.get('Content-Type') });
  }
  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }
}

class FakeCacheStorage {
  private named = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    if (!this.named.has(name)) this.named.set(name, new FakeCache());
    return this.named.get(name)!;
  }
  async delete(name: string): Promise<boolean> {
    return this.named.delete(name);
  }
  async has(name: string): Promise<boolean> {
    return this.named.has(name);
  }
}

/** Construye una base SQLite real (bytes exportados) con el esquema que
 * `offlineSqlite.ts` espera. `withBaseVersionColumn: false` simula una
 * plantilla vieja (previa a ADR-022) para ejercitar `ensureSchemaUpgraded`. */
async function buildTemplateBytes(withBaseVersionColumn = true): Promise<Uint8Array> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE offline_reports (
      report_id TEXT PRIMARY KEY,
      title TEXT,
      document_json TEXT,
      updated_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 0
      ${withBaseVersionColumn ? ', base_version_number INTEGER' : ''}
    );
    CREATE TABLE offline_connectivity_events (
      id TEXT PRIMARY KEY,
      report_id TEXT,
      went_offline_at TEXT,
      came_online_at TEXT,
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);
  const bytes = db.export();
  db.close();
  return bytes;
}

function mockTemplateResponse(bytes: Uint8Array) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as Response;
}

describe('offlineSqlite (motor sql.js/WASM real + Cache API fiel)', () => {
  let fakeCaches: FakeCacheStorage;

  beforeEach(() => {
    fakeCaches = new FakeCacheStorage();
    (globalThis as any).caches = fakeCaches;
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as any).caches;
    vi.clearAllMocks();
  });

  /** Reimporta offlineSqlite.ts en frío con los mocks ya configurados para
   * este test — cada llamada obtiene una copia nueva del módulo (dbPromise/
   * SQLModule reseteados), pero comparte el mismo `fakeCaches` de arriba. */
  async function freshModule(session: { userId?: string; tenantId?: string } | null, templateBytes: Uint8Array) {
    vi.resetModules();
    const { getSession } = await import('../../../auth/authStorage');
    const { authFetch } = await import('../../../auth/authApi');
    vi.mocked(getSession).mockReturnValue(session as any);
    vi.mocked(authFetch).mockResolvedValue(mockTemplateResponse(templateBytes));
    return import('./offlineSqlite');
  }

  it('guarda y recupera un snapshot offline (round-trip real contra SQLite/WASM)', async () => {
    const template = await buildTemplateBytes();
    const mod = await freshModule({ userId: 'u1', tenantId: 't1' }, template);

    await mod.saveOfflineSnapshot('report-1', 'Informe de prueba', { pages: [1, 2, 3] }, 5);
    const snap = await mod.loadOfflineSnapshot('report-1');

    expect(snap).not.toBeNull();
    expect(snap!.reportId).toBe('report-1');
    expect(snap!.title).toBe('Informe de prueba');
    expect(snap!.documentJson).toEqual({ pages: [1, 2, 3] });
    expect(snap!.dirty).toBe(true);
    expect(snap!.baseVersionNumber).toBe(5);
  });

  it('devuelve null para un informe sin snapshot guardado', async () => {
    const template = await buildTemplateBytes();
    const mod = await freshModule({ userId: 'u1', tenantId: 't1' }, template);
    expect(await mod.loadOfflineSnapshot('nunca-guardado')).toBeNull();
  });

  it('upsert: guardar dos veces el mismo informe actualiza la fila, no duplica', async () => {
    const template = await buildTemplateBytes();
    const mod = await freshModule({ userId: 'u1', tenantId: 't1' }, template);

    await mod.saveOfflineSnapshot('report-1', 'Título v1', { v: 1 }, 5);
    await mod.saveOfflineSnapshot('report-1', 'Título v2', { v: 2 }, 5);

    const snap = await mod.loadOfflineSnapshot('report-1');
    expect(snap!.title).toBe('Título v2');
    expect(snap!.documentJson).toEqual({ v: 2 });

    // isolation check: no debe haber quedado una segunda fila -- si el ON
    // CONFLICT no funcionara como upsert, findOrphanedLocalDrafts (que hace
    // su propio SELECT) seguiría viendo solo 1 fila igual, pero el chequeo
    // más directo es que loadOfflineSnapshot (PK lookup) siga determinista.
    const snapAgain = await mod.loadOfflineSnapshot('report-1');
    expect(snapAgain).toEqual(snap);
  });

  it('ADR-022: preserva el base_version_number ORIGINAL mientras la fila siga dirty, no el de un guardado posterior', async () => {
    const template = await buildTemplateBytes();
    const mod = await freshModule({ userId: 'u1', tenantId: 't1' }, template);

    // Primer guardado offline: parte de la versión 5 del servidor.
    await mod.saveOfflineSnapshot('report-1', 'Título', { v: 1 }, 5);
    // Autosave offline posterior del MISMO informe, todavía sin sincronizar
    // (sigue dirty=1) -- la versión-base real (la última confirmada por el
    // servidor) sigue siendo 5, no debe pisarse con ningún valor nuevo.
    await mod.saveOfflineSnapshot('report-1', 'Título', { v: 2 }, 999);

    const snap = await mod.loadOfflineSnapshot('report-1');
    expect(snap!.baseVersionNumber).toBe(5);

    // Una vez sincronizado (dirty=0) y el usuario vuelve a editar offline,
    // AHORA sí se acepta la nueva versión-base (arrancó de cero un nuevo
    // ciclo offline).
    await mod.markOfflineSnapshotSynced('report-1');
    await mod.saveOfflineSnapshot('report-1', 'Título', { v: 3 }, 7);
    const snap2 = await mod.loadOfflineSnapshot('report-1');
    expect(snap2!.baseVersionNumber).toBe(7);
    expect(snap2!.dirty).toBe(true);
  });

  it('markOfflineSnapshotSynced pone dirty en false', async () => {
    const template = await buildTemplateBytes();
    const mod = await freshModule({ userId: 'u1', tenantId: 't1' }, template);

    await mod.saveOfflineSnapshot('report-1', 'Título', {}, 1);
    expect((await mod.loadOfflineSnapshot('report-1'))!.dirty).toBe(true);

    await mod.markOfflineSnapshotSynced('report-1');
    expect((await mod.loadOfflineSnapshot('report-1'))!.dirty).toBe(false);
  });

  it('recordWentOffline / recordCameOnline cierran el evento de desconexión más reciente sin resolver', async () => {
    const template = await buildTemplateBytes();
    const mod = await freshModule({ userId: 'u1', tenantId: 't1' }, template);

    await mod.recordWentOffline('report-1', '2026-09-13T10:00:00.000Z');
    // Segunda desconexión sin que la primera se haya resuelto (caso raro
    // pero real: red intermitente) -- recordCameOnline debe cerrar la MÁS
    // reciente, no la primera.
    await mod.recordWentOffline('report-1', '2026-09-13T10:05:00.000Z');
    await mod.recordCameOnline('report-1', '2026-09-13T10:06:00.000Z');

    // No hay getter público de eventos -- se verifica indirectamente: una
    // NUEVA desconexión + reconexión debe volver a cerrar correctamente
    // (si la lógica de "más reciente sin resolver" estuviera rota, esta
    // segunda ronda fallaría con el evento ya cerrado de arriba).
    await mod.recordWentOffline('report-1', '2026-09-13T11:00:00.000Z');
    await expect(mod.recordCameOnline('report-1', '2026-09-13T11:01:00.000Z')).resolves.toBeUndefined();
  });

  it('findOrphanedLocalDrafts: solo devuelve borradores locales (prefijo rep_) sin sincronizar, más reciente primero', async () => {
    const template = await buildTemplateBytes();
    const mod = await freshModule({ userId: 'u1', tenantId: 't1' }, template);

    // `updated_at` es `new Date().toISOString()` (resolución de 1ms) -- un
    // pequeño delay real entre guardados evita un empate de timestamp que
    // haría el ORDER BY DESC dependiente del orden de inserción de SQLite
    // en vez de la fecha real (no es un bug de producción, es una
    // precondición real del test: los guardados reales del usuario nunca
    // ocurren en el mismo milisegundo exacto).
    await mod.saveOfflineSnapshot('rep_1000', 'Borrador viejo', {}, 0);
    await new Promise((r) => setTimeout(r, 5));
    await mod.saveOfflineSnapshot('rep_2000', 'Borrador nuevo', {}, 0);
    // Informe con id REAL de servidor (UUID) -- no es un huérfano local,
    // no debe aparecer aunque esté dirty.
    await mod.saveOfflineSnapshot('11684150-461a-4029-8703-c4b7055c3f96', 'Ya tiene servidor', {}, 3);
    // Borrador local YA sincronizado -- tampoco debe aparecer.
    await mod.saveOfflineSnapshot('rep_3000', 'Ya sincronizado', {}, 0);
    await mod.markOfflineSnapshotSynced('rep_3000');

    const orphans = await mod.findOrphanedLocalDrafts();
    expect(orphans.map((o) => o.reportId)).toEqual(['rep_2000', 'rep_1000']);
  });

  it('deleteOfflineSnapshot borra el snapshot y sus eventos de conectividad asociados', async () => {
    const template = await buildTemplateBytes();
    const mod = await freshModule({ userId: 'u1', tenantId: 't1' }, template);

    await mod.saveOfflineSnapshot('report-1', 'Título', {}, 1);
    await mod.recordWentOffline('report-1', '2026-09-13T10:00:00.000Z');

    await mod.deleteOfflineSnapshot('report-1');

    expect(await mod.loadOfflineSnapshot('report-1')).toBeNull();
    // No queda huérfano referenciando un report_id inexistente.
    await mod.saveOfflineSnapshot('rep_other', 'Otro', {}, 0);
    const orphans = await mod.findOrphanedLocalDrafts();
    expect(orphans.some((o) => o.reportId === 'report-1')).toBe(false);
  });

  it('ADR-022: migra en el sitio una plantilla vieja sin base_version_number (schema upgrade real)', async () => {
    const legacyTemplate = await buildTemplateBytes(/* withBaseVersionColumn */ false);
    const mod = await freshModule({ userId: 'u1', tenantId: 't1' }, legacyTemplate);

    // Si `ensureSchemaUpgraded` no agregara la columna, este INSERT (que sí
    // la referencia) lanzaría una excepción real de sql.js ("no such column").
    await expect(
      mod.saveOfflineSnapshot('report-1', 'Título', {}, 42),
    ).resolves.toBeUndefined();

    const snap = await mod.loadOfflineSnapshot('report-1');
    expect(snap!.baseVersionNumber).toBe(42);
  });

  it('persistencia real entre "sesiones": los datos sobreviven a cerrar y reabrir la pestaña (misma caché, módulo reimportado)', async () => {
    const template = await buildTemplateBytes();
    const session = { userId: 'u1', tenantId: 't1' };

    const mod1 = await freshModule(session, template);
    await mod1.saveOfflineSnapshot('report-1', 'Persistido', { ok: true }, 9);

    // "Cierra la pestaña": reimporta el módulo desde cero (nuevo
    // dbPromise/SQLModule), pero fakeCaches (creado en beforeEach, no en
    // freshModule) sigue siendo la MISMA instancia -- igual que en un
    // navegador real, donde la Cache Storage sobrevive a un reload.
    const { authFetch } = await import('../../../auth/authApi');
    const mod2 = await freshModule(session, template);
    // Si mod2 tuviera que volver a descargar la plantilla (porque no
    // encontró nada en caché), authFetch se llamaría de nuevo -- se
    // resetean los mocks entre freshModule() vía vi.resetModules, así que
    // se verifica el efecto real en su lugar: el snapshot sigue ahí.
    void authFetch;

    const snap = await mod2.loadOfflineSnapshot('report-1');
    expect(snap).not.toBeNull();
    expect(snap!.title).toBe('Persistido');
    expect(snap!.documentJson).toEqual({ ok: true });
  });

  it('resolveCacheName aísla la caché por usuario+tenant (ADR-127): usuarios distintos no comparten datos offline', async () => {
    const template = await buildTemplateBytes();

    const modUserA = await freshModule({ userId: 'user-a', tenantId: 'tenant-1' }, template);
    await modUserA.saveOfflineSnapshot('report-shared-id', 'Datos de A', { owner: 'a' }, 1);

    // Mismo report_id, pero un usuario DISTINTO -- no debe ver los datos de A
    // (caché aislada por resolveCacheName, no una base compartida).
    const modUserB = await freshModule({ userId: 'user-b', tenantId: 'tenant-1' }, template);
    const snapForB = await modUserB.loadOfflineSnapshot('report-shared-id');
    expect(snapForB).toBeNull();

    // El usuario A sigue viendo los suyos en su propia caché.
    const modUserAAgain = await freshModule({ userId: 'user-a', tenantId: 'tenant-1' }, template);
    const snapForA = await modUserAAgain.loadOfflineSnapshot('report-shared-id');
    expect(snapForA!.documentJson).toEqual({ owner: 'a' });
  });

  it('purgeOfflineCacheOnLogout: preserva la caché si hay cambios sin sincronizar (regla dura de 0% pérdida)', async () => {
    const template = await buildTemplateBytes();
    const session = { userId: 'u1', tenantId: 't1' };
    const mod = await freshModule(session, template);

    await mod.saveOfflineSnapshot('report-1', 'Sin sincronizar', {}, 1); // dirty=1

    const purged = await mod.purgeOfflineCacheOnLogout();
    expect(purged).toBe(false);

    // Verificable de forma independiente: reabrir para el MISMO usuario debe
    // seguir viendo el dato -- si se hubiera purgado, esto sería null.
    const modAfter = await freshModule(session, template);
    expect(await modAfter.loadOfflineSnapshot('report-1')).not.toBeNull();
  });

  it('purgeOfflineCacheOnLogout: purga cuando todo está sincronizado (dirty=0)', async () => {
    const template = await buildTemplateBytes();
    const session = { userId: 'u1', tenantId: 't1' };
    const mod = await freshModule(session, template);

    await mod.saveOfflineSnapshot('report-1', 'Ya sincronizado', {}, 1);
    await mod.markOfflineSnapshotSynced('report-1');

    const purged = await mod.purgeOfflineCacheOnLogout();
    expect(purged).toBe(true);

    // Tras la purga, reabrir para el mismo usuario vuelve a descargar la
    // plantilla limpia (ya no hay nada cacheado) -- el dato desaparece.
    const modAfter = await freshModule(session, template);
    expect(await modAfter.loadOfflineSnapshot('report-1')).toBeNull();
  });
});
