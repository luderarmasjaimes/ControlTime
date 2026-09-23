import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/models/device.dart';

class DevicesRepository {
  DevicesRepository(this._dio);
  final Dio _dio;

  Future<List<MiningDevice>> fetchAll() async {
    final response = await _dio.get('/api/mining/devices');
    final data = response.data as Map<String, dynamic>;
    return (data['devices'] as List<dynamic>? ?? []).map((e) => MiningDevice.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> rotateKey(String sensorId) async {
    await _dio.post('/api/mining/devices/$sensorId/rotate-key');
  }

  Future<void> revoke(String sensorId) async {
    await _dio.post('/api/mining/devices/$sensorId');
  }
}

final devicesRepositoryProvider = Provider<DevicesRepository>((ref) => DevicesRepository(ref.watch(apiClientProvider)));

final devicesProvider = FutureProvider.autoDispose<List<MiningDevice>>((ref) {
  return ref.watch(devicesRepositoryProvider).fetchAll();
});
