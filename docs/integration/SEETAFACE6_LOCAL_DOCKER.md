# SeetaFace6 local en Docker Linux — instalación, operación y conformidad

## Resultado y alcance real

Esta integración permite registro y verificación facial 1:1 completamente
locales usando SeetaFace6Open. Incluye detector, cinco puntos faciales,
anti-spoofing de un frame y plantilla normalizada de 1024 dimensiones. No se
conecta a RENIEC y no consulta servicios externos durante la operación.

No debe rotularse como “certificado RENIEC”, “ISO certificado” o “NIST
certificado”. Las normas técnicas describen formatos o métodos de ensayo; una
afirmación de conformidad necesita evidencia del producto/build y, cuando
corresponda, un laboratorio acreditado.

## Componentes y procedencia

| Componente | Uso | Procedencia fijada |
|---|---|---|
| SeetaFace6Open | detección, landmarks, PAD y reconocimiento | commit `a32e2faa0694c0f841ace4df9ead0407b78363c6` |
| Modelos SF6 | pesos `.csta` | archivo oficial `sf6.0_models.zip` |
| MediaPipe | postura, ojos, boca y captura guiada | sidecar existente |
| Backend C++ | orquestación, aislamiento por tenant y comparación 1:1 | SPEC-008 |

Repositorio oficial: <https://github.com/SeetaFace6Open/index>  
Licencia oficial: <https://github.com/SeetaFace6Open/index/blob/master/LICENSE>

SHA-256 esperado de `sf6.0_models.zip`:

```text
57D339895915B73F19B986F1DEF66EED8B51975E8B0E74EEB12C656277230800
```

## Requisitos de laptop

- Linux x86_64 o Docker Desktop/WSL2 con contenedores Linux.
- Docker Engine/Compose v2.
- CPU x86_64 con AVX/FMA recomendada; 4 núcleos y 8 GB RAM como mínimo
  práctico para compilar junto con el resto del stack.
- Aproximadamente 12 GB libres durante el build; los modelos ocupan ~300 MB.
- Internet solo en el primer build/descarga. La operación es offline.

## Preparar los modelos

El archivo oficial se obtiene desde el enlace Dropbox publicado en el README
del proyecto SeetaFace6. Debido a que Dropbox puede cambiar tokens de descarga,
se descarga manualmente y se valida criptográficamente antes de extraer.

Linux:

```bash
mkdir -p biometric-models/seetaface6
cd biometric-models/seetaface6
sha256sum sf6.0_models.zip
unzip -q sf6.0_models.zip
test -f sf3.0_models/face_detector.csta
test -f sf3.0_models/face_landmarker_pts5.csta
test -f sf3.0_models/face_recognizer.csta
test -f sf3.0_models/fas_first.csta
test -f sf3.0_models/fas_second.csta
```

PowerShell:

```powershell
Get-FileHash .\biometric-models\seetaface6\sf6.0_models.zip -Algorithm SHA256
Expand-Archive .\biometric-models\seetaface6\sf6.0_models.zip `
  -DestinationPath .\biometric-models\seetaface6 -Force
```

El directorio está ignorado por Git para evitar publicar pesos de 300 MB.
En esta estación los cinco modelos requeridos ya están presentes en
`biometric-models/seetaface6/sf3.0_models`. El ZIP se validó contra el hash
anterior antes de extraerlo y después se eliminó para recuperar espacio; no es
necesario conservarlo durante la operación.

## Construir y arrancar

```bash
cp .env.example .env
# completar todos los secretos obligatorios del compose
docker compose build ai_engine web
docker compose up -d ai_engine web
docker compose ps
```

Configuración recomendada para la prueba local:

```dotenv
BEEMETRY_BIOMETRIC_PROVIDER=seetaface6
BEEMETRY_SEETAFACE6_REQUIRED=true
BEEMETRY_SEETAFACE6_TIMEOUT_MS=20000
BEEMETRY_FACE_SEETAFACE6_COSINE_THRESHOLD=0.80
SEETAFACE6_MODEL_HOST_DIR=./biometric-models/seetaface6/sf3.0_models
```

`REQUIRED=true` evita degradar silenciosamente a un algoritmo más débil. Para
un entorno que solo quiera demostrar la UI puede ponerse `false`, pero no debe
usarse así en producción.

## Verificaciones técnicas

Estado del sidecar desde el host:

```bash
docker compose exec ai_engine curl -s http://localhost:5000/health
```

Debe mostrar:

```json
{
  "seetaface6": {
    "available": true,
    "provider": "seetaface6_local",
    "missing_models": [],
    "external_apis": false,
    "certification_claim": false
  }
}
```

Prueba directa de una imagen autorizada:

```bash
curl -s -F mode=verify -F image=@retrato-prueba.jpg \
  http://localhost:5000/seetaface_analyze
