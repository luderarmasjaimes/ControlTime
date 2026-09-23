/// Forma verificada de `GET /api/mining/kpis` (ver docs/decisions — informe
/// de investigación de la API del backend).
class Kpi {
  const Kpi({
    required this.code,
    required this.category,
    required this.title,
    required this.unit,
    required this.currentValue,
    this.description,
    this.targetValue,
    this.trendDirection,
    this.trendPercent,
    this.statusColor,
    this.updatedAt,
  });

  final String code;
  final String category;
  final String title;
  final String? description;
  final String unit;
  final double currentValue;
  final double? targetValue;
  final String? trendDirection; // up | down | flat
  final double? trendPercent;
  final String? statusColor; // green | yellow | red
  final DateTime? updatedAt;

  factory Kpi.fromJson(Map<String, dynamic> json) => Kpi(
        code: json['code'] as String? ?? '',
        category: json['category'] as String? ?? '',
        title: json['title'] as String? ?? '',
        description: json['description'] as String?,
        unit: json['unit'] as String? ?? '',
        currentValue: (json['current_value'] as num?)?.toDouble() ?? 0,
        targetValue: (json['target_value'] as num?)?.toDouble(),
        trendDirection: json['trend_direction'] as String?,
        trendPercent: (json['trend_percent'] as num?)?.toDouble(),
        statusColor: json['status_color'] as String?,
        updatedAt: DateTime.tryParse(json['updated_at'] as String? ?? ''),
      );
}

/// Payload en vivo de `GET /api/live/kpi` (SSE, cada ~2s).
class LiveKpiPoint {
  const LiveKpiPoint({required this.name, required this.value, required this.unit, required this.category});

  final String name;
  final double value;
  final String unit;
  final String category;

  factory LiveKpiPoint.fromJson(Map<String, dynamic> json) => LiveKpiPoint(
        name: json['name'] as String? ?? '',
        value: (json['value'] as num?)?.toDouble() ?? 0,
        unit: json['unit'] as String? ?? '',
        category: json['category'] as String? ?? '',
      );
}
