-- ============================================================================
-- 99 — RUC real + domicilio fiscal verificado contra SUNAT (addendum ADR-190)
-- ============================================================================
-- Los RUC de auth_companies eran sintéticos por diseño (ADR-088): checksum
-- válido, pero no el RUC real de la empresa nombrada. A pedido explícito del
-- dueño del proyecto, se reemplaza el RUC sintético por el RUC REAL de cada
-- empresa (dato público, investigado contra fuentes como SMV, MINEM/OSCE,
-- sitio oficial de la empresa, y directorios que reflejan SUNAT) y se
-- reemplaza domicilio_fiscal por el domicilio fiscal REAL registrado ante
-- SUNAT -- ya NO la descripción de la unidad minera (eso quedó separado
-- correctamente en latitude/longitude, que representa la ubicación física de
-- la mina, un concepto distinto del domicilio fiscal legal de la empresa).
--
-- Cada RUC candidato se verificó EN VIVO contra la integración real ya
-- configurada (ADR-087, proveedor api.chequea.pe, ver
-- backend/src/auth/tax_registry_client.cpp) vía
-- GET /api/auth/validate-company?ruc=<ruc>&country=PE -- comparando la
-- razón_social devuelta contra la esperada. Un candidato (Alpayana) NO pasó
-- esta verificación (la razón social real de ese RUC es "SOBREANDES S.A.C.",
-- sin relación con Alpayana) y se excluye explícitamente de este script --
-- ver nota al final.
--
-- Empresas fuera de alcance de este script (no se investigó su RUC real):
-- Beemetry y TimeTelemetry (posible relación directa con el dueño del
-- proyecto -- requiere confirmación antes de asignarles un RUC real
-- encontrado por investigación externa) y la fila de prueba QA.

BEGIN;

UPDATE auth_companies SET ruc = '20137913250', domicilio_fiscal = 'CAL. ESQUILACHE 371, SAN ISIDRO, LIMA'
WHERE company_id = 'd9a7ea21-a751-4eca-bc34-8ae99198aa03'; -- Anglo American Quellaveco S.A.

-- ux_auth_companies_ruc es UNIQUE -- el RUC real solo puede ir en UNA de las
-- dos filas duplicadas (mismo yacimiento real, dos tenants demo distintos);
-- la otra fila recibe solo el domicilio_fiscal real (dirección correcta),
-- sin RUC, para no reclamar falsamente el mismo RUC en dos tenants.
UPDATE auth_companies SET ruc = '20330262428', domicilio_fiscal = 'AV. EL DERBY 055, OF. 801, SANTIAGO DE SURCO, LIMA'
WHERE company_id = 'd2efcd62-25c3-4e9e-aba0-f9ca4d84dc40'; -- Compañía Minera Antamina S.A.
UPDATE auth_companies SET domicilio_fiscal = 'AV. EL DERBY 055, OF. 801, SANTIAGO DE SURCO, LIMA'
WHERE company_id = '07a9a3ed-9f57-4e25-9c86-2f1fe39ef1ba'; -- "Minera Antamina" (mismo yacimiento, RUC sintético sin tocar)

UPDATE auth_companies SET ruc = '20538428524', domicilio_fiscal = 'AV. EL DERBY 055, SANTIAGO DE SURCO, LIMA'
WHERE company_id = '32a42dee-0a7c-4684-b836-ab6255dee593'; -- Minera Las Bambas S.A.

UPDATE auth_companies SET ruc = '20114915026', domicilio_fiscal = 'CAMPAMENTO MINERO TINTAYA S/N, ESPINAR, CUSCO'
WHERE company_id = '459ba8bb-bb2f-484a-b063-ab7e9923f57e'; -- Compañía Minera Antapaccay S.A. (domicilio fiscal registrado directamente en el campamento minero)

