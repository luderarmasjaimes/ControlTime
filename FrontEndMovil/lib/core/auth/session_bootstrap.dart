import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_models.dart';
import 'auth_repository.dart';
import 'auth_session.dart';

/// Arranque en frío (ver docs/decisions/0003): si hay un "shell" de sesión
/// persistido (usuario/tenant/rol, sin token), se intenta un refresh
/// silencioso usando únicamente la cookie HttpOnly de refresh antes de
/// decidir login vs. dashboard — igual criterio que `App.tsx` del frontend
/// web. Se ejecuta una sola vez, imperativamente, antes de `runApp` (y
/// después de `wireAuthCallbacks`, ver core/bootstrap.dart).
Future<void> restoreSessionOnColdStart(ProviderContainer container) async {
  final controller = container.read(authSessionControllerProvider.notifier);
  final shellJson = await controller.loadPersistedShell();
  if (shellJson == null) {
    controller.markRestoreFailed();
    return;
  }

  controller.setUserForRestore(AuthUser.fromJson(shellJson));

  final token = await container.read(authRepositoryProvider).refreshAccessToken();
  if (token == null) {
    await controller.clear();
  }
}
