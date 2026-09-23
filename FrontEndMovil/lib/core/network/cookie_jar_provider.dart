import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Placeholder — se sobreescribe en `main.dart` con un `PersistCookieJar`
/// real (requiere resolver un directorio async vía `path_provider` antes de
/// `runApp`, ver docs/decisions/0003). Transporta ÚNICAMENTE
/// `beemetry_refresh_token`/`beemetry_csrf_token`; ninguna otra llamada de
/// la app depende de este cookie jar.
final cookieJarProvider = Provider<CookieJar>((ref) {
  throw UnimplementedError('cookieJarProvider debe sobreescribirse en main.dart con un PersistCookieJar real.');
});
