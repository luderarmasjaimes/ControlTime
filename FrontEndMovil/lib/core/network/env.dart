/// Configuración de entorno (ver docs/decisions/0001, sección "Entorno de
/// desarrollo"): el backend real solo es alcanzable a través de nginx
/// (`beemetry-web`, puerto host 5173), nunca directo al contenedor del
/// backend (bound a 127.0.0.1). Se prueba con un dispositivo físico Android
/// por USB (decisión del proyecto) — un dispositivo físico NO puede usar
/// `10.0.2.2` (ese alias solo existe dentro de un emulador) ni `localhost`
/// (resolvería al propio teléfono). Debe pasarse explícitamente la IP LAN
/// de la PC de desarrollo:
///
///   flutter run --dart-define=API_BASE_URL=http://192.168.1.50:5173
///
/// El valor por defecto es un placeholder que falla rápido y visiblemente
/// si se olvida pasar `--dart-define`, en vez de apuntar silenciosamente a
/// una dirección que nunca sería correcta para un dispositivo físico.
abstract final class AppEnv {
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://REEMPLAZAR-CON-IP-LAN-DEL-HOST:5173',
  );

  static String get wsBaseUrl => apiBaseUrl.replaceFirst('http', 'ws');
}