UPDATE auth_companies SET ruc = '20170072465', domicilio_fiscal = 'CAL. JACINTO IBAÑEZ 315, CERCADO, AREQUIPA'
WHERE company_id = '1d873a2e-5673-479d-940e-666a7ad59b80'; -- Sociedad Minera Cerro Verde S.A.A.

UPDATE auth_companies SET ruc = '20506675457', domicilio_fiscal = 'AV. SANTA CRUZ 180, MIRAFLORES, LIMA'
WHERE company_id = 'c4bc04aa-b159-46e9-b51e-68febebc37db'; -- Minera Chinalco Perú S.A.

UPDATE auth_companies SET ruc = '20100147514', domicilio_fiscal = 'AV. CAMINOS DEL INCA 171, SANTIAGO DE SURCO, LIMA'
WHERE company_id = 'd04b9560-f78b-4fa8-aa9b-bb4915c98ac5'; -- Southern Peru Copper Corporation, Sucursal del Perú

UPDATE auth_companies SET ruc = '20137291313', domicilio_fiscal = 'AV. SANTA CRUZ 120, OF. 601, MIRAFLORES, LIMA'
WHERE company_id = '6d0e3b9b-7c34-48fd-b9e5-9db64c3f32c3'; -- Minera Yanacocha S.R.L.

UPDATE auth_companies SET ruc = '20511165181', domicilio_fiscal = 'AV. JORGE CHAVEZ 235, OF. 701, MIRAFLORES, LIMA'
WHERE company_id = '4f2ff51a-a161-44d9-9372-8dc1611ee0c1'; -- Hudbay Perú S.A.C.

UPDATE auth_companies SET ruc = '20100136741', domicilio_fiscal = 'JR. GIOVANNI BATISTA LORENZO 149, OF. 501A, SAN BORJA, LIMA'
WHERE company_id = 'b1e31c12-87c4-473b-8c86-1b01cd03a22b'; -- Minsur S.A.

UPDATE auth_companies SET ruc = '20507828915', domicilio_fiscal = 'AV. 28 DE JULIO 1150, MIRAFLORES, LIMA'
WHERE company_id = 'b152ec24-90f3-40ba-9642-0e00a30e2dd7'; -- Gold Fields La Cima S.A.

-- Hochschild Mining Peru: se usa la entidad holding/país "Hochschild Mining
-- (Perú) S.A.C." (distinta de "Compañía Minera Ares S.A.C.", la operadora
-- de Inmaculada, ya asignada abajo a las filas Ares).
UPDATE auth_companies SET ruc = '20517849104', domicilio_fiscal = 'CAL. LA COLONIA 180, SANTIAGO DE SURCO, LIMA'
WHERE company_id = 'dab9ec75-339a-49b7-b223-cd317b728008'; -- Hochschild Mining (Perú) S.A.C.

UPDATE auth_companies SET ruc = '20137025354', domicilio_fiscal = 'AV. LA FLORESTA 497, OF. 501, SAN BORJA, LIMA'
WHERE company_id = '6e5c6bce-0793-44f0-9d7d-3577d617078e'; -- Compañía Minera Poderosa S.A.
UPDATE auth_companies SET domicilio_fiscal = 'AV. LA FLORESTA 497, OF. 501, SAN BORJA, LIMA'
WHERE company_id = 'b4be9456-b28b-4d74-91a3-e3a587d4d798'; -- "Minera Poderosa" (mismo yacimiento, RUC sintético sin tocar)

UPDATE auth_companies SET ruc = '20136150473', domicilio_fiscal = 'JR. CRANE 102, OF. 5-6, SAN BORJA, LIMA'
WHERE company_id = '99961b6f-5ca4-4d74-bbaf-80b2e8d0ce31'; -- Consorcio Minero Horizonte S.R.L.

UPDATE auth_companies SET ruc = '20100142989', domicilio_fiscal = 'AV. REPUBLICA DE CHILE 262, JESUS MARIA, LIMA'
WHERE company_id = 'c698f2c4-38cf-4f50-af68-7cd2745315ca'; -- Shougang Hierro Perú S.A.A.

