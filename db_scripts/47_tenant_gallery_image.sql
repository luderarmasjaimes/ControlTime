-- ADR-047: galería de imágenes (JPEG) por tenant — fotos de la unidad minera
-- insertables bajo demanda en la carátula o cualquier página del informe.
--
-- Mismo razonamiento de almacenamiento que ADR-046 (tenant_logo): centralizado
-- en Postgres, no en MinIO/disco, por consistencia transaccional y
-- replicación automática vía db_replica. La diferencia frente al logo es que
-- una foto JPEG SÍ puede pesar cientos de KB a pocos MB — para no penalizar
-- zonas de mala conectividad al mostrar la galería, cada imagen guarda
-- ADEMÁS una miniatura pequeña (thumbnail, generada server-side con OpenCV al
-- subir, ~200px, calidad JPEG baja): la lista de galería (GET .../gallery)
-- solo transfiere miniaturas; el archivo completo se descarga "bajo demanda"
-- (solo cuando el usuario efectivamente inserta esa imagen en el lienzo),
-- exactamente como pidió el negocio.

CREATE TABLE IF NOT EXISTS tenant_gallery_image (
    image_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    filename       TEXT NOT NULL,
    mime_type      TEXT NOT NULL DEFAULT 'image/jpeg',
    content        BYTEA NOT NULL,
    thumbnail      BYTEA NOT NULL,
    content_sha256 TEXT NOT NULL,
    width_px       INTEGER,
    height_px      INTEGER,
    updated_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_tenant_gallery_image_tenant ON tenant_gallery_image (tenant_id);

COMMENT ON TABLE tenant_gallery_image IS
    'Imágenes JPEG de la unidad minera por tenant — insertables bajo demanda en cualquier página del informe (carátula incluida). Miniatura pre-generada para listar sin descargar el archivo completo.';