```

Una respuesta aceptada debe tener `pass:true`, `liveness.status:"real"` y
`dim:1024`. Una fotografía impresa, pantalla, imagen borrosa, cero/múltiples
rostros o fallo del motor debe producir `pass:false`.

## Matriz frente a estándares habitualmente solicitados

| Referencia | Qué cubre este código | Brecha para declarar conformidad |
|---|---|---|
| ICAO Doc 9303 / retrato frontal | captura guiada, iluminación, ojos y frontalidad | ensayo formal del proceso de captura y perfil exacto requerido |
| ISO/IEC 39794-5 / 19794-5 | puede conservar imagen y vector interno | no implementa todavía un registro facial interoperable certificado |
| ISO/IEC 29794-5:2025 | aplica controles propios de resolución, pose y nitidez | falta implementar y validar las métricas normalizadas de calidad facial |
| ISO/IEC 19795 | permite fijar umbral y medir score | falta campaña representativa e informe FMR/FNMR/FTE/FTA |
| ISO/IEC 30107-3 | anti-spoofing integrado y rechazo fail-closed | falta laboratorio externo, PAIs y nivel exigido; un frame no es nivel alto demostrado |
| ISO/IEC 24745 | procesamiento local y aislamiento existente | falta template protection cancelable, política de revocación y evaluación formal |
| ISO/IEC 27001/27701 | controles técnicos compatibles | certifican el SGSI/privacidad de la organización, no esta librería |
| NIST FRTE/FATE | ninguna afirmación | falta resultado público que identifique exactamente algoritmo/build |
| RENIEC | no hay conexión ni suplantación de servicio | contrastar contra TDR concreto y obtener aceptación/evidencia pedida |

La Resolución Jefatural RENIEC N.° 000097-2024/JNAC/RENIEC aprueba
especificaciones mínimas para dispositivos biométricos usados en la contratación
de servicios públicos de telecomunicaciones. Es un alcance sectorial y su anexo
no debe extrapolarse como una homologación facial universal. Para una compra o
licitación se debe usar el TDR y anexos exactos de ese procedimiento.

En Perú, las plantillas e imágenes usadas para identificar de manera única son
datos biométricos sensibles. La operación local reduce transferencias y
exposición, pero no sustituye consentimiento o base habilitante, información al
titular, medidas de seguridad, conservación limitada, derechos ARCO y evaluación
de impacto. El Reglamento de la Ley N.° 29733 aprobado por D.S. N.° 016-2024-JUS
está vigente desde el 31 de marzo de 2025.

## Plan mínimo de validación antes de producción

1. Congelar cámara, distancia, luz, versión de imagen, modelos y hashes.
2. Recolectar muestras consentidas y representativas de la población objetivo,
   separando entrenamiento/calibración/prueba.
3. Medir FMR, FNMR, FTE y FTA por sexo, edad, tono de piel, lentes y condiciones
   de campo; seleccionar umbral a partir del riesgo, no de una demo.
4. Ejecutar ataques con pantalla, impresión, replay, máscara 2D/3D y deepfake;
   contratar ensayo ISO/IEC 30107-3 si el TDR lo exige.
5. Agregar reto activo/multiframe para operaciones de alto riesgo.
6. Cifrar plantillas con clave gestionada fuera de la base de datos, rotación,
   auditoría de acceso, borrado verificable y plan de revocación.
7. Realizar DPIA legal peruana, consentimiento/base habilitante, aviso de
   privacidad, plazo de conservación y procedimiento ARCO.
8. Obtener aceptación escrita del dueño del TDR antes de afirmar cumplimiento.

## Limitaciones operativas actuales

- El CLI carga los modelos por solicitud: es seguro y simple, pero no alcanza
  de forma garantizada la meta `<1 s`. Un daemon persistente es el siguiente
  paso de rendimiento.
- PAD es pasivo y de un frame; no sustituye un reto activo ni un sensor de
  profundidad/IR.
- El umbral `0.80` es inicial y conservador, no una cifra certificada.
- Cambiar de InsightFace/Dermalog a Seeta exige reenrolar: las plantillas de
  algoritmos distintos no son interoperables.
