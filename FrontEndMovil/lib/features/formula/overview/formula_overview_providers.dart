import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/models/formula_entry.dart';

class FormulaRepository {
  FormulaRepository(this._dio);
  final Dio _dio;

  Future<List<FormulaEntry>> fetchAll() async {
    final response = await _dio.get('/api/mining/formulas');
    final data = response.data;
    final list = data is Map<String, dynamic> ? (data['formulas'] as List<dynamic>? ?? []) : (data as List<dynamic>);
    return list.map((e) => FormulaEntry.fromJson(e as Map<String, dynamic>)).toList();
  }
}

final formulaRepositoryProvider = Provider<FormulaRepository>((ref) => FormulaRepository(ref.watch(apiClientProvider)));

final formulaOverviewProvider = FutureProvider.autoDispose<List<FormulaEntry>>((ref) {
  return ref.watch(formulaRepositoryProvider).fetchAll();
});
