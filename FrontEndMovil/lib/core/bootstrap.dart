import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth/auth_repository.dart';
import 'auth/auth_session.dart';
import 'network/api_client.dart';

/// Conecta los callbacks que no pueden pasarse por constructor sin crear un
/// ciclo de tipos entre providers (ver comentarios en api_client.dart y
/// auth_repository.dart). Se llama una sola vez, imperativamente, justo
/// después de crear el `ProviderContainer` en `main.dart` — antes de
/// `restoreSessionOnColdStart` y antes de `runApp`.
void wireAuthCallbacks(ProviderContainer container) {
  container.read(authInterceptorProvider).refreshCallback = () => container.read(authRepositoryProvider).refreshAccessToken();

  container.read(authRepositoryProvider).onTokenRefreshed = (token, expiresIn) {
    container.read(authSessionControllerProvider.notifier).updateTokens(accessToken: token, expiresInSeconds: expiresIn);
  };
}
