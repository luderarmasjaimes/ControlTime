# ADR-094 — Lectura de DNI por cámara web (PDF417 + MRZ), sin validación online contra RENIEC

**Status**: implemented, verificado con datos sintéticos (2026-08-07)
**Fecha**: 2026-08-07
**Autores**: EC
**Ámbito**: plataforma
**Relación**: alternativa elegida tras descartar la validación online de DNI contra RENIEC (sin API oficial gratuita; el único proveedor ya usado para RUC, ADR-087, descontinuó su servicio de DNI al público); reutiliza el patrón de sidecar de visión de ADR-027 (`opencv-procesamiento-imagenes`) y el flujo de captura continua de la biometría facial (`IntegratedBiometricModal`).

## Contexto

Gerencia pidió evitar errores de tipeo al registrar el DNI de una persona,
tanto en autoregistro como al editar un usuario ya existente. La validación
online contra RENIEC se descartó explícitamente por riesgo de cumplimiento
(no hay API oficial gratuita; los proveedores de terceros no están
contratados). La alternativa pedida: leer el número directamente del
documento físico vía cámara web, sin consultar ninguna fuente externa.

Investigación previa del formato físico (no asumida):

- **DNI antiguo (1997, laminado)**: código de barras **PDF417** en el
  reverso, con texto plano decodificable (tipo de documento, número,
  apellidos, nombres, sexo, fecha de caducidad) — confirmado contra el
  proyecto de referencia `github.com/Eitol/peru-dni-reader` (MIT).
- **MRZ (TD1, ICAO 9303)**: presente en **todas** las versiones del DNI
  (antiguo y ambas generaciones del electrónico), 3 líneas OCR-B en el
  reverso, con dígito verificador propio (algoritmo ICAO, pesos 7-3-1
  repetidos, mod 10) — el método más universal.
- **QR (solo DNI-e 3.0)**: existe, pero RENIEC no documenta públicamente qué
  codifica ("doble control" sugiere que trabaja junto al chip NFC, no de
  forma autónoma). **Diferido explícitamente** hasta poder verificarlo
  contra una muestra real.

Hallazgo que amplió el alcance durante la implementación: la acción
`edit_data` de mantenimiento de usuarios
(`executeUserMaintenancePg`, `backend/src/auth/auth_storage_pg.cpp`) no
permitía editar el DNI en absoluto (solo `first_name, last_name, email,
phone, mobile`) — se agregó como parte de este trabajo, no como sorpresa a
mitad de implementación.

## Decisión

1. **Decodificación en el sidecar `ai_engine`** (Python/Flask/OpenCV), mismo
   patrón que la biometría facial existente (`analyze_eyes`,
   `face_embedding`) — no en el navegador ni en el gateway C++. Nuevo
   endpoint `POST /scan_document` en `ai_engine/eye_analyzer.py:1503`:
   intenta `pyzbar` (PDF417) primero; si no hay resultado, recorta el tercio
   inferior de la imagen y usa `pytesseract` + el paquete `mrz` (valida el
   dígito verificador ICAO automáticamente) sobre el TD1.
2. **Proxy C++**: `scanDocumentWithAiEngine()`
   (`backend/src/biometric/ai_engine_client.hpp/.cpp`), calcada de
   `analyzeFrameWithAiEngine`. Ruta **pública**
   `POST /api/dni/scan-document` (`biometric_routes.cpp:207-231`, sin
   `resolveAuthSession`) — mismo criterio que `/api/process_frame`: el
   autoregistro ocurre antes de tener sesión.
3. **DNI editable en mantenimiento**: `auth_storage_pg.cpp:966`,
   `details.contains("dni")` en la acción `edit_data`, respeta la unicidad
   existente (`auth_users_dni_key`).
4. **Frontend**: `DocumentScanCapture.tsx` (modal reutilizable, mismo loop
   de captura ~700ms que la biometría facial), `authApi.ts::scanDniDocument`
   (línea 644), integrado en `AuthGateway.tsx` (registro) y
   `UserManagementView.tsx` (edición de usuario existente). Autocompleta
   DNI + nombres/apellidos si el método los devuelve; el usuario los ve y
   confirma antes de enviar, nunca se auto-envían sin revisión.
5. **QR del DNI-e 3.0 queda fuera de alcance**, sin fecha — pendiente de una
   muestra real o documentación oficial de RENIEC.

