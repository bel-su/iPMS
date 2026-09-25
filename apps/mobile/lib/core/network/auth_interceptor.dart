import 'dart:async';
import 'package:dio/dio.dart';
import '../config/env.dart';
import '../security/token_storage.dart';

/// Interceptor that attaches the Bearer token to every request and automatically
/// performs token refresh when a 401 Unauthorized status is returned.
class AuthInterceptor extends QueuedInterceptor {
  AuthInterceptor({
    required this.tokenStorage,
    Dio? refreshDio,
  }) : _refreshDio = refreshDio ??
            Dio(
              BaseOptions(
                baseUrl: AppConfig.apiBaseUrl,
                connectTimeout: AppConfig.connectTimeout,
                receiveTimeout: AppConfig.receiveTimeout,
              ),
            );

  final TokenStorage tokenStorage;
  final Dio _refreshDio;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    // Avoid attaching expired token to login or refresh endpoints
    final isAuthEndpoint = options.path.contains('/auth/login') ||
        options.path.contains('/auth/refresh');

    if (!isAuthEndpoint) {
      final token = await tokenStorage.getAccessToken();
      if (token != null && token.isNotEmpty) {
        options.headers['Authorization'] = 'Bearer $token';
      }
    }

    return handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    if (err.response?.statusCode == 401) {
      final isAuthEndpoint = err.requestOptions.path.contains('/auth/login') ||
          err.requestOptions.path.contains('/auth/refresh');

      if (!isAuthEndpoint) {
        final refreshToken = await tokenStorage.getRefreshToken();
        if (refreshToken != null && refreshToken.isNotEmpty) {
          try {
            // Attempt token refresh
            final response = await _refreshDio.post<Map<String, dynamic>>(
              '/api/v1/auth/refresh',
              data: {'refreshToken': refreshToken},
            );

            final data = response.data;
            if (data != null && data['accessToken'] != null) {
              final newAccessToken = data['accessToken'] as String;
              final newRefreshToken =
                  (data['refreshToken'] as String?) ?? refreshToken;

              await tokenStorage.saveTokens(
                accessToken: newAccessToken,
                refreshToken: newRefreshToken,
              );

              // Retry original request with new token
              final opts = err.requestOptions;
              opts.headers['Authorization'] = 'Bearer $newAccessToken';

              final cloneReq = await _refreshDio.fetch<dynamic>(opts);
              return handler.resolve(cloneReq);
            }
          } catch (_) {
            // Refresh failed: purge tokens and let the 401 bubble up
            await tokenStorage.clearTokens();
          }
        }
      }
    }

    return handler.next(err);
  }
}
