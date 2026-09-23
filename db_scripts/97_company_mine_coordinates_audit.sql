-- ============================================================================
-- 97 — Auditoría de coordenadas GPS de la mina en auth_companies (ADR-190)
-- ============================================================================
-- ADR-121 cargó latitude/longitude/location_zoom por primera vez, pero varios
-- valores quedaron como aproximaciones redondeadas (ej. -14.85,-73.65) en vez
-- de coordenadas verificadas. Motivo del pedido: en "Administración de
-- empresas" el marcador de varias minas se veía en un punto impreciso o
-- fuera del yacimiento real.
--
-- Esta migración corrige 35 de 52 empresas con una fuente oficial o
-- razonablemente confiable (resolución MINEM/DGAAM, EIA/MEIA vía SENACE,
-- informe técnico regulatorio NI 43-101, o geocodificación exacta de la
-- dirección de sede para empresas no mineras). Las 17 restantes (incluida la
-- fila de prueba QA) NO se tocan: no se encontró fuente mejor que la
-- coordenada ya cargada, y ADR-121 es explícito en que no se debe inferir/
-- inventar una coordenada de mina sin fuente verificable.
--
-- Detalle completo por empresa (fuente citada, nivel de confianza,
-- conversiones UTM->decimal) documentado en ADR-190
-- (docs/decisions/190-auditoria-coordenadas-gps-oficiales-empresas.md).
--
-- Igual que db_scripts/68+: sin runner de migraciones, aplicar manualmente
-- con psql contra la base real.

BEGIN;

-- Anglo American Quellaveco -- EIA exploración (UTM 19S 326311E/8110446N)
UPDATE auth_companies SET latitude = -17.084, longitude = -70.632, location_zoom = 13
WHERE company_id = 'd9a7ea21-a751-4eca-bc34-8ae99198aa03';

-- Compania Minera Antamina / Minera Antamina -- RD 0303-2023/MINEM-DGAAM, tajo abierto
UPDATE auth_companies SET latitude = -9.540, longitude = -77.064, location_zoom = 13
WHERE company_id IN ('d2efcd62-25c3-4e9e-aba0-f9ca4d84dc40', '07a9a3ed-9f57-4e25-9c86-2f1fe39ef1ba');

-- Las Bambas -- Tercera MEIA (SENACE), punto junto al tajo Ferrobamba
UPDATE auth_companies SET latitude = -14.096, longitude = -72.291, location_zoom = 12
WHERE company_id = '32a42dee-0a7c-4684-b836-ab6255dee593';

-- Minera Cerro Verde -- MINEM, Plan de Cierre de Minas, punto central de la UM
UPDATE auth_companies SET latitude = -16.526, longitude = -71.583, location_zoom = 13
WHERE company_id = '1d873a2e-5673-479d-940e-666a7ad59b80';

-- Chinalco Peru -- MEIA Toromocho, punto central del tajo
UPDATE auth_companies SET latitude = -11.608, longitude = -76.141, location_zoom = 13
WHERE company_id = 'c4bc04aa-b159-46e9-b51e-68febebc37db';

-- Yanacocha -- documento técnico UTM 17S, consistente con ubicación conocida
UPDATE auth_companies SET latitude = -6.977, longitude = -78.505, location_zoom = 12
WHERE company_id = '6d0e3b9b-7c34-48fd-b9e5-9db64c3f32c3';

-- Hudbay Peru -- informe técnico regulatorio NI 43-101 (Constancia)
UPDATE auth_companies SET latitude = -14.45, longitude = -71.783, location_zoom = 14
WHERE company_id = '4f2ff51a-a161-44d9-9372-8dc1611ee0c1';

-- Minsur -- San Rafael, dos fuentes académicas independientes coinciden
UPDATE auth_companies SET latitude = -14.229, longitude = -70.318, location_zoom = 15
WHERE company_id = 'b1e31c12-87c4-473b-8c86-1b01cd03a22b';

