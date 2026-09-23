import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/i18n_provider.dart';
import '../../core/theme/tokens.dart';
import '../../core/widgets/async_state_views.dart';
import 'kpis_operacion_providers.dart';

/// KPIs en vivo (ver docs/decisions/0003 — informe de investigación de la
/// API, §5.2): `mining_runtime_kpis` es un catálogo corporativo sin
/// partición por tenant, la sesión solo controla el acceso al stream — el
/// mismo comportamiento del backend real, no una limitación de esta app.
class KpisOperacionScreen extends ConsumerWidget {
  const KpisOperacionScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(translationsProvider);
    final points = ref.watch(liveKpiProvider);

    if (points.isEmpty) {
      return LoadingView(label: t('common.loading'));
    }

    final byCategory = <String, List<dynamic>>{};
    for (final p in points) {
      byCategory.putIfAbsent(p.category, () => []).add(p);
    }

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        for (final entry in byCategory.entries) ...[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            child: Text(entry.key, style: const TextStyle(color: AppColors.textDim, fontWeight: FontWeight.w600)),
          ),
          ...entry.value.map((p) => Card(
                child: ListTile(
                  title: Text(p.name as String),
                  trailing: Text('${(p.value as double).toStringAsFixed(1)} ${p.unit}',
                      style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.primary)),
                ),
              )),
        ],
      ],
    );
  }
}
