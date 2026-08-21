#!/usr/bin/env python3
"""Servidor estatico HTTPS + proxy inverso de /api/ para external-api-test-page/, puerto 5443.

Certificado autofirmado (certs/server.crt + certs/server.key, con SAN para
localhost/127.0.0.1/las IPs de LAN de esta maquina -- ver certs/openssl-san.cnf,
regenerar si la maquina cambia de red). El navegador SIEMPRE mostrara una
advertencia de "conexion no segura" al entrar la primera vez -- es
autofirmado, no de una CA publica. Hay que aceptarla manualmente una vez por
navegador/maquina. Es lo esperado para una herramienta de pruebas; no usar
este mismo certificado en produccion.

Por que proxea /api/: el backend real (BACKEND_HOST:BACKEND_PORT) solo habla
HTTP plano, sin variante HTTPS. Una pagina servida por HTTPS que intenta
llamar directo a un backend HTTP es bloqueada por el navegador como "mixed
content" -- un TypeError: Failed to fetch sin mas detalle, indistinguible a
simple vista de un problema de CORS. Proxeando /api/* a traves de este mismo
servidor HTTPS, la pagina y el API quedan en el MISMO origen
(https://<host>:5443), sin mixed content y sin necesitar CORS en absoluto
para ese camino. Este mismo mecanismo (ver _proxy_common.py) es tambien el
que hace que esta pagina SI sea alcanzable desde otra PC de la LAN, a
diferencia de los puertos publicados por Docker -- ver el docstring de
_proxy_common.py para el detalle completo (ADR-107).

Uso: python serve_https.py [puerto]
"""
import os
import ssl
import sys

from _proxy_common import DIR, BACKEND_HOST, BACKEND_PORT, make_server

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5443
CERT = os.path.join(DIR, "certs", "server.crt")
KEY = os.path.join(DIR, "certs", "server.key")

httpd = make_server(PORT)

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(certfile=CERT, keyfile=KEY)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

print(f"Sirviendo {DIR} en https://0.0.0.0:{PORT} (certificado autofirmado)")
print(f"Proxeando /api/* -> http://{BACKEND_HOST}:{BACKEND_PORT}")
httpd.serve_forever()
