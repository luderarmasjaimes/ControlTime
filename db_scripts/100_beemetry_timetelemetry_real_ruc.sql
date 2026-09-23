-- ============================================================================
-- 100 — RUC real de Beemetry y TimeTelemetry, verificado contra SUNAT (ADR-190)
-- ============================================================================
-- db_scripts/99 excluyó Beemetry y TimeTelemetry por posible relación directa
-- con el dueño del proyecto. A pedido explícito, se investigaron igual que el
-- resto del catálogo y se verificaron EN VIVO contra la integración SUNAT
-- real (api.chequea.pe) antes de aplicar -- ambas coincidieron exactamente
-- (razón social, estado ACTIVO, condición HABIDO).

BEGIN;

UPDATE auth_companies SET ruc = '20610559345', domicilio_fiscal = 'AV. LOS GORRIONES 225, DPTO. 914, CHORRILLOS, LIMA'
WHERE company_id = '20aff126-ec6f-4d66-a094-f98511acd8b3'; -- Beemetry S.A.C.

UPDATE auth_companies SET ruc = '20601669316', domicilio_fiscal = 'CAL. MARTIR JOSE OLAYA 129, DPTO. 1506, MIRAFLORES, LIMA'
WHERE company_id = '2e9ad0b2-360f-4fdc-8276-85c3c37ff268'; -- Time Telemetry S.A.C.

COMMIT;
