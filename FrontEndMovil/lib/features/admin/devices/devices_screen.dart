import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/i18n/i18n_provider.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/async_state_views.dart';
import '../../../shared/models/device.dart';
import 'devices_providers.dart';

class DevicesScreen extends ConsumerWidget {
  const DevicesScreen({super.key});

  Color _statusColor(String status) => switch (status) {
        'online' => AppColors.semanticLive,
        'offline' => AppColors.textDim,
        _ => AppColors.severityWarning,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(translationsProvider);
    final devicesAsync = ref.watch(devicesProvider);

    return devicesAsync.when(
      loading: () => LoadingView(label: t('common.loading')),
      error: (err, _) => ErrorRetryView(message: t('error.network'), onRetry: () => ref.invalidate(devicesProvider)),
      data: (devices) {
        if (devices.isEmpty) return EmptyStateView(message: t('common.noData'));
        return ListView.separated(
          padding: const EdgeInsets.all(AppSpacing.md),
          itemCount: devices.length,
          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
          itemBuilder: (context, index) => _DeviceCard(device: devices[index]),
        );
      },
    );
  }
}

class _DeviceCard extends ConsumerWidget {
  const _DeviceCard({required this.device});
  final MiningDevice device;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(translationsProvider);
    final color = switch (device.connectionStatus) {
      'online' => AppColors.semanticLive,
      'offline' => AppColors.textDim,
      _ => AppColors.severityWarning,
    };
    return Card(
      child: ListTile(
        leading: CircleAvatar(backgroundColor: color.withValues(alpha: 0.18), child: Icon(Icons.developer_board, color: color, size: 20)),
        title: Text(device.sensorName.isNotEmpty ? device.sensorName : device.sensorCode),
        subtitle: Text('${device.sensorType} · ${device.protocol}'),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(t('device.${device.connectionStatus}'), style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
            if (device.lastSeenAt != null)
              Text(DateFormat('dd/MM HH:mm').format(device.lastSeenAt!), style: const TextStyle(color: AppColors.textDim, fontSize: 11)),
          ],
        ),
      ),
    );
  }
}
