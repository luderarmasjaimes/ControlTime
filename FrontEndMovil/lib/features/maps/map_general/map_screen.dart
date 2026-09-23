import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_marker_cluster/flutter_map_marker_cluster.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/i18n/i18n_provider.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/async_state_views.dart';
import '../../../shared/models/map_marker.dart';
import '../data/map_repository.dart';

const _defaultCenter = LatLng(-9.19, -75.02); // centro aproximado del Perú, fallback sin ubicación de empresa

class MapScreen extends ConsumerWidget {
  const MapScreen({super.key});

  Color _statusColor(String status) => switch (status) {
        'online' => AppColors.semanticLive,
        'alarm' => AppColors.severityCritical,
        'offline' => AppColors.textDim,
        _ => AppColors.severityInfo,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(translationsProvider);
    final markersAsync = ref.watch(mapMarkersProvider);

    return markersAsync.when(
      loading: () => LoadingView(label: t('common.loading')),
      error: (err, _) => ErrorRetryView(message: t('error.network'), onRetry: () => ref.invalidate(mapMarkersProvider)),
      data: (points) {
        final center = points.isNotEmpty ? LatLng(points.first.lat, points.first.lng) : _defaultCenter;
        return FlutterMap(
          options: MapOptions(initialCenter: center, initialZoom: points.isEmpty ? 5.5 : 12),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'net.beemetry.frontend_movil',
            ),
            MarkerClusterLayerWidget(
              options: MarkerClusterLayerOptions(
                maxClusterRadius: 45,
                size: const Size(40, 40),
                markers: [
                  for (final point in points)
                    Marker(
                      point: LatLng(point.lat, point.lng),
                      width: 36,
                      height: 36,
                      child: GestureDetector(
                        onTap: () => _showMarkerDetail(context, point),
                        child: Icon(Icons.location_on, color: _statusColor(point.status), size: 36),
                      ),
                    ),
                ],
                builder: (context, markers) => CircleAvatar(
                  backgroundColor: AppColors.primary,
                  child: Text('${markers.length}', style: const TextStyle(color: Colors.white, fontSize: 12)),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  void _showMarkerDetail(BuildContext context, MapMarkerPoint point) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.bgSidebar,
      builder: (context) => Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(point.label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text('${point.kind} · ${point.status}', style: const TextStyle(color: AppColors.textDim)),
          ],
        ),
      ),
    );
  }
}
