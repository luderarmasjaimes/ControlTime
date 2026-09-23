import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/models/platform_user.dart';

class UsersRepository {
  UsersRepository(this._dio);
  final Dio _dio;

  Future<List<PlatformUser>> fetchAll() async {
    final response = await _dio.get('/api/auth/users');
    final data = response.data;
    final list = data is Map<String, dynamic> ? (data['users'] as List<dynamic>? ?? []) : (data as List<dynamic>);
    return list.map((e) => PlatformUser.fromJson(e as Map<String, dynamic>)).toList();
  }
}

final usersRepositoryProvider = Provider<UsersRepository>((ref) => UsersRepository(ref.watch(apiClientProvider)));

final usersListProvider = FutureProvider.autoDispose<List<PlatformUser>>((ref) {
  return ref.watch(usersRepositoryProvider).fetchAll();
});
