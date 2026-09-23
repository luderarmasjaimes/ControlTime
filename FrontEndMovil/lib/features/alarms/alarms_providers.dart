import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_session.dart';
import '../../core/network/env.dart';
import '../../core/network/ws_client.dart';
import '../../shared/models/alarm.dart';
import 'data/alarms_repository.dart';

/// Carga inicial por REST + reconciliación live por `/ws` (ver
/// docs/decisions — informe de la API, §5.1): en vez de intentar
/// fusionar el payload parcial del evento WS con el modelo completo, se
/// vuelve a pedir la primera página por REST en cada evento — misma
/// garantía de consistencia que `alarmStream.ts`, más simple de mantener.
class AlarmsNotifier extends AutoDisposeAsyncNotifier<List<MiningAlarm>> {
  WsClient? _ws;

  @override
  Future<List<MiningAlarm>> build() async {
    ref.onDispose(() => _ws?.dispose());
    _ws ??= WsClient(url: '${AppEnv.wsBaseUrl}/ws')
      ..start(getToken: () => ref.read(authSessionControllerProvider.notifier).currentToken)
      ..messages.listen((_) => refresh());
    final page = await ref.read(alarmsRepositoryProvider).fetchAlarms(open: true, limit: 100);
    return page.alarms;
  }

  Future<void> refresh() async {
    final page = await ref.read(alarmsRepositoryProvider).fetchAlarms(open: true, limit: 100);
    state = AsyncData(page.alarms);
  }

  Future<void> acknowledge(String alarmId) async {
    await ref.read(alarmsRepositoryProvider).acknowledge(alarmId);
    await refresh();
  }
}

final alarmsProvider = AutoDisposeAsyncNotifierProvider<AlarmsNotifier, List<MiningAlarm>>(AlarmsNotifier.new);
