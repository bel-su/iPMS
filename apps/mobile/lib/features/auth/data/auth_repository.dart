import 'package:dio/dio.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/security/token_storage.dart';
import '../domain/models/auth_user.dart';

class AuthRepository {
  AuthRepository({
    required this.apiClient,
    required this.tokenStorage,
  });

  final ApiClient apiClient;
  final TokenStorage tokenStorage;

  Future<AuthUser> login({
    required String email,
    required String password,
  }) async {
    try {
      final response = await apiClient.dio.post<Map<String, dynamic>>(
        '/api/iam/auth/login',
        data: {
          'email': email.trim().toLowerCase(),
          'password': password,
        },
      );

      final data = response.data;
      if (data == null || data['accessToken'] == null) {
        throw const ApiException(message: 'Invalid response from authentication service.');
      }

      final accessToken = data['accessToken'] as String;
      final refreshToken = data['refreshToken'] as String? ?? '';
      final userId = data['userId'] as String? ?? data['user']?['id'] as String?;

      await tokenStorage.saveTokens(
        accessToken: accessToken,
        refreshToken: refreshToken,
        userId: userId,
      );

      // Fetch user profile
      return await getCurrentUser();
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        throw const ApiException(message: 'Incorrect email or password.');
      }
      throw ApiException(
        message: e.response?.data?['message']?.toString() ??
            'Failed to connect to authentication service.',
        statusCode: e.response?.statusCode,
      );
    }
  }

  Future<AuthUser> getCurrentUser() async {
    try {
      final response = await apiClient.dio.get<Map<String, dynamic>>(
        '/api/iam/users/me',
      );

      final data = response.data;
      if (data == null) {
        throw const ApiException(message: 'User profile not found.');
      }

      return AuthUser.fromJson(data);
    } on DioException catch (e) {
      throw ApiException(
        message: e.response?.data?['message']?.toString() ?? 'Failed to load user profile.',
        statusCode: e.response?.statusCode,
      );
    }
  }

  Future<bool> hasSavedSession() async {
    final token = await tokenStorage.getAccessToken();
    final refresh = await tokenStorage.getRefreshToken();
    return (token != null && token.isNotEmpty) || (refresh != null && refresh.isNotEmpty);
  }

  Future<void> logout() async {
    try {
      await apiClient.dio.post<void>('/api/iam/auth/logout');
    } catch (_) {
      // Best-effort server notification
    } finally {
      await tokenStorage.clearTokens();
    }
  }
}