## Consecuencias

- Reduce errores de tipeo de DNI en registro/edición sin depender de
  ninguna fuente externa ni almacenar datos de terceros fuera del propio
  documento que el usuario fotografía de sí mismo.
- Nunca bloquea el flujo: si PDF417 y MRZ fallan, el campo queda vacío para
  digitación manual, igual que antes de este trabajo.
- El endpoint es público (sin sesión) por diseño, igual que el resto del
  pipeline biométrico de autoregistro — no expone nada que el propio
  documento no exponga ya a quien lo fotografía.

### Negativas / Trade-offs — riesgos abiertos, no resueltos en este trabajo

1. **No se verificó el pipeline contra un DNI físico real** (ni antiguo ni
   electrónico) — sin acceso a uno en este entorno. Se verificaron por
   separado el parser MRZ (cadena TD1 sintética con checksum ICAO válido,
   construida a mano) y el parser PDF417 (payload sintético) contra el
   paquete `mrz` y `pyzbar` respectivamente — confirman que la integración
   funciona, no que el OCR/decodificación real contra una foto de un
   documento físico lo haga. **Queda como paso manual del usuario.**
2. Los offsets exactos de campos del PDF417 se tomaron de
   `Eitol/peru-dni-reader` (MIT); si el layout no calza en la prueba real,
   el fallback a MRZ sigue cubriendo el caso.
3. QR del DNI-e 3.0: sin fecha, depende de una muestra real o documentación
   oficial de RENIEC.

## Alternativas descartadas

- **Validación online contra RENIEC**: descartada por Gerencia — sin API
  oficial gratuita, riesgo de cumplimiento con datos de identidad de
  terceros no oficiales.
- **QR del DNI-e 3.0 en esta fase**: descartado — formato no verificable
  públicamente, decisión explícita de pausarlo hasta tener una muestra real.
- **OCR genérico sin checksum** (leer el número "a ojo" sin validar dígito
  verificador): descartado — el paquete `mrz` ya valida el checksum ICAO
  sin costo adicional, y hacerlo a mano duplicaría lógica ya resuelta y
  probada por esa librería.

## Verificación

- `ai_engine`: test unitario del parser MRZ con cadena TD1 sintética de
  checksum válido; mismo criterio para el parser PDF417 con payload
  sintético.
- `docker compose build ai_engine`: nuevas dependencias (`pyzbar`+`libzbar0`,
  `pytesseract`+`tesseract-ocr`+`tesseract-ocr-spa`) instalan sin conflicto
  (`ai_engine/requirements.txt`: `pyzbar>=0.1.9`, `pytesseract>=0.3.10`,
  `mrz>=0.6.1` — el intento inicial `mrz>=0.6.3` falló porque esa versión no
  existe en PyPI, el máximo real es 0.6.2).
- `docker compose build web`: proxy C++ compila.
- Frontend: `tsc --noEmit` OK, click-through manual de la UI de cámara
  (abre, pide permiso, muestra el loop de captura, cancela correctamente).
- **Pendiente, a cargo del usuario**: probar con un DNI real (antiguo y
  electrónico) frente a la cámara y confirmar que el número extraído
  coincide con el documento.

## Referencias

- `ai_engine/eye_analyzer.py` (`POST /scan_document`, línea 1503)
- `ai_engine/requirements.txt`, `ai_engine/Dockerfile.ai`
- `backend/src/biometric/ai_engine_client.hpp` / `.cpp`
  (`scanDocumentWithAiEngine`)
- `backend/src/biometric/biometric_routes.cpp`
  (`POST /api/dni/scan-document`, línea 207)
- `backend/src/biometric/biometric_types.hpp` (`AiEngineDniScanResult`)
- `backend/src/auth/auth_storage_pg.cpp` (línea 966, `dni` en `edit_data`)
- `frontend/src/components/UI/DocumentScanCapture.tsx`
- `frontend/src/auth/authApi.ts` (línea 644, `scanDniDocument`)
- `frontend/src/components/Auth/AuthGateway.tsx`
- `frontend/src/components/ReportStudioV2/components/views/UserManagementView.tsx`
- ADR-027 (`opencv-procesamiento-imagenes`), ADR-087
  (`validacion-ruc-registro-externo-opcional`)
