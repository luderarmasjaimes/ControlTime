"""Proxy inverso de /api/ compartido por serve_http.py y serve_https.py.

ADR-107 (nota operativa 2026-08-18): Docker Desktop en Windows (backend WSL2)
NO publica los puertos de los contenedores hacia la IP de LAN del host --
`docker ps` muestra "0.0.0.0:5173->80/tcp" pero eso solo es alcanzable desde
`localhost`/`127.0.0.1` de ESTA maquina; otra PC de la red golpeando la IP de
LAN en el puerto 5173 nunca llega (confirmado: sin socket LISTENING real en
0.0.0.0:5173 a nivel del SO Windows, solo el proxy interno de Docker
Desktop que solo escucha loopback). Por eso NINGUNA pagina de prueba puede
depender de que el navegador llegue directo a un puerto publicado por Docker
desde otra PC -- ni el 8082 (backend, ya intencionalmente en loopback por
diseño) ni el 5173 (nginx, publicado "para LAN" pero en la practica
inalcanzable con esta configuracion de Docker Desktop).

La solucion (ya existente para HTTPS desde 2026-08-10, extendida ahora
tambien a HTTP): este script SI es un proceso nativo de Windows con un
socket real en 0.0.0.0 (confirmado con netstat), alcanzable desde cualquier
PC de la LAN. Sirve la pagina Y reenvia /api/* el mismo, conectandose el
BACKEND por loopback (127.0.0.1:8082, siempre alcanzable desde el propio
host sin importar la red) -- la pagina y el API quedan en el MISMO origen
para el navegador remoto, sin depender de que Docker publique nada hacia la
LAN.
"""
import http.client
import http.server
import os

DIR = os.path.dirname(os.path.abspath(__file__))
# 127.0.0.1 explicito, NO "localhost": resolver "localhost" en Windows suele
# intentar primero ::1 (IPv6) y esperar el timeout antes de caer a IPv4 --
# esto agregaba ~2s FIJOS a cada petición proxeada (medido: 0.22s directo al
# backend vs 2.3s a través de este proxy con "localhost").
BACKEND_HOST = os.environ.get("BACKEND_PROXY_HOST", "127.0.0.1")
BACKEND_PORT = int(os.environ.get("BACKEND_PROXY_PORT", "8082"))

# Headers que no se deben reenviar tal cual (hop-by-hop, o que el propio
# servidor HTTP recalcula solo -- reenviarlos rompe la respuesta).
_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
}


class ProxyingHandler(http.server.SimpleHTTPRequestHandler):
    def _proxy(self, method):
        conn = http.client.HTTPConnection(BACKEND_HOST, BACKEND_PORT, timeout=30)
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length) if length > 0 else None
            fwd_headers = {
                k: v for k, v in self.headers.items()
                if k.lower() not in _HOP_BY_HOP
            }
            conn.request(method, self.path, body=body, headers=fwd_headers)
            resp = conn.getresponse()
            resp_body = resp.read()

            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() in _HOP_BY_HOP:
                    continue
                # Un Set-Cookie por header (no se pueden combinar con coma).
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)
        except (ConnectionRefusedError, OSError) as exc:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            body = ('{"error":"backend_unreachable","detail":"%s"}' % exc).encode()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        finally:
            conn.close()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy("GET")
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self._proxy("POST")
        else:
            self.send_error(405)

    def do_OPTIONS(self):
        if self.path.startswith("/api/"):
            self._proxy("OPTIONS")
        else:
            self.send_error(405)


def make_server(port):
    # ThreadingHTTPServer, no HTTPServer: este servidor proxea /api/* -- cada
    # llamada a process_frame/status espera ~0.1-0.3s la respuesta del
    # backend. Con el HTTPServer plano (una conexión a la vez), esa espera
    # bloqueaba TODO lo demás -- la siguiente petición de captura no podía ni
    # empezar a procesarse hasta que la anterior terminara.
    os.chdir(DIR)
    return http.server.ThreadingHTTPServer(("0.0.0.0", port), ProxyingHandler)