UPDATE auth_companies SET ruc = '20508972734', domicilio_fiscal = 'JR. GIOVANNI BATISTA LORENZO 149, OF. 301, SAN BORJA, LIMA'
WHERE company_id = '05bc708d-8b01-4983-8d09-ad1e73467cc3'; -- Marcobre S.A.C.

UPDATE auth_companies SET ruc = '20100110513', domicilio_fiscal = 'AV. CIRCUNVALACION DEL CLUB GOLF LOS INCAS 170, SANTIAGO DE SURCO, LIMA'
WHERE company_id = 'e68e1227-0c41-4584-b945-059757367368'; -- Nexa Resources Perú S.A.A.

UPDATE auth_companies SET ruc = '20100017572', domicilio_fiscal = 'CAL. LAS BEGONIAS 415, P-19, SAN ISIDRO, LIMA'
WHERE company_id = '25f1656f-c518-4c3d-967b-e864f0634736'; -- Sociedad Minera El Brocal S.A.A.
UPDATE auth_companies SET domicilio_fiscal = 'CAL. LAS BEGONIAS 415, P-19, SAN ISIDRO, LIMA'
WHERE company_id = '3a5a255f-547d-4357-8e47-4012e1c032ce'; -- "El Brocal" (mismo yacimiento, RUC sintético sin tocar)

UPDATE auth_companies SET ruc = '20546191541', domicilio_fiscal = 'AV. LA FLORESTA 497, OF. 101, SAN BORJA, LIMA'
WHERE company_id = '087cf82b-2c28-4c17-b1f9-e59f6acb09e5'; -- Pan American Silver Huarón S.A.

-- Sierra Metals Yauricocha / Minera Corona: mismo yacimiento real
-- (Yauricocha, Yauyos) operado por la misma razón social peruana.
UPDATE auth_companies SET ruc = '20217427593', domicilio_fiscal = 'JR. CONTRALMIRANTE MONTERO 429, MAGDALENA DEL MAR, LIMA'
WHERE company_id = 'aa8a76ac-6788-4b99-9746-22312a10a38c'; -- Sociedad Minera Corona S.A.
UPDATE auth_companies SET domicilio_fiscal = 'JR. CONTRALMIRANTE MONTERO 429, MAGDALENA DEL MAR, LIMA'
WHERE company_id = '072854bb-970f-4c4f-8efb-ef2092a5d8bf'; -- "Sierra Metals Yauricocha" (mismo yacimiento, RUC sintético sin tocar)

UPDATE auth_companies SET ruc = '20192779333', domicilio_fiscal = 'CAL. LA COLONIA 180, SANTIAGO DE SURCO, LIMA'
WHERE company_id = '8dd8b942-aadc-4499-8218-9e66d3f74cdb'; -- Compañía Minera Ares S.A.C.
UPDATE auth_companies SET domicilio_fiscal = 'CAL. LA COLONIA 180, SANTIAGO DE SURCO, LIMA'
WHERE company_id = '8eddaa74-c3b2-4d24-b3b4-66b0c45974c0'; -- "Ares" (mismo yacimiento, RUC sintético sin tocar)

UPDATE auth_companies SET ruc = '20519387043', domicilio_fiscal = 'AV. LOS CONQUISTADORES 1144, SAN ISIDRO, LIMA'
WHERE company_id = '6d3a116f-63b1-4730-82e6-9027ed3584e7'; -- Bear Creek Mining S.A.C.

UPDATE auth_companies SET ruc = '20509551767', domicilio_fiscal = 'AV. SANTO TORIBIO 173, SAN ISIDRO, LIMA'
WHERE company_id = '7c7533bc-b630-40c1-a9ae-2ab22d03b9b9'; -- Catalina Huanca Sociedad Minera S.A.C.

