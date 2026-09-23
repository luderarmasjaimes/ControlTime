import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'auth_models.dart';

const _secureStorageSessionKey = 'beemetry_session_shell_v1';

/// Estado de sesión en memoria: el access token NUNCA se persiste (ver
/// docs/decisions/0003 / ADR-132 del repo principal) — solo vive en este
/// campo mientras el proceso está vivo. `sessionShell` (usuario/tenant/rol,
/// sin token) sí se persiste para poder mostrar "restaurando sesión…" y
/// decidir login vs. dashboard al arrancar en frío.
class AuthSessionState {
  const AuthSessionState({this.accessToken, this.accessTokenExpiresAt, this.user, this.restoring = true});

  final String? accessToken;
  final DateTime? accessTokenExpiresAt;
  final AuthUser? user;
  final bool restoring;

  bool get isAuthenticated => accessToken != null && user != null;

  bool get isExpiringSoon {
    final expiry = accessTokenExpiresAt;
    if (expiry == null) return true;
    return DateTime.now().isAfter(expiry.subtract(const Duration(seconds: 120)));
  }

  AuthSessionState copyWith({
    String? accessToken,
    DateTime? accessTokenExpiresAt,
    AuthUser? user,
    bool? restoring,
  }) =>
      AuthSessionState(
        accessToken: accessToken ?? this.accessToken,
        accessTokenExpiresAt: accessTokenExpiresAt ?? this.accessTokenExpiresAt,
        user: user ?? this.user,
        restoring: restoring ?? this.restoring,
      );
}

class AuthSessionController extends Notifier<AuthSessionState> {
  static const _secureStorage = FlutterSecureStorage();

  @override
  AuthSessionState build() {
    return const AuthSessionState(restoring: true);
  }

  /// Token en memoria — leído por AuthInterceptor en cada request. No usar
  /// `ref.read(authSessionControllerProvider).accessToken` desde fuera de
  /// Riverpod-aware code; este getter es para el interceptor de Dio, que no
  /// participa del árbol de widgets.
  String? get currentToken => state.accessToken;

  /// Aplica el usuario persistido ANTES de intentar el refresh silencioso
  /// de arranque en frío (ver session_bootstrap.dart) — así, si el refresh
  /// tiene éxito, `updateTokens` (que no toca `user`) deja el estado ya
  /// completo sin otro paso intermedio.
  void setUserForRestore(AuthUser user) {
    state = state.copyWith(user: user, restoring: true);
  }

  Future<Map<String, dynamic>?> loadPersistedShell() async {
    final raw = await _secureStorage.read(key: _secureStorageSessionKey);
    if (raw == null) return null;
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  Future<void> applySession(AuthUser user, {required String accessToken, required int expiresInSeconds}) async {
    state = AuthSessionState(
      accessToken: accessToken,
      accessTokenExpiresAt: DateTime.now().add(Duration(seconds: expiresInSeconds)),
      user: user,
      restoring: false,
    );
    await _secureStorage.write(key: _secureStorageSessionKey, value: jsonEncode(user.toJson()));
  }

  /// Llamado tras un refresh exitoso — actualiza solo el token/expiración,
  /// nunca reescribe el usuario (igual que `updateSessionTokens` en
  /// authStorage.ts del frontend web).
  void updateTokens({required String accessToken, required int expiresInSeconds}) {
    state = state.copyWith(
      accessToken: accessToken,
      accessTokenExpiresAt: DateTime.now().add(Duration(seconds: expiresInSeconds)),
      restoring: false,
    );
  }

  void markRestoreFailed() {
    state = const AuthSessionState(restoring: false);
  }

  void updateAvatar(String avatarBase64) {
    final user = state.user;
    if (user == null) return;
    state = state.copyWith(user: user.copyWith(avatarCartoonBase64: avatarBase64));
  }

  Future<void> clear() async {
    state = const AuthSessionState(restoring: false);
    await _secureStorage.delete(key: _secureStorageSessionKey);
  }
}

final authSessionControllerProvider = NotifierProvider<AuthSessionController, AuthSessionState>(
  AuthSessionController.new,
);