-- Gold Fields La Cima -- informe técnico oficial Gold Fields plc (Cerro Corona)
UPDATE auth_companies SET latitude = -6.7600, longitude = -78.6189, location_zoom = 13
WHERE company_id = 'b152ec24-90f3-40ba-9642-0e00a30e2dd7';

-- Hochschild Mining Peru -- documento técnico Inmaculada, geo+UTM consistentes
UPDATE auth_companies SET latitude = -14.9553, longitude = -73.2428, location_zoom = 14
WHERE company_id = 'dab9ec75-339a-49b7-b223-cd317b728008';

-- Marcobre -- EIA Mina Justa vía SENACE/prensa especializada
UPDATE auth_companies SET latitude = -15.1590, longitude = -75.0620, location_zoom = 13
WHERE company_id = '05bc708d-8b01-4983-8d09-ad1e73467cc3';

-- Nexa Resources Peru -- Cerro Lindo, UTM de prensa gremial + Mindat coinciden
UPDATE auth_companies SET latitude = -13.0779, longitude = -75.9921, location_zoom = 14
WHERE company_id = 'e68e1227-0c41-4584-b945-059757367368';

-- Sierra Metals Yauricocha / Minera Corona -- mismo yacimiento real (Yauricocha,
-- Alis/Laraos, Yauyos); Minera Corona es la operadora histórica, no Corihuarmi
UPDATE auth_companies SET latitude = -12.3106, longitude = -75.7077, location_zoom = 14
WHERE company_id IN ('072854bb-970f-4c4f-8efb-ef2092a5d8bf', 'aa8a76ac-6788-4b99-9746-22312a10a38c');

-- Bear Creek Mining -- Corani, corrige error de >100km (coordenada anterior no
-- estaba ni en la provincia correcta); nivel distrito-capital, no bocamina exacta
UPDATE auth_companies SET latitude = -13.8753, longitude = -70.6081, location_zoom = 12
WHERE company_id = '6d3a116f-63b1-4730-82e6-9027ed3584e7';

-- Catalina Huanca -- GPS publicado (deperu.com) + distrito INGEMMET consistente
UPDATE auth_companies SET latitude = -13.98191429, longitude = -73.93421052, location_zoom = 15
WHERE company_id = '7c7533bc-b630-40c1-a9ae-2ab22d03b9b9';

-- Compania Minera Raura / Minera Raura -- documento técnico, confirma valor previo
UPDATE auth_companies SET latitude = -10.4417, longitude = -76.7417, location_zoom = 14
WHERE company_id IN ('d9d1664e-fa31-4859-b743-2fef289958b8', '05478f42-443b-47b5-b1d3-16e24c595d6d');

-- Minera Bateas -- Caylloma Mine (Mindat + sitio oficial Fortuna Mining)
UPDATE auth_companies SET latitude = -15.20419, longitude = -71.86280, location_zoom = 15
WHERE company_id = 'b4a66fca-d21d-4e9e-8982-3630e9ace79e';

-- Minera Boroo Misquichilca -- corrige región: opera Lagunas Norte (La Libertad),
-- no Cajamarca como estaba cargado (~110km de error)
UPDATE auth_companies SET latitude = -7.94223, longitude = -78.24620, location_zoom = 12
WHERE company_id = '6db5cfe6-6d30-47fa-b671-99afd4f8b806';

-- Minera Caraveli -- POI verificado + sitio corporativo (distrito Huanuhuanu)
UPDATE auth_companies SET latitude = -15.6426, longitude = -74.0793, location_zoom = 14
WHERE company_id = '8e1a2b83-9233-4e44-95bf-200d897185db';

-- Minera Condestable -- POI exacto "Mina Condestable" + MEIA consistente
UPDATE auth_companies SET latitude = -12.6937, longitude = -76.5916, location_zoom = 15
WHERE company_id = '4b2caa86-4e8b-4e9e-91c3-5916bc7086c2';

-- Minera IRL -- Proyecto Ollachea, refinamiento menor
UPDATE auth_companies SET latitude = -13.7951, longitude = -70.4717, location_zoom = 13
WHERE company_id = '35b4ea12-03f4-4607-b38d-f6a95747857f';

