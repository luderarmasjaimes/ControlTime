-- =============================================================================
-- 113_avatar_body_template.sql
-- Rediseño de avatar (2026-09-20, pedido explícito del usuario): el avatar
-- recorta SOLO la cabeza; el resto del cuerpo/vestimenta viene de un catálogo
-- fijo de plantillas pre-hechas (ai_engine/avatar_body_templates.py), no de
-- los hombros/torso fotografiados. Ver ADR-203 para el razonamiento completo.
--
-- Catálogo chico y curado -- mismo criterio que avatar_animation_job.kind
-- (db_scripts/90): CHECK explícito en vez de una tabla catálogo aparte.
-- Slug vacío ('') es el estado real de toda cuenta creada ANTES de este
-- cambio (avatar generado con el compuesto de lienzo blanco anterior, sin
-- plantilla) -- se trata igual que el default al mostrarlo en el backend
-- (auth_routes.cpp), pero la columna en sí no puede tener un DEFAULT no vacío
-- sin reescribir cada fila ya existente.
--
-- Esta migración es idempotente y espeja exactamente el bootstrap inline que
-- ya corre en auth_storage_pg.cpp::ensureAuthSchemaPg (ADR-131: el backend
-- se auto-migra al arrancar; este archivo numerado documenta la misma
-- decisión en el log de migraciones para quien audite db_scripts/ sin leer
-- el código C++).
-- =============================================================================

BEGIN;

ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS avatar_body_template_slug TEXT NOT NULL DEFAULT '';

-- Bug real probado en vivo (2026-09-21): con el DROP CONSTRAINT DESPUÉS de
-- estos UPDATE, el UPDATE que pone el slug NUEVO todavía corre bajo el
-- CHECK VIEJO (que no lo conoce) y falla ("viola check constraint"),
-- abortando toda la migración -- confirmado reproduciendo el error exacto
-- contra la base real. El DROP tiene que ir ANTES de cualquier UPDATE que
-- ya escriba el slug nuevo.
ALTER TABLE auth_users DROP CONSTRAINT IF EXISTS auth_users_avatar_body_template_slug_check;

-- Renombre de los 3 slugs deportivos (pedido explícito del usuario,
-- 2026-09-20): los nombres/slugs originales referenciaban clubes reales
-- (mismo riesgo de marca registrada que este catálogo evita en todo lo
-- demás, ver ai_engine/avatar_body_templates.py). Cuentas que ya hubieran
-- elegido esas plantillas migran al slug nuevo acá, sin CHECK activo de por
-- medio, antes de que el de abajo vuelva a exigir uno.
UPDATE auth_users SET avatar_body_template_slug = 'camiseta_franjas' WHERE avatar_body_template_slug = 'uniforme_peru';
UPDATE auth_users SET avatar_body_template_slug = 'camiseta_blanquiazul' WHERE avatar_body_template_slug = 'uniforme_alianza';
UPDATE auth_users SET avatar_body_template_slug = 'camiseta_crema' WHERE avatar_body_template_slug = 'uniforme_universitario';

ALTER TABLE auth_users ADD CONSTRAINT auth_users_avatar_body_template_slug_check
    CHECK (avatar_body_template_slug IN
        ('', 'polo_azul', 'polo_rojo', 'polo_verde', 'polo_negro',
         'camiseta_blanca', 'camiseta_rayas', 'camiseta_minera',
         'camisa_gris', 'camisa_celeste', 'camisa_denim',
         'chaqueta_campo', 'casaca_azul', 'casaca_roja',
         'chaleco_seguridad', 'chaleco_reflectivo',
         'camiseta_franjas', 'camiseta_blanquiazul', 'camiseta_crema',
         'camiseta_celeste_deportiva',
         -- Plantillas de FOTO REAL (2026-09-21, pedido explícito del
         -- usuario) en vez de silueta dibujada por código -- ver
         -- ai_engine/avatar_body_templates.py::_render_real_garment.
         'camiseta_crema_real', 'camiseta_celeste_azul_real',
         'camiseta_blanca_franja_real', 'camiseta_celeste_blanco_real',
         'camiseta_roja_real', 'camiseta_rosa_negro_real',
         'camiseta_azul_blanco_real', 'camiseta_amarilla_banda_real',
         'camiseta_amarilla_azul_real', 'camiseta_amarilla_brazos_real'));

COMMIT;
