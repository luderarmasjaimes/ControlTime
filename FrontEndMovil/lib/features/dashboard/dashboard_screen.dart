import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/i18n/i18n_provider.dart';
import '../../core/theme/tokens.dart';
import '../../core/widgets/async_state_views.dart';
import '../../shared/models/kpi.dart';
import 'data/dashboard_repository.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(translationsProvider);
    final kpisAsync = ref.watch(dashboardKpisProvider);

    return kpisAsync.when(
      loading: () => LoadingView(label: t('common.loading')),
      error: (err, _) => ErrorRetryView(
        message: t('error.network'),
        onRetry: () => ref.invalidate(dashboardKpisProvider),
      ),
      data: (kpis) {
        if (kpis.isEmpty) {
          return EmptyStateView(message: t('common.noData'));
        }
        return RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () async => ref.invalidate(dashboardKpisProvider),
          child: GridView.builder(
            padding: const EdgeInsets.all(AppSpacing.md),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              mainAxisSpacing: AppSpacing.md,
              crossAxisSpacing: AppSpacing.md,
              childAspectRatio: 1.15,
            ),
            itemCount: kpis.length,
            itemBuilder: (context, index) => _KpiCard(kpi: kpis[index]),
          ),
        );
      },
    );
  }
}

class _KpiCard extends ConsumerWidget {
  const _KpiCard({required this.kpi});
  final Kpi kpi;

  Color _statusColor() => switch (kpi.statusColor) {
        'green' => AppColors.semanticLive,
        'red' => AppColors.severityCritical,
        'yellow' => AppColors.severityWarning,
        _ => AppColors.textDim,
      };

  IconData _trendIcon() => switch (kpi.trendDirection) {
        'up' => Icons.trending_up,
        'down' => Icons.trending_down,
        _ => Icons.trending_flat,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(translationsProvider);
    final statusColor = _statusColor();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    kpi.title,
                    style: const TextStyle(color: AppColors.textDim, fontSize: 12),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Container(width: 8, height: 8, decoration: BoxDecoration(color: statusColor, shape: BoxShape.circle)),
              ],
            ),
            const Spacer(),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(
                  kpi.currentValue.toStringAsFixed(kpi.currentValue.truncateToDouble() == kpi.currentValue ? 0 : 1),
                  style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
                ),
                const SizedBox(width: 4),
                Text(kpi.unit, style: const TextStyle(color: AppColors.textDim, fontSize: 12)),
              ],
            ),
            if (kpi.trendPercent != null) ...[
              const SizedBox(height: 4),
              Row(
                children: [
                  Icon(_trendIcon(), size: 14, color: statusColor),
                  const SizedBox(width: 2),
                  Text('${kpi.trendPercent!.toStringAsFixed(1)}%', style: TextStyle(color: statusColor, fontSize: 12)),
                ],
              ),
            ],
            if (kpi.targetValue != null) ...[
              const SizedBox(height: 2),
              Text('${t('kpi.target')}: ${kpi.targetValue!.toStringAsFixed(1)}',
                  style: const TextStyle(color: AppColors.textDim, fontSize: 11)),
            ],
          ],
        ),
      ),
    );
  }
}
