-- ADR-039 (migración completa, 2026-07-13): reports.tenant_id pasa de
-- dual-write opcional a única clave de aislamiento, igual que el resto de
-- la plataforma.
--
-- Contexto verificado antes de este script: solo existían 5 company_name
-- distintos en auth_users (Activos Mineros, Alpayana, Compania Minera
-- Raura, LUDER, Minera Raura), ninguno correspondiente a los 5 tenants
-- reales ya sembrados (Antamina, Las Bambas, Southern Copper, Cerro Verde,
-- Yanacocha) — son datos de desarrollo/prueba, no hay tenant real en juego.
-- Los 6 informes existentes en `reports` eran todos artefactos de
-- verificación ("E2E Test Report", "Debug Snap", "Verificacion Hash
-- Chain", etc), ninguno dato de cliente real.
--
-- Decisión (autorizada explícitamente por el usuario via AskUserQuestion,
-- opción "Borrar los 6 informes de prueba y partir limpio"): en vez de
-- inventar a qué tenant pertenece cada company_name legacy (lo que ADR-039
-- original ya había descartado como decisión de negocio, no técnica), se
-- eliminan los informes de prueba y `tenant_id` pasa a ser obligatorio
-- desde cero. `company_name` se conserva como columna de display legacy
-- (no se elimina la columna — sigue siendo útil para mostrar el nombre de
-- la empresa en la UI — pero deja de usarse para aislamiento/autorización).

BEGIN;

-- Borra los informes de prueba y todo lo que depende de ellos (todas las
-- FK a reports.id tienen ON DELETE CASCADE — ver \d reports).
DELETE FROM reports;

-- tenant_id ya no es opcional: todo informe nuevo requiere una sesión con
-- tenant real (auth_user_tenant) — createReportPg ya valida esto en C++
-- antes de llegar aquí, pero el constraint es la garantía real a nivel BD.
ALTER TABLE reports ALTER COLUMN tenant_id SET NOT NULL;

COMMIT;
