import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/api_client.dart';
import 'auth_models.dart';

/// Excepción tipada para 2FA — la UI de login la captura para mostrar el
/// prompt de código en vez de tratarlo como un error genérico.
class MfaRequiredException implements Exception {
  MfaRequiredException(this.mfaToken);
  final String mfaToken;
}

/// Repositorio de autenticación (ver docs/decisions/0003): implementa el
/// contrato exacto verificado contra `backend/src/auth/*` y
/// `backend/src/main.cpp` del repo principal — no la implementación del
/// navegador. Bearer puro para todo salvo refresh/logout (cookie + CSRF).
class AuthRepository {
  AuthRepository(this._dio, this._readCsrfToken);

  final Dio _dio;
  final Future<String?> Function() _readCsrfToken;

  Future<Map<String, dynamic>> checkIdentity({required String company, required String identity}) async {
    final response = await _dio.post('/api/auth/login/check-identity', data: {
      'company': company,
      'identity': identity,
    });
    return response.data as Map<String, dynamic>;
  }

  Future<LoginResult> loginWithPassword({
    required String company,
    required String identityLogin,
    required String username,
    required String password,
    Map<String, dynamic>? location,
  }) async {
    final response = await _dio.post('/api/auth/login/password', data: {
      'company': company,
      'identity_login': identityLogin,
      'username': username,
      'password': password,
      if (location != null) 'location': location,
    });
    return _parseLoginResponse(response.data as Map<String, dynamic>);
  }

  Future<LoginResult> loginWithMfa({required String mfaToken, required String code}) async {
    final response = await _dio.post('/api/auth/login/mfa', data: {
      'mfa_token': mfaToken,
      'code': code,
    });
    return _parseLoginResponse(response.data as Map<String, dynamic>);
  }

  /// [faceImageBase64] sin el prefijo `data:image/jpeg;base64,` — ver
  /// docs/decisions/0003 sobre el formato exacto de wire.
  Future<LoginResult> loginWithFace({
    required String company,
    required String identityLogin,
    required String username,
    required String faceImageBase64,
    required String captureSessionId,
    Map<String, dynamic>? location,
  }) async {
    final response = await _dio.post(
      '/api/auth/login/face',
      data: {
        'company': company,
        'identity_login': identityLogin,
        'username': username,
        'face_image_base64': faceImageBase64,
        if (location != null) 'location': location,
      },
      options: Options(headers: {'X-Capture-Session-Id': captureSessionId}),
    );
    return _parseLoginResponse(response.data as Map<String, dynamic>);
  }

  Future<LoginResult> register({
    required String company,
    required String firstName,
    required String lastName,
    required String dni,
    required String username,
    required String password,
    required String faceImageBase64,
    required String captureSessionId,
    String? role,
    String? ruc,
    String? phone,
    String? mobile,
    String? email,
    String? facePortraitOvalBase64,
    String? faceBustRectBase64,
  }) async {
    final response = await _dio.post(
      '/api/auth/register',
      data: {
        'company': company,
        'first_name': firstName,
        'last_name': lastName,
        'dni': dni,
        'username': username,
        'password': password,
        'face_image_base64': faceImageBase64,
        if (role != null) 'role': role,
        if (ruc != null) 'ruc': ruc,
        if (phone != null) 'phone': phone,
        if (mobile != null) 'mobile': mobile,
        if (email != null) 'email': email,
        if (facePortraitOvalBase64 != null) 'face_portrait_oval_base64': facePortraitOvalBase64,
        if (faceBustRectBase64 != null) 'face_bust_rect_base64': faceBustRectBase64,
      },
      options: Options(
        headers: {'X-Capture-Session-Id': captureSessionId},
        sendTimeout: const Duration(seconds: 120),
        receiveTimeout: const Duration(seconds: 120),
      ),
    );
    return _parseLoginResponse(response.data as Map<String, dynamic>);
  }

  Future<Map<String, bool>> checkDniAvailability(String dni) async {
    try {
      final response = await _dio.post('/api/auth/register/check-dni', data: {'dni': dni});
      return {'exists': (response.data as Map<String, dynamic>)['exists'] as bool? ?? false};
    } catch (_) {
      return {'exists': false}; // fail-open, igual que el frontend web
    }
  }

  Future<Map<String, bool>> checkUsernameAvailability({required String company, required String username}) async {
    try {
      final response = await _dio.post('/api/auth/register/check-username', data: {
        'company': company,
        'username': username,
      });
      return {'exists': (response.data as Map<String, dynamic>)['exists'] as bool? ?? false};
    } catch (_) {
      return {'exists': false};
    }
  }

  LoginResult _parseLoginResponse(Map<String, dynamic> data) {
    if (data['status'] == 'mfa_required') {
      throw MfaRequiredException(data['mfa_token'] as String);
    }
    final userJson = data['user'] as Map<String, dynamic>;
    final user = AuthUser.fromJson(userJson);
    return LoginResult.success(
      user,
      accessToken: userJson['access_token'] as String,
      expiresIn: userJson['expires_in'] as int,
    );
  }

  /// Solo necesita la cookie HttpOnly `beemetry_refresh_token` (adjuntada
  /// automáticamente por el CookieManager de Dio) + el header CSRF de
  /// doble-submit — nunca envía ni recibe el refresh token en el body.
  /// Devuelve `null` en fallo (sesión inválida o error transitorio de red;
  /// ver AuthInterceptor, que no distingue los dos casos al reintentar).
  Future<String?> refreshAccessToken() async {
    try {
      final csrf = await _readCsrfToken();
      final response = await _dio.post(
        '/api/auth/refresh',
        options: Options(headers: {if (csrf != null) 'X-CSRF-Token': csrf}),
      );
      final data = response.data as Map<String, dynamic>;
      final token = data['access_token'] as String;
      onTokenRefreshed?.call(token, data['expires_in'] as int);
      return token;
    } catch (_) {
      return null;
    }
  }

  /// Inyectado desde afuera (ver providers.dart) para no crear un ciclo
  /// AuthRepository → AuthSessionController → AuthInterceptor → AuthRepository.
  void Function(String accessToken, int expiresIn)? onTokenRefreshed;

  Future<void> logout() async {
    try {
      final csrf = await _readCsrfToken();
      await _dio.post(
        '/api/auth/logout',
        options: Options(headers: {if (csrf != null) 'X-CSRF-Token': csrf}),
      );
    } catch (_) {
      // Best-effort — el estado local se limpia igual (ver AuthSessionController.clear()).
    }
  }

  Future<PermissionsResult> fetchPermissions() async {
    final response = await _dio.get('/api/auth/permissions');
    final data = response.data as Map<String, dynamic>;
    return PermissionsResult(
      role: data['role'] as String? ?? 'operator',
      isAdmin: data['is_admin'] as bool? ?? false,
      isOrganizationTenant: data['is_organization_tenant'] as bool? ?? false,
      permissions: (data['permissions'] as List<dynamic>? ?? []).cast<String>().toSet(),
    );
  }
}

class PermissionsResult {
  const PermissionsResult({
    required this.role,
    required this.isAdmin,
    required this.isOrganizationTenant,
    required this.permissions,
  });

  final String role;
  final bool isAdmin;
  final bool isOrganizationTenant;
  final Set<String> permissions;

  bool has(String code) => isAdmin || permissions.contains(code);
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final dio = ref.watch(apiClientProvider);
  final repo = AuthRepository(
    dio,
    () => ref.read(authInterceptorProvider).readCsrfToken(),
  );
  return repo;
});
