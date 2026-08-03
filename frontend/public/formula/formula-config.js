// Config compartida de las páginas FORMULA (index/analisis/three_view).
// Antes esto era un <script> inline en cada HTML, pero el CSP de la
// plataforma (script-src 'self', sin 'unsafe-inline' — ver frontend/nginx.conf
// y router.cpp::applySecurityHeaders) bloquea scripts inline, dejando el
// prefijo undefined y rompiendo TODAS las llamadas del editor (/api/* iba al
// backend principal en vez de /formula-api/* al motor FORMULA).
window.FORMULA_API_PREFIX = '/formula-api';
