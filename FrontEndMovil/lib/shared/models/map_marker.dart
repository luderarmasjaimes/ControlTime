/// `GET /api/map/markers` — la investigación de la API confirmó el
/// endpoint (agregado de sensores/dispositivos/alarmas para el mapa) pero
/// no volcó el JSON exacto campo por campo; se parsea defensivamente con
/// los nombres más probables (consistentes con `MiningDevice`/`MiningAlarm`)
/// y se ajusta contra la respuesta real del backend en la primera prueba
/// de integración end-to-end (ver docs/decisions/0001, sección
/// Verificación).
class MapMarkerPoint {
  const MapMarkerPoint({
    required this.id,
    required this.lat,
    required this.lng,
    required this.label,
    required this.status,
    required this.kind,
  });

  final String id;
  final double lat;
  final double lng;
  final String label;
  final String status; // online | offline | alarm | unknown
  final String kind; // sensor | device | alarm

  factory MapMarkerPoint.fromJson(Map<String, dynamic> json) => MapMarkerPoint(
        id: (json['id'] ?? json['sensor_id'] ?? '').toString(),
        lat: (json['lat'] as num?)?.toDouble() ?? 0,
        lng: (json['lng'] as num?)?.toDouble() ?? 0,
        label: (json['label'] ?? json['name'] ?? json['sensor_name'] ?? '') as String,
        status: (json['status'] ?? json['connection_status'] ?? 'unknown') as String,
        kind: (json['kind'] ?? json['type'] ?? 'sensor') as String,
      );
}