UPDATE auth_companies SET ruc = '20100177421', domicilio_fiscal = 'CAL. MANUEL AUGUSTO GONZALES O 448, SAN ISIDRO, LIMA'
WHERE company_id = 'bee8cceb-f8dd-469b-8be9-ed3b86b752f9'; -- Compañía Minera San Ignacio de Morococha S.A.A. (SIMSA)

UPDATE auth_companies SET ruc = '20100163552', domicilio_fiscal = 'AV. AVIACION 2540, SAN BORJA, LIMA'
WHERE company_id = 'd9d1664e-fa31-4859-b743-2fef289958b8'; -- Compañía Minera Raura S.A.
UPDATE auth_companies SET domicilio_fiscal = 'AV. AVIACION 2540, SAN BORJA, LIMA'
WHERE company_id = '05478f42-443b-47b5-b1d3-16e24c595d6d'; -- "Minera Raura" (mismo yacimiento, RUC sintético sin tocar)

UPDATE auth_companies SET ruc = '20536126440', domicilio_fiscal = 'CAL. DEAN VALDIVIA 148, OF. 601, SAN ISIDRO, LIMA'
WHERE company_id = 'eb6f8126-d64d-4b4c-9a87-1c91987eafb9'; -- Minera Veta Dorada S.A.C. (subsidiaria peruana de Dynacor)

UPDATE auth_companies SET ruc = '20520694839', domicilio_fiscal = 'AV. REPUBLICA DE COLOMBIA 791, OF. 604, SAN ISIDRO, LIMA'
WHERE company_id = '799b946b-b075-4d3f-9adb-39efc487b273'; -- Jinzhao Mining Perú S.A.

UPDATE auth_companies SET ruc = '20510704291', domicilio_fiscal = 'AV. JORGE CHAVEZ 154, P-5, MIRAFLORES, LIMA'
WHERE company_id = 'b4a66fca-d21d-4e9e-8982-3630e9ace79e'; -- Minera Bateas S.A.C.

UPDATE auth_companies SET ruc = '20209133394', domicilio_fiscal = 'AV. STO TORIBIO 173, OF. 901, SAN ISIDRO, LIMA'
WHERE company_id = '6db5cfe6-6d30-47fa-b671-99afd4f8b806'; -- Minera Boroo Misquichilca S.A.

UPDATE auth_companies SET ruc = '20126702737', domicilio_fiscal = 'AV. PABLO CARRIQUIRRY 691, SAN ISIDRO, LIMA'
WHERE company_id = '8e1a2b83-9233-4e44-95bf-200d897185db'; -- Compañía Minera Caravelí S.A.C.

UPDATE auth_companies SET ruc = '20100056802', domicilio_fiscal = 'AV. MANUEL OLGUIN 501, OF. 803, SANTIAGO DE SURCO, LIMA'
WHERE company_id = '4b2caa86-4e8b-4e9e-91c3-5916bc7086c2'; -- Compañía Minera Condestable S.A.

-- Minera IRL: se usa la titular directa del proyecto Ollachea
-- ("Compañía Minera Kuri Kullu S.A.", subsidiaria), no la matriz "Minera
-- IRL S.A." -- coherente con que domicilio_fiscal ya describía el proyecto.
UPDATE auth_companies SET ruc = '20513994983', domicilio_fiscal = 'AV. SANTA CRUZ 830, OF. 401, MIRAFLORES, LIMA'
WHERE company_id = '35b4ea12-03f4-4607-b38d-f6a95747857f'; -- Compañía Minera Kuri Kullu S.A.

UPDATE auth_companies SET ruc = '20332907990', domicilio_fiscal = 'JR. CONTRALMIRANTE MONTERO 429, MAGDALENA DEL MAR, LIMA'
WHERE company_id = 'd7f0a83f-c61f-47ba-a360-cae45b681224'; -- Empresa Minera Los Quenuales S.A.C.

UPDATE auth_companies SET ruc = '20383045267', domicilio_fiscal = 'AV. MANUEL OLGUIN 375, SANTIAGO DE SURCO, LIMA'
WHERE company_id = '8db1bfe9-0bc1-4782-9fad-4a6a882296f7'; -- Volcan Compañía Minera S.A.A.

