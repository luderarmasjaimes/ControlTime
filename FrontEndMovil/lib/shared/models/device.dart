/// Forma verificada de `GET /api/mining/devices`.
class MiningDevice {
  const MiningDevice({
    required this.sensorId,
    required this.sensorCode,
    required this.sensorName,
    required this.sensorType,
    required this.protocol,
    required this.connectionStatus,
    this.lastSeenAt,
    required this.revoked,
    required this.hasCredential,
    this.unit,
    this.zoneId,
    this.lat,
    this.lng,
    this.label,
    this.serialNumber,
    this.externalId,
  });

  final String sensorId;
  final String sensorCode;
  final String sensorName;
  final String sensorType;
  final String protocol;
  final String connectionStatus; // unknown | online | offline
  final DateTime? lastSeenAt;
  final bool revoked;
  final bool hasCredential;
  final String? unit;
  final int? zoneId;
  final double? lat;
  final double? lng;
  final String? label;
  final String? serialNumber;
  final String? externalId;

  factory MiningDevice.fromJson(Map<String, dynamic> json) => MiningDevice(
        sensorId: json['sensor_id'] as String? ?? '',
        sensorCode: json['sensor_code'] as String? ?? '',
        sensorName: json['sensor_name'] as String? ?? '',
        sensorType: json['sensor_type'] as String? ?? '',
        protocol: json['protocol'] as String? ?? '',
        connectionStatus: json['connection_status'] as String? ?? 'unknown',
        lastSeenAt: json['last_seen_at'] != null ? DateTime.tryParse(json['last_seen_at'] as String) : null,
        revoked: json['revoked'] as bool? ?? false,
        hasCredential: json['has_credential'] as bool? ?? false,
        unit: json['unit'] as String?,
        zoneId: json['zone_id'] as int?,
        lat: (json['lat'] as num?)?.toDouble(),
        lng: (json['lng'] as num?)?.toDouble(),
        label: json['label'] as String?,
        serialNumber: json['serial_number'] as String?,
        externalId: json['external_id'] as String?,
      );
}

/// `GET /api/sensors/data` — payload compuesto legado usado por el
/// dashboard de Sensores Técnicos.
class SensorReading {
  const SensorReading({required this.sensorId, required this.value, required this.timestamp});

  final int sensorId;
  final double value;
  final DateTime timestamp;

  factory SensorReading.fromJson(Map<String, dynamic> json) => SensorReading(
        sensorId: json['sensor_id'] as int? ?? 0,
        value: (json['value'] as num?)?.toDouble() ?? 0,
        timestamp: DateTime.tryParse(json['timestamp'] as String? ?? '') ?? DateTime.now(),
      );
}
