import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_session.dart';
import '../../core/network/env.dart';
import '../../core/network/sse_client.dart';
import '../../shared/models/kpi.dart';

/// `GET /api/live/kpi` (SSE, ~2s) — a diferencia del navegador (limitado a
/// `EventSource` sin headers custom), el cliente nativo manda
/// `Authorization: Bearer` directamente (ver docs/decisions/0003 y el
/// informe de investigación de la API, §5.2).
class LiveKpiNotifier extends AutoDisposeNotifier<List<LiveKpiPoint>> {
  SseClient? _client;

  @override
  List<LiveKpiPoint> build() {
    final client = SseClient(
      url: '${AppEnv.apiBaseUrl}/api/live/kpi',
      getToken: () => ref.read(authSessionControllerProvider.notifier).currentToken,
    );
    _client = client;
    ref.onDispose(client.dispose);

    client.events.listen((json) {
      final list = (json['kpis'] as List<dynamic>? ?? []).map((e) => LiveKpiPoint.fromJson(e as Map<String, dynamic>)).toList();
      state = list;
    });
    client.start();
    return const [];
  }
}

final liveKpiProvider = AutoDisposeNotifierProvider<LiveKpiNotifier, List<LiveKpiPoint>>(LiveKpiNotifier.new);
