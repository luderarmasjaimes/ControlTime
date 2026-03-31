**Despliegue en Linux (Docker)**

Requisitos:
- Docker instalado
- docker-compose v2 o Docker Compose plug-in
- Acceso a Docker Hub (si usa imágenes públicas)

1) Variables y secretos
- Configure `DOCKERHUB_USERNAME` y `DOCKERHUB_TOKEN` (o use secretos de GitHub para CI).
1) Variables y secretos
- Para publicar en Docker Hub: configure `DOCKERHUB_USERNAME` y `DOCKERHUB_TOKEN` (o use secretos de GitHub para CI).
- Alternativa (sin Docker Hub): publicar en GitHub Container Registry (GHCR) usando `GITHUB_TOKEN`. El workflow ya está configurado para publicar a `ghcr.io/<tu_organizacion>` sin secretos adicionales.

2) Construir y publicar (local)
```bash
chmod +x scripts/ci/build_and_push.sh
export DOCKERHUB_USERNAME=tu_usuario
export DOCKERHUB_TOKEN=tu_token
./scripts/ci/build_and_push.sh
```

3) Desplegar con `docker-compose` (producción usando imágenes publicadas)
```bash
# en el host Linux
export IMAGE_REGISTRY=ghcr.io
export IMAGE_NAMESPACE=yourorg # cambia por tu usuario/organización en GHCR
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d
```
Nota: puedes automatizar la detección del owner del repo ejecutando el script incluido:

```bash
chmod +x scripts/ci/auto_set_namespace.sh
./scripts/ci/auto_set_namespace.sh
# luego:
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d
```
El `Makefile` ejecuta este script automáticamente en `make deploy`.

4) Supervisión y reinicio
- Logs: `docker-compose -f docker-compose.prod.yml logs -f`
- Reiniciar servicio: `docker-compose -f docker-compose.prod.yml restart web`

5) (Opcional) Systemd unit para iniciar en arranque
Crear `/etc/systemd/system/informe.service` con:
```
[Unit]
Description=Informe Cliente Docker Compose
Requires=docker.service
After=docker.service

[Service]
WorkingDirectory=/path/to/your/repo
ExecStart=/usr/bin/docker-compose -f /path/to/your/repo/docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker-compose -f /path/to/your/repo/docker-compose.prod.yml down
Restart=always

[Install]
WantedBy=multi-user.target
```
Luego:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now informe.service
```

**Despliegue local usando imágenes locales (sin publicar)**

Si quieres probar el despliegue en un host local y ya has construido las imágenes localmente,
asegúrate de usar las mismas etiquetas que `docker-compose.prod.yml` espera.

```bash
# construir imágenes localmente y etiquetarlas para GHCR (ejemplo):
docker build -t ghcr.io/yourorg/informe-backend:latest ./backend
docker build -t ghcr.io/yourorg/informe-frontend:latest ./frontend

# forzar que compose use esas imágenes locales estableciendo las variables:
export IMAGE_REGISTRY=ghcr.io
export IMAGE_NAMESPACE=yourorg
docker-compose -f docker-compose.prod.yml up -d

# ver logs y estado:
docker-compose -f docker-compose.prod.yml ps
docker-compose -f docker-compose.prod.yml logs -f
```

6) Recomendaciones de rendimiento
- Usar imágenes multi-stage (ya aplicado para backend).
- Limitar recursos en producción (memoria/CPU) vía `deploy.resources` o mecanismos del orquestador.
- Mantener el host con swap deshabilitado y suficiente RAM para los procesos.
- Monitorizar con Prometheus/Grafana o similar.

8) Publicar en GHCR desde local (opcional)

Si quieres publicar desde tu máquina local a GHCR en lugar de Docker Hub:

```bash
# necesitarás un PAT o usar tu GITHUB_TOKEN
export GITHUB_ACTOR=tu_usuario_github
export GITHUB_TOKEN=tu_token
chmod +x scripts/ci/build_and_push.sh
./scripts/ci/build_and_push.sh
```

El script detecta `DOCKERHUB_*` primero y luego `GITHUB_*` como fallback.

7) Comandos útiles (Makefile)

Si quieres simplificar tareas locales, usa el `Makefile`:

 - `make build` : construye imágenes locales `informe-backend:local` y `informe-frontend:local`.
 - `make up` : arranca el stack local con `docker-compose up -d --build`.
 - `make smoke` : ejecuta `scripts/ci/smoke_test.sh` para pruebas rápidas.
 - `make push` : construye y publica imágenes a Docker Hub (usa `scripts/ci/build_and_push.sh`).
 - `make deploy` : despliega usando `docker-compose.prod.yml` (usa imágenes públicas en Docker Hub).

Ejemplo (Linux):
```bash
# construir y levantar localmente
make build
make up
# esperar algunos segundos para que arranquen servicios
make smoke
```

