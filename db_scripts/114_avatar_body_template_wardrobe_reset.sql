-- =============================================================================
-- 114_avatar_body_template_wardrobe_reset.sql
-- Catálogo de vestimenta del avatar reducido a solo fotos reales (pedido
-- explícito del usuario, 2026-09-21): "eliminar todas las camisetas y solo
-- se quede amarilla con brazos" + 8 prendas nuevas de foto real. Reemplaza
-- COMPLETO el catálogo de db_scripts/113 (procedural + fotos reales
-- previas), salvo camiseta_amarilla_brazos_real que se conserva.
--
-- Ver ai_engine/avatar_body_templates.py::REAL_GARMENT_ASSETS para el
-- detalle de extracción (GrabCut) de cada prenda nueva, y ADR-203 para el
-- razonamiento general del catálogo de cuerpo/vestimenta.
--
-- Espeja el bootstrap inline en auth_storage_pg.cpp::ensureAuthSchemaPg
-- (ADR-131) -- ambos deben cambiar juntos.
-- =============================================================================

BEGIN;

ALTER TABLE auth_users DROP CONSTRAINT IF EXISTS auth_users_avatar_body_template_slug_check;

-- Cuentas que ya tenían un slug de los eliminados vuelven a '' (equivalente
-- al default al mostrarlo, ver db_scripts/113) en vez de fallar el CHECK de
-- abajo -- mismo criterio que el slug vacío de cuentas nunca migradas.
UPDATE auth_users SET avatar_body_template_slug = ''
    WHERE avatar_body_template_slug NOT IN
        ('', 'camiseta_amarilla_brazos_real', 'camiseta_diagonal_roja_real',
         'camiseta_amarilla_verde_real', 'camiseta_celeste_rayas_real',
         'camiseta_crema_marron_real', 'camiseta_marino_rayas_real',
         'camiseta_celeste_real', 'chaqueta_electronica_real', 'chaleco_geologo_real');

ALTER TABLE auth_users ADD CONSTRAINT auth_users_avatar_body_template_slug_check
    CHECK (avatar_body_template_slug IN
        ('', 'camiseta_amarilla_brazos_real', 'camiseta_diagonal_roja_real',
         'camiseta_amarilla_verde_real', 'camiseta_celeste_rayas_real',
         'camiseta_crema_marron_real', 'camiseta_marino_rayas_real',
         'camiseta_celeste_real', 'chaqueta_electronica_real', 'chaleco_geologo_real'));

COMMIT;
