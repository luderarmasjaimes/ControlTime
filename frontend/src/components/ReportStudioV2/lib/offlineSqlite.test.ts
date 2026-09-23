import { describe, it, expect } from 'vitest';
import { isLocalDraftId } from './offlineSqlite';

/**
 * Este archivo cubre solo `isLocalDraftId` (función utilitaria pura). El
 * resto del flujo real (sql.js/WASM + Cache API, `saveOfflineSnapshot`,
 * conflicto de versión, aislamiento por usuario, purga en logout, etc.) se
 * cubre en `offlineSqlite.integration.test.ts` — cerrado 2026-09-13 (ver
 * SPEC-014, tasks.md): el motor WASM real y un mock fiel de la Cache API
 * (no una reimplementación de SQLite) resultaron suficientes para probarlo
 * de punta a punta sin fingir el comportamiento.
 */
describe('isLocalDraftId', () => {
  it('reconoce un document_id local generado por createNewDocument', () => {
    expect(isLocalDraftId('rep_1788565655979')).toBe(true);
  });

  it('rechaza un id real de servidor (UUID)', () => {
    expect(isLocalDraftId('11684150-461a-4029-8703-c4b7055c3f96')).toBe(false);
  });

  it('rechaza null, undefined y cadena vacía', () => {
    expect(isLocalDraftId(null)).toBe(false);
    expect(isLocalDraftId(undefined)).toBe(false);
    expect(isLocalDraftId('')).toBe(false);
  });

  it('no confunde un id que solo contiene el prefijo en otra posición', () => {
    expect(isLocalDraftId('informe_rep_123')).toBe(false);
  });
});
