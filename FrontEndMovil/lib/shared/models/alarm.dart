/// Forma verificada de `GET /api/mining/alarms`.
class MiningAlarm {
  const MiningAlarm({
    required this.id,
    required this.ruleId,
    required this.ruleName,
    required this.triggeredAt,
    required this.observedValue,
    required this.severity,
    required this.message,
    required this.acknowledged,
    required this.resolved,
  });

  final String id;
  final String ruleId;
  final String ruleName;
  final DateTime triggeredAt;
  final double observedValue;
  final String severity; // info | warning | critical
  final String message;
  final bool acknowledged;
  final bool resolved;

  factory MiningAlarm.fromJson(Map<String, dynamic> json) => MiningAlarm(
        id: json['id'] as String? ?? '',
        ruleId: json['rule_id'] as String? ?? '',
        ruleName: json['rule_name'] as String? ?? '',
        triggeredAt: DateTime.tryParse(json['triggered_at'] as String? ?? '') ?? DateTime.now(),
        observedValue: (json['observed_value'] as num?)?.toDouble() ?? 0,
        severity: json['severity'] as String? ?? 'info',
        message: json['message'] as String? ?? '',
        acknowledged: json['acknowledged'] as bool? ?? false,
        resolved: json['resolved'] as bool? ?? false,
      );
}

class AlarmPage {
  const AlarmPage({required this.alarms, required this.total, required this.limit, required this.offset});

  final List<MiningAlarm> alarms;
  final int total;
  final int limit;
  final int offset;

  factory AlarmPage.fromJson(Map<String, dynamic> json) => AlarmPage(
        alarms: (json['alarms'] as List<dynamic>? ?? [])
            .map((e) => MiningAlarm.fromJson(e as Map<String, dynamic>))
            .toList(),
        total: json['total'] as int? ?? 0,
        limit: json['limit'] as int? ?? 50,
        offset: json['offset'] as int? ?? 0,
      );
}

/// Evento push de `/ws` (canal de alarmas) — ver docs/decisions (informe de
/// investigación de la API del backend, §5.1).
class AlarmWsEvent {
  const AlarmWsEvent({
    required this.event,
    required this.alarmId,
    required this.severity,
    required this.message,
    required this.observedValue,
  });

  final String event; // triggered | resolved
  final String alarmId;
  final String severity;
  final String message;
  final double observedValue;

  factory AlarmWsEvent.fromJson(Map<String, dynamic> json) => AlarmWsEvent(
        event: json['event'] as String? ?? '',
        alarmId: json['alarm_id']?.toString() ?? '',
        severity: json['severity'] as String? ?? 'info',
        message: json['message'] as String? ?? '',
        observedValue: (json['observed_value'] as num?)?.toDouble() ?? 0,
      );
}
