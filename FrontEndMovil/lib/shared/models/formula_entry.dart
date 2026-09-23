/// `GET /api/mining/formulas` (ADR-187 del repo principal) — listado de
/// todas las fórmulas configuradas, con el último valor calculado. Forma
/// exacta no volcada campo a campo por la investigación de la API; se
/// parsea defensivamente y se ajusta en la primera integración real (ver
/// docs/decisions/0001 §Verificación).
class FormulaEntry {
  const FormulaEntry({
    required this.id,
    required this.sensorId,
    required this.sensorName,
    required this.expression,
    required this.outputChannel,
    this.lastValue,
    this.lastComputedAt,
    this.status,
  });

  final String id;
  final String sensorId;
  final String sensorName;
  final String expression;
  final String outputChannel;
  final double? lastValue;
  final DateTime? lastComputedAt;
  final String? status; // ok | error

  factory FormulaEntry.fromJson(Map<String, dynamic> json) => FormulaEntry(
        id: (json['id'] ?? json['formula_id'] ?? '').toString(),
        sensorId: (json['sensor_id'] ?? '').toString(),
        sensorName: (json['sensor_name'] ?? '') as String,
        expression: (json['expression'] ?? '') as String,
        outputChannel: (json['output_channel'] ?? json['channel'] ?? '') as String,
        lastValue: (json['last_value'] as num?)?.toDouble(),
        lastComputedAt: json['last_computed_at'] != null ? DateTime.tryParse(json['last_computed_at'] as String) : null,
        status: json['status'] as String?,
      );
}
