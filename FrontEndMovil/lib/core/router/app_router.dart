import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/login_screen.dart';
import '../../features/auth/splash_screen.dart';
import '../auth/auth_session.dart';
import '../widgets/app_shell.dart';

/// Router (ADR-0004): 3 estados posibles — restaurando sesión (splash),
/// autenticado (shell con Drawer+TabBar) o no autenticado (login). El
/// `refreshListenable` reacciona a cambios de `AuthSessionState` para que
/// el redirect se re-evalúe automáticamente en login/logout/expiración.
final routerRefreshProvider = Provider<GoRouterRefreshNotifier>((ref) {
  final notifier = GoRouterRefreshNotifier();
  ref.listen(authSessionControllerProvider, (_, __) => notifier.notify());
  ref.onDispose(notifier.dispose);
  return notifier;
});

class GoRouterRefreshNotifier extends ChangeNotifier {
  void notify() => notifyListeners();
}

final appRouterProvider = Provider<GoRouter>((ref) {
  final refresh = ref.watch(routerRefreshProvider);
  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final session = ref.read(authSessionControllerProvider);
      final atSplash = state.matchedLocation == '/splash';
      final atLogin = state.matchedLocation == '/login';

      if (session.restoring) return atSplash ? null : '/splash';
      if (!session.isAuthenticated) return atLogin ? null : '/login';
      if (atSplash || atLogin) return '/app';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (context, state) => const SplashScreen()),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(path: '/app', builder: (context, state) => const AppShell()),
    ],
  );
});
