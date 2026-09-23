import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_repository.dart';
import 'auth_session.dart';

/// Refresh proactivo (ver docs/decisions/0003): cada 30s, y al volver del
/// background, renueva el access token si expira en menos de 120s — mismo
/// disparador que `authSessionManager.ts` del frontend web. Se instancia
/// una sola vez desde `main.dart` (bootstrap imperativo, no depende del
/// árbol de widgets porque debe correr durante toda la vida del proceso).
class AuthSessionManager with WidgetsBindingObserver {
  AuthSessionManager(this._container);

  final ProviderContainer _container;
  Timer? _timer;

  void start() {
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _maybeRefresh());
  }

  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _maybeRefresh();
  }

  Future<void> _maybeRefresh() async {
    final session = _container.read(authSessionControllerProvider);
    if (!session.isAuthenticated || !session.isExpiringSoon) return;
    final newToken = await _container.read(authRepositoryProvider).refreshAccessToken();
    if (newToken == null) {
      await _container.read(authSessionControllerProvider.notifier).clear();
    }
  }
}
