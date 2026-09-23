import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'biometric_models.dart';

/// Wire format (ver docs/decisions/0003): bytes JPEG crudos,
/// `Content-Type: image/jpeg`, header `X-Capture-Session-Id` — NUNCA
/// base64/JSON para estos dos endpoints (a diferencia de login/registro).
class BiometricRepository {
  BiometricRepository(this._dio);
  final Dio _dio;

  Future<void> resetCapture(String captureSessionId) async {
    await _dio.get('/api/reset_capture', options: Options(headers: {'X-Capture-Session-Id': captureSessionId}));
  }

  Future<BiometricFrameStatus> processFrame({required Uint8List jpegBytes, required String captureSessionId}) async {
    final response = await _dio.post(
      '/api/process_frame',
      data: jpegBytes,
      options: Options(
        headers: {'X-Capture-Session-Id': captureSessionId},
        contentType: 'image/jpeg',
      ),
    );
    return BiometricFrameStatus.fromJson(response.data as Map<String, dynamic>);
  }
}

final biometricRepositoryProvider = Provider<BiometricRepository>((ref) {
  return BiometricRepository(ref.watch(apiClientProvider));
});
