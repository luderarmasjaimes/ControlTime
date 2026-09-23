import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/i18n/i18n_provider.dart';
import '../../core/theme/tokens.dart';
import '../../core/widgets/async_state_views.dart';
import '../../shared/models/alarm.dart';
import 'alarms_providers.dart';

class AlarmsScreen extends ConsumerWidget {
  const AlarmsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(translationsProvider);
    final alarmsAsync = ref.watch(alarmsProvider);

    return alarmsAsync.when(
      loading: () => LoadingView(label: t('common.loading')),
      error: (err, _) => ErrorRetryView(
        message: t('error.network'),
        onRetry: () => ref.invalidate(alarmsProvider),
      ),
      data: (alarms) {
        if (alarms.isEmpty) {
          return EmptyStateView(message: t('alarm.empty'), icon: Icons.notifications_off_outlined);
        }
        return RefreshIndicator(
          onRefresh: () => ref.read(alarmsProvider.notifier).refresh(),
          color: AppColors.primary,
          child: ListView.separated(
            padding: const EdgeInsets.all(AppSpacing.md),
            itemCount: alarms.length,
            separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
            itemBuilder: (context, index) => _AlarmCard(alarm: alarms[index]),
          ),
        );
      },
    );
  }
}

class _AlarmCard extends ConsumerWidget {
  const _AlarmCard({required this.alarm});
  final MiningAlarm alarm;

  Color _severityColor() => switch (alarm.severity) {
        'critical' => AppColors.severityCritical,
        'warning' => AppColors.severityWarning,
        _ => AppColors.severityInfo,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(translationsProvider);
    final color = _severityColor();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(width: 4, height: 48, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text(alarm.ruleName, style: const TextStyle(fontWeight: FontWeight.w600))),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(color: color.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(6)),
                        child: Text(t('alarm.severity.${alarm.severity}'), style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(alarm.message, style: const TextStyle(color: AppColors.textDim, fontSize: 13)),
                  const SizedBox(height: 4),
                  Text(DateFormat('dd/MM/yyyy HH:mm').format(alarm.triggeredAt),
                      style: const TextStyle(color: AppColors.textDim, fontSize: 11)),
                  if (!alarm.acknowledged) ...[
                    const SizedBox(height: AppSpacing.sm),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: () => ref.read(alarmsProvider.notifier).acknowledge(alarm.id),
                        child: Text(t('alarm.acknowledge')),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
