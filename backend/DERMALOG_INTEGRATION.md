# Dermalog Face SDK Integration (Docker)

Este backend soporta validacion biometrica con proveedor `dermalog_cli`.

## Objetivo de calidad biometrica

En modo Dermalog, el backend delega al SDK/CLI la evaluacion de calidad facial para registro y validacion,
incluyendo controles como:

- iluminacion adecuada
- ojos abiertos
- boca cerrada
- sin gestos
- sin lentes o accesorios que obstruyan
- sin gorra/sombrero
- visibilidad frontal suficiente
- calidad general apta para cumplimiento normativo

## Montaje de SDK en Docker

Se configuro `docker-compose.yml` para montar el SDK desde host:

- Host dir: `${DERMALOG_SDK_HOST_DIR}`
- Container dir: `/opt/dermalog-sdk`

En Windows PowerShell (ruta que indicaste):

```powershell
$env:DERMALOG_SDK_HOST_DIR = 'C:/dermalog/dermalog-face-sdk-deb_6.11.0_amd64'
docker-compose up -d --build web
```

El entrypoint del backend instala automaticamente todos los `*.deb` que encuentre en `/opt/dermalog-sdk`.

## Variables de entorno activas

- `BIOMETRIC_PROVIDER=dermalog_cli`
- `DERMALOG_REQUIRED=true`
- `DERMALOG_CLI_PATH=/opt/dermalog-sdk/bin/dermalog-face-cli`
- `DERMALOG_SDK_DIR=/opt/dermalog-sdk`

Si `DERMALOG_REQUIRED=true` y el CLI no esta disponible, el backend rechazara el flujo facial por calidad/proveedor no disponible.

## Contrato esperado del CLI

El backend ejecuta:

```bash
<DERMALOG_CLI_PATH> --input <image.jpg> --mode <register|verify> --output-json <result.json>
```

Y espera `result.json` con estructura:

```json
{
  "pass": true,
  "quality": {
    "score": 0.95,
    "issues": []
  },
  "template": [0.01, 0.23, 0.44]
}
```

Reglas de aceptacion:

- `pass = true`
- `template` numerico con longitud >= 100
- `quality.issues` vacio para aprobacion plena

## Payload frontend/backend

Registro/Login facial acepta ahora:

- `face_image_base64` (JPEG base64, sin prefijo data URL)
- o `face_template` (compatibilidad legacy)

La UI ya envia `face_image_base64` automaticamente al capturar desde camara.
