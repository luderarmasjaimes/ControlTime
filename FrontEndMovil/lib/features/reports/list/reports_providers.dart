import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/models/report_summary.dart';

class ReportsRepository {
  ReportsRepository(this._dio);
  final Dio _dio;

  Future<List<ReportSummary>> fetchAll() async {
    final response = await _dio.get('/api/reports');
    final data = response.data;
    final list = data is Map<String, dynamic> ? (data['reports'] as List<dynamic>? ?? []) : (data as List<dynamic>);
    return list.map((e) => ReportSummary.fromJson(e as Map<String, dynamic>)).toList();
  }
}

final reportsRepositoryProvider = Provider<ReportsRepository>((ref) => ReportsRepository(ref.watch(apiClientProvider)));

final reportsListProvider = FutureProvider.autoDispose<List<ReportSummary>>((ref) {
  return ref.watch(reportsRepositoryProvider).fetchAll();
});
