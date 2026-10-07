import 'package:dio/dio.dart';
import '../../../core/config/api_endpoints.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../domain/finance_models.dart';

/// The field app's side of the finance service: a user's own advance,
/// reimbursement and settlement requests. Approvals and payments are done on
/// the web by managers and finance.
class FinanceRepository {
  FinanceRepository({required this.apiClient});

  final ApiClient apiClient;

  Future<List<FinanceRequest>> myRequests({String? status}) async {
    try {
      final response = await apiClient.dio.get<Map<String, dynamic>>(
        ApiEndpoints.financeRequests,
        queryParameters: {'view': 'mine', 'limit': 100, 'status': ?status},
      );
      return (response.data?['items'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(FinanceRequest.fromJson)
          .toList();
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load your requests.');
    }
  }

  Future<FinanceRequest> getRequest(String id) async {
    try {
      final response = await apiClient.dio.get<Map<String, dynamic>>(ApiEndpoints.financeRequest(id));
      return FinanceRequest.fromJson(response.data ?? const {});
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load the request.');
    }
  }

  Future<List<ExpenseCategory>> categories() async {
    try {
      final response = await apiClient.dio.get<List<dynamic>>(ApiEndpoints.financeCategories);
      return (response.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .where((c) => c['disabledAt'] == null)
          .map(ExpenseCategory.fromJson)
          .toList();
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load the categories.');
    }
  }

  /// Creates a draft. [body] follows the server's `CreateRequestSchema`.
  Future<FinanceRequest> create(Map<String, dynamic> body) async {
    try {
      final response = await apiClient.dio.post<Map<String, dynamic>>(ApiEndpoints.financeRequests, data: body);
      return FinanceRequest.fromJson(response.data ?? const {});
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not save the request.');
    }
  }

  /// Edits a draft or returned request. [body] follows `UpdateRequestSchema`.
  Future<FinanceRequest> update(String id, Map<String, dynamic> body) async {
    try {
      final response = await apiClient.dio.patch<Map<String, dynamic>>(ApiEndpoints.financeRequest(id), data: body);
      return FinanceRequest.fromJson(response.data ?? const {});
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not save the request.');
    }
  }

  Future<void> submit(String id) async {
    try {
      await apiClient.dio.post<void>(ApiEndpoints.financeSubmit(id), data: const <String, dynamic>{});
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not submit the request.');
    }
  }

  Future<void> cancel(String id, {String? comment}) async {
    try {
      await apiClient.dio.post<void>(
        ApiEndpoints.financeCancel(id),
        data: {if (comment != null && comment.trim().isNotEmpty) 'comment': comment.trim()},
      );
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not cancel the request.');
    }
  }
}
