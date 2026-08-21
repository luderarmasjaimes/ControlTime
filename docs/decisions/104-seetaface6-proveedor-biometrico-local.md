# ADR-104 — SeetaFace6 como proveedor biométrico libre, local y fail-closed

**Status**: implemented (2026-08-10)  
**Fecha**: 2026-08-10  
**Ámbito**: ia, seguridad, biometría  
**Relación**: SPEC-008; complementa ADR-025, ADR-089, ADR-098 y ADR-099.

## Contexto

Se necesita ejecutar registro y verificación facial 1:1 sin nube y sin costo
de licencia, en Docker Linux sobre una laptop. Se solicitó específicamente
evaluar software libre chino y aproximarse a las exigencias técnicas que
pueden aparecer en procesos de RENIEC, sin conectarse a RENIEC.

SeetaFace6Open, de SeetaTech/Chinese Academy of Sciences, publica detector,
landmarks, reconocedor y anti-spoofing, junto con modelos, bajo una licencia
BSD permisiva. El reconocedor general genera 1024 componentes.

Una librería libre no se convierte por integración en un producto certificado.
No se encontró evidencia pública atribuible a este build concreto de evaluación
NIST FRTE ni reporte de laboratorio ISO/IEC 30107-3. Además, los requisitos de
RENIEC dependen del expediente, TDR o contrato aplicable; no existe un sello
genérico de “válido para RENIEC” transferible a cualquier solución.

## Decisión

1. Incorporar `BiometricProvider::SeetaFace6`, seleccionable mediante
   `BEEMETRY_BIOMETRIC_PROVIDER=seetaface6`.
2. Compilar SeetaFace6Open en una etapa reproducible del contenedor desde el
   commit `a32e2faa0694c0f841ace4df9ead0407b78363c6`.
3. Montar modelos fuera de la imagen, en modo solo lectura, y verificar el
   SHA-256 del archivo oficial antes de usarlo.
4. Ejecutar detección de un solo rostro, cinco landmarks, PAD de una imagen y
   extracción L2-normalizada de plantilla. Solo `REAL` permite devolver una
   plantilla; `SPOOF`, `FUZZY`, error o indisponibilidad rechazan la operación.
5. En modo Seeta, ignorar plantillas suministradas por el cliente y volver a
   extraerlas de la imagen en el servidor. Esto impide omitir PAD enviando un
   vector fabricado.
6. Usar comparación 1:1 por coseno. El umbral inicial `0.80` es conservador,
   pero no se declara homologado: debe calibrarse con datos representativos y
   documentar FMR/FNMR antes de producción.
7. Mantener Dermalog como opción separada para contratos que exijan evidencia
   comercial o certificaciones que SeetaFace6 no aporta públicamente.
8. Exponer `certification_claim=false` en estado/health para impedir que la
   configuración local sea presentada accidentalmente como certificada.

## Controles y límites

- Todo el procesamiento facial ocurre dentro de la red Docker local.
- Archivos temporales usan nombres aleatorios, `subprocess` sin shell y se
  eliminan siempre.
- Los modelos se montan read-only; el contenedor no descarga modelos en runtime.
- Se admite plantilla de 1024 (modelo general) o 512 (variantes oficiales),
  pero registro y verificación deben tener exactamente la misma dimensión.
- PAD de un solo frame es una capa útil, no prueba suficiente de resistencia
  avanzada. Para alto riesgo se requiere reto activo/multiframe y evaluación
  externa ISO/IEC 30107-3.
- La protección criptográfica, retención, revocación y auditoría de plantillas
  siguen siendo responsabilidad del sistema completo, no del algoritmo.

## Consecuencias

El stack queda instalable y operable sin nube ni licencia, pero el primer build
necesita Internet para descargar el código fijado y los modelos deben obtenerse
por separado. La imagen aumenta de tamaño y el primer análisis puede superar el
objetivo de un segundo porque el CLI carga modelos por solicitud. Un servicio
persistente y PAD multiframe quedan como endurecimiento previo a producción.

## Evidencia necesaria antes de afirmar conformidad

- TDR/especificación RENIEC exacta, con versión y anexos.
- Ensayo independiente ISO/IEC 19795 con FMR, FNMR y Failure to Enrol/Acquire.
- Ensayo PAD ISO/IEC 30107-3 con nivel/PAI exigido.
- Perfil de imagen/intercambio solicitado (ISO/IEC 39794-5 o legado 19794-5).
- DPIA/evaluación de impacto, consentimiento/base legal, retención, cifrado,
  segregación de funciones y respuesta a incidentes conforme a Perú.

