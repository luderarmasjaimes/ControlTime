-- ADR-046: logotipo corporativo por tenant (encabezado + carátula de informes)
--
-- Decisión de almacenamiento: el logo se guarda como SVG (texto vectorial,
-- típicamente 5-150 KB) directamente en Postgres, NO en MinIO ni en disco
-- local del backend. Razonamiento (plataforma multi-tenant nacional, zonas
-- con conectividad pobre):
--   1. Un SVG es diminuto frente al umbral donde MinIO/objeto externo aporta
--      valor (>1 MB); guardarlo como TEXT es el patrón recomendado por la
--      propia documentación de Postgres para objetos pequeños.
--   2. Replica automáticamente junto con el resto de datos del tenant vía la
--      réplica de lectura ya existente (db_replica) — sin lógica de
--      sincronización adicional entre un store de objetos y la BD relacional.
--   3. Consistencia transaccional con `tenants` (no puede quedar un logo
--      "huérfano" o a medio subir como sí puede pasar con un upload a un
--      object store en dos pasos).
--   4. Una sola pieza de infraestructura menos que mantener sana (ya hay
--      antecedentes de inestabilidad de MinIO/replica en este proyecto).
-- La resiliencia ante mala conectividad no se resuelve eligiendo "dónde"
-- vive el archivo en el servidor, sino evitando reponerlo por red en cada
-- carga: el endpoint de lectura sirve con Cache-Control immutable + ETag
-- (content_sha256) y el frontend cachea el SVG en localStorage por tenant.

CREATE TABLE IF NOT EXISTS tenant_logo (
    tenant_id      UUID PRIMARY KEY REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    svg_content    TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    mime_type      TEXT NOT NULL DEFAULT 'image/svg+xml',
    updated_by     TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenant_logo IS
    'Logotipo corporativo (SVG, fondo transparente) por tenant — usado en encabezado y carátula de informes técnicos.';