UPDATE auth_companies SET ruc = '20376303811', domicilio_fiscal = 'JR. TEODORO CARDENAS 139, OF. 103, SAN ISIDRO, LIMA'
WHERE company_id = '520540bf-9cff-49b9-8c51-331daf8a431a'; -- Doe Run Perú S.R.L. en Liquidación

UPDATE auth_companies SET ruc = '20522025071', domicilio_fiscal = 'AV. EL DERBY 254, OF. 2001, SANTIAGO DE SURCO, LIMA'
WHERE company_id = '2b8b6a0c-5bb9-466e-bce2-66a3c0f97323'; -- Summa Gold Corporation S.A.C.

UPDATE auth_companies SET ruc = '20100079501', domicilio_fiscal = 'CAL. LAS BEGONIAS 415, P-19, SAN ISIDRO, LIMA'
WHERE company_id = 'a5c49eee-a521-4e02-b961-ba55946e3760'; -- Compañía de Minas Buenaventura S.A.A.

UPDATE auth_companies SET ruc = '20103030791', domicilio_fiscal = 'CAL. DOMINGO ELIAS 150, MIRAFLORES, LIMA'
WHERE company_id = '09c1bdbf-20a8-466f-b662-5434678f57b4'; -- Activos Mineros S.A.C.

UPDATE auth_companies SET ruc = '20100028698', domicilio_fiscal = 'JR. CRISTOBAL DE PERALTA NORTE 820, SANTIAGO DE SURCO, LIMA'
WHERE company_id = 'd08c4780-a77d-4e8c-b14f-ffab56989107'; -- Ferreyros S.A.

UPDATE auth_companies SET ruc = '20302241598', domicilio_fiscal = 'AV. ARGENTINA 4453, CALLAO'
WHERE company_id = '6f602997-7fa7-433f-9d0c-e0d87d38c787'; -- Komatsu-Mitsui Maquinarias Perú S.A.

UPDATE auth_companies SET ruc = '20543265056', domicilio_fiscal = 'AV. VIA DE EVITAMIENTO 1980, ATE, LIMA'
WHERE company_id = 'c345686a-2c14-469b-b4fa-78217c4effa7'; -- Motored S.A. (domicilio real es Ate, no Callao)

UPDATE auth_companies SET ruc = '20100070031', domicilio_fiscal = 'CAR. PANAMERICANA SUR KM 23.88, LURIN, LIMA'
WHERE company_id = '738fc8b3-e52a-404a-a548-e3dfa694670c'; -- Volvo Perú S.A. (domicilio real es Lurín, no Callao)

COMMIT;

-- ── Empresa EXCLUIDA de esta migración (verificación falló) ──
-- Alpayana (c8d3d435-ee06-45de-b5b7-0d31d80427b8): el único RUC candidato
-- hallado por investigación (20100108292, indexado en directorios bajo
-- "Cía. Minera Casapalca S.A.", nombre previo de Alpayana) resultó, al
-- verificarlo en vivo contra SUNAT vía la integración real, pertenecer a
-- "SOBREANDES S.A.C." -- una empresa sin relación con Alpayana. Se descarta
-- el candidato por completo; ruc/domicilio_fiscal de Alpayana quedan sin
-- tocar hasta encontrar una fuente confiable. Ver ADR-190 (addendum).

-- ── Empresas fuera de alcance (no investigadas) ──
-- Beemetry (20aff126-ec6f-4d66-a094-f98511acd8b3) y TimeTelemetry
-- (2e9ad0b2-360f-4fdc-8276-85c3c37ff268): posible relación directa con el
-- dueño del proyecto -- requiere su confirmación antes de asignarles un RUC
-- real encontrado por investigación externa.

-- ── Verificación post-migración (solo lectura) ──
-- SELECT name, ruc, domicilio_fiscal FROM auth_companies ORDER BY name;