-- Minera Los Quenuales -- POI exacto "Unidad Minera Iscaycruz"
UPDATE auth_companies SET latitude = -10.7653, longitude = -76.7429, location_zoom = 14
WHERE company_id = 'd7f0a83f-c61f-47ba-a360-cae45b681224';

-- Compania Minera Volcan -- POI exacto, confirma unidad Cerro de Pasco
UPDATE auth_companies SET latitude = -10.6719, longitude = -76.2646, location_zoom = 14
WHERE company_id = '8db1bfe9-0bc1-4782-9fad-4a6a882296f7';

-- DOE Run Peru -- POI exacto complejo metalúrgico La Oroya
UPDATE auth_companies SET latitude = -11.5243, longitude = -75.8975, location_zoom = 15
WHERE company_id = '520540bf-9cff-49b9-8c51-331daf8a431a';

-- Summa Gold -- corrige unidad: opera El Toro/Isabelita (Huamachuco), no
-- Shahuindo (esa mina es de Pan American Silver)
UPDATE auth_companies SET latitude = -7.8268, longitude = -78.0079, location_zoom = 14
WHERE company_id = '2b8b6a0c-5bb9-466e-bce2-66a3c0f97323';

-- Empresas no mineras / corporativas -- geocodificación exacta de la dirección
-- de sede ya registrada en domicilio_fiscal (no se buscó "mina" para estas)
UPDATE auth_companies SET latitude = -12.0921, longitude = -77.0243, location_zoom = 16
WHERE company_id = 'a5c49eee-a521-4e02-b961-ba55946e3760'; -- Buenaventura (sede Lima)

UPDATE auth_companies SET latitude = -12.0976, longitude = -77.0222, location_zoom = 16
WHERE company_id = '09c1bdbf-20a8-466f-b662-5434678f57b4'; -- Activos Mineros (sede Lima)

UPDATE auth_companies SET latitude = -12.0498, longitude = -77.1104, location_zoom = 16
WHERE company_id = '6f602997-7fa7-433f-9d0c-e0d87d38c787'; -- Komatsu-Mitsui Maquinarias

UPDATE auth_companies SET latitude = -12.0468, longitude = -77.0797, location_zoom = 16
WHERE company_id = 'c345686a-2c14-469b-b4fa-78217c4effa7'; -- Motored S.A.

UPDATE auth_companies SET latitude = -12.0507, longitude = -77.1199, location_zoom = 16
WHERE company_id = '738fc8b3-e52a-404a-a548-e3dfa694670c'; -- Volvo Perú S.A.

UPDATE auth_companies SET latitude = -12.0901, longitude = -77.0155, location_zoom = 16
WHERE company_id = '20aff126-ec6f-4d66-a094-f98511acd8b3'; -- Beemetry (sede propia)

UPDATE auth_companies SET latitude = -12.0977, longitude = -76.9729, location_zoom = 16
WHERE company_id = '2e9ad0b2-360f-4fdc-8276-85c3c37ff268'; -- TimeTelemetry (sede)

COMMIT;

-- ── Empresas dejadas SIN CAMBIO (ver ADR-190 para el detalle de por qué) ──
-- Minera Antapaccay, Southern Peru Copper Corporation (ya confirmada correcta),
-- Compania Minera Poderosa / Minera Poderosa, Consorcio Minero Horizonte,
-- Shougang Hierro Peru, El Brocal / Sociedad Minera El Brocal (ya confirmada),
-- Pan American Silver Peru, Alpayana, Ares / Compania Minera Ares,
-- Compania Minera San Ignacio de Morococha, Dynacor, Jinzhao Mining Peru,
-- Ferreyros S.A.A. (conflicto de fuentes sobre su sede/planta).

-- ── Verificación post-migración (solo lectura) ──
-- SELECT company_id, name, latitude, longitude, location_zoom FROM auth_companies ORDER BY name;
