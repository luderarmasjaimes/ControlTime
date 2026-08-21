#!/usr/bin/env python3
"""Servidor estatico HTTP + proxy inverso de /api/ para external-api-test-page/, puerto 5190.

ADR-107 (nota operativa 2026-08-18): antes este puerto se servia con
`python -m http.server 5190` (solo archivos estaticos), y la pagina asumia
que podia llamar directo al backend publicado por Docker (puerto 8082,
loopback por diseño -- inalcanzable desde LAN a proposito) o, desde otra PC,
al frontend nginx publicado en el 5173. Ese segundo camino resulto NO
funcionar: Docker Desktop en Windows (backend WSL2) no expone sus puertos
publicados hacia la IP de LAN del host, solo hacia localhost/127.0.0.1 de
esta misma maquina -- `docker ps` dice "0.0.0.0:5173->80/tcp" pero no hay
ningun socket LISTENING real en esa direccion a nivel del SO (confirmado con
`netstat`). Otra PC de la red golpeando la IP de LAN en el puerto 5173
nunca llega, y el navegador lo reporta como el mismo "TypeError: Failed to
fetch" generico de un problema de CORS o mixed content.

Este script reemplaza esa estrategia por el mismo patron que ya usaba
serve_https.py para HTTPS: sirve la pagina Y reenvia /api/* el mismo,
conectandose al backend por loopback (127.0.0.1:8082, siempre alcanzable
desde el propio host sin importar la red). Al ser un proceso nativo de
Windows con un socket real en 0.0.0.0 (no un puerto publicado por Docker),
SI es alcanzable desde otra PC de la LAN. La pagina y el API quedan en el
mismo origen (http://<host>:5190) para cualquiera que la abra -- ver el
docstring completo de _proxy_common.py.

Uso: python serve_http.py [puerto]
"""
import sys

from _proxy_common import BACKEND_HOST, BACKEND_PORT, make_server

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5190

httpd = make_server(PORT)

print(f"Sirviendo esta carpeta en http://0.0.0.0:{PORT}")
print(f"Proxeando /api/* -> http://{BACKEND_HOST}:{BACKEND_PORT}")
httpd.serve_forever()
