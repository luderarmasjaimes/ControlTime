import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_session.dart';
import 'auth_interceptor.dart';
import 'cookie_jar_provider.dart';
import 'env.dart';

/// Cliente Dio único de la app (ver docs/decisions/0003): CookieManager
/// captura/adjunta `beemetry_refresh_token`/`beemetry_csrf_token` en
/// `/api/auth/*`; AuthInterceptor agrega `Authorization: Bearer` a todo y
/// maneja el ciclo 401→refresh→retry. `AuthInterceptor.refreshCallback` se
/// deja sin asignar aquí a propósito — asignarlo a `ref.read(authRepositoryProvider)...`
/// crearía un ciclo de tipos en tiempo de análisis (AuthRepository necesita
/// el Dio de este mismo provider). Se conecta imperativamente en
/// `core/bootstrap.dart`, una sola vez, tras construir el contenedor.
final apiClientProvider = Provider<Dio>((ref) {
  final cookieJar = ref.watch(cookieJarProvider);

  final dio = Dio(BaseOptions(
    baseUrl: AppEnv.apiBaseUrl,
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 30),
  ));

  dio.interceptors.add(CookieManager(cookieJar));

  final authInterceptor = AuthInterceptor(
    dio: dio,
    apiBaseUrl: AppEnv.apiBaseUrl,
    csrfCookieJar: cookieJar,
    getToken: () => ref.read(authSessionControllerProvider.notifier).currentToken,
  );
  dio.interceptors.add(authInterceptor);

  ref.onDispose(() => dio.close(force: true));
  return dio;
});

/// Expone el mismo [AuthInterceptor] para que AuthRepository pueda leer el
/// token CSRF vigente al llamar `/api/auth/refresh` y `/api/auth/logout`.
final authInterceptorProvider = Provider<AuthInterceptor>((ref) {
  final dio = ref.watch(apiClientProvider);
  for (final interceptor in dio.interceptors) {
    if (interceptor is AuthInterceptor) return interceptor;
  }
  throw StateError('AuthInterceptor no está registrado en apiClientProvider.');
});
