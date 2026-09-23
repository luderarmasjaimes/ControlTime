import 'dart:async';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';

/// Interceptor de autenticación (ver docs/decisions/0003):
/// - Agrega `Authorization: Bearer <token>` a toda request (vía [getToken]).
/// - En 401, dispara [refresh] una sola vez (deduplicado con un Future
///   compartido para no rotar el refresh token dos veces en una carrera de
///   varias requests fallando a la vez) y reintenta la request original.
/// - Nunca reintenta una request que YA es el propio refresh/logout, para
///   evitar recursión.
class AuthInterceptor extends Interceptor {
  AuthInterceptor({
    required this.dio,
    required this.getToken,
    required this.csrfCookieJar,
    required this.apiBaseUrl,
  });

  final Dio dio;
  final String? Function() getToken;
  final CookieJar csrfCookieJar;
  final String apiBaseUrl;

  /// Se asigna imperativamente tras construir el contenedor de providers
  /// (ver `core/bootstrap.dart`) — NO se pasa por constructor porque eso
  /// crearía un ciclo de tipos entre `apiClientProvider` y
  /// `authRepositoryProvider` (AuthRepository necesita el Dio de
  /// apiClientProvider; el interceptor de ese mismo Dio necesita poder
  /// llamar a AuthRepository.refreshAccessToken()).
  Future<String?> Function()? refreshCallback;

  Completer<String?>? _refreshInFlight;

  static const _noRetryPaths = ['/api/auth/refresh', '/api/auth/logout'];

  bool _isNoRetryPath(String path) => _noRetryPaths.any((p) => path.contains(p));

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = getToken();
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    final response = err.response;
    final requestPath = err.requestOptions.path;

    final refresh = refreshCallback;
    if (response?.statusCode != 401 || _isNoRetryPath(requestPath) || refresh == null) {
      handler.next(err);
      return;
    }

    final newToken = await _refreshOnce(refresh);
    if (newToken == null) {
      handler.next(err);
      return;
    }

    try {
      final retryOptions = err.requestOptions;
      retryOptions.headers['Authorization'] = 'Bearer $newToken';
      final retryResponse = await dio.fetch(retryOptions);
      handler.resolve(retryResponse);
    } on DioException catch (retryError) {
      handler.next(retryError);
    }
  }

  Future<String?> _refreshOnce(Future<String?> Function() refresh) {
    final inFlight = _refreshInFlight;
    if (inFlight != null) return inFlight.future;

    final completer = Completer<String?>();
    _refreshInFlight = completer;
    refresh().then((token) {
      completer.complete(token);
      _refreshInFlight = null;
    }).catchError((_) {
      completer.complete(null);
      _refreshInFlight = null;
    });
    return completer.future;
  }

  /// Lee el valor de la cookie CSRF de doble-submit (`beemetry_csrf_token`)
  /// del cookie jar, para agregarla como header `X-CSRF-Token` en
  /// `/api/auth/refresh` y `/api/auth/logout` — la única parte del backend
  /// que no acepta Bearer puro (ver docs/decisions/0003).
  Future<String?> readCsrfToken() async {
    final uri = Uri.parse(apiBaseUrl);
    final cookies = await csrfCookieJar.loadForRequest(uri);
    for (final cookie in cookies) {
      if (cookie.name == 'beemetry_csrf_token') return cookie.value;
    }
    return null;
  }
}
