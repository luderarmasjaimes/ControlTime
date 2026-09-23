import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_repository.dart';
import 'auth_session.dart';

/// `GET /api/auth/permissions` justo tras login/refresh — únicamente para
/// ocultar/mostrar UI (ver docs/decisions/0003). El backend revalida cada
/// permiso de forma independiente; este provider nunca es la fuente de
/// autorización real.
final permissionsProvider = FutureProvider.autoDispose<PermissionsResult>((ref) async {
  final session = ref.watch(authSessionControllerProvider);
  if (!session.isAuthenticated) {
    return const PermissionsResult(role: 'operator', isAdmin: false, isOrganizationTenant: false, permissions: {});
  }
  // Se re-consulta si cambia el usuario/tenant (nueva sesión), no en cada rebuild de UI.
  ref.keepAlive();
  return ref.read(authRepositoryProvider).fetchPermissions();
});
