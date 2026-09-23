import 'package:geolocator/geolocator.dart';

/// Ubicación best-effort en login/registro (ver docs/decisions/0003) —
/// nunca bloquea el flujo ni exige permiso; mismo criterio que
/// `geolocation.ts` del frontend web.
Future<Map<String, dynamic>?> bestEffortLocation({Duration timeout = const Duration(seconds: 4)}) async {
  try {
    final permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      final requested = await Geolocator.requestPermission();
      if (requested == LocationPermission.denied || requested == LocationPermission.deniedForever) return null;
    }
    if (permission == LocationPermission.deniedForever) return null;

    final position = await Geolocator.getCurrentPosition(
      locationSettings: LocationSettings(accuracy: LocationAccuracy.high),
    ).timeout(timeout);

    return {
      'latitude': position.latitude,
      'longitude': position.longitude,
      'accuracy': position.accuracy,
      'captured_at': DateTime.now().toUtc().toIso8601String(),
    };
  } catch (_) {
    return null;
  }
}
