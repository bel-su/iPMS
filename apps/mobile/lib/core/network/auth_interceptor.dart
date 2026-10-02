import 'dart:async';
import 'package:dio/dio.dart';
import '../config/api_endpoints.dart';
import '../config/env.dart';
import '../security/token_storage.dart';

/// Interceptor that attaches the Bearer token to every request and automatically
/// performs token refresh when a 401 Unauthorized status is returned.
class AuthInterceptor extends QueuedInterceptor {
  AuthInterceptor({
    required this.tokenStorage,
    this.onSessionExpired,
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

  /// Called when the session can no longer be refreshed, so the app can
  /// return to the sign-in screen instead of failing every request.
  final void Function()? onSessionExpired;
  final Dio _refreshDio;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    // Avoid attaching expired token to login or refresh endpoints
    if (!ApiEndpoints.isAuthEndpoint(options.path)) {
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
    if (err.response?.statusCode != 401 ||
        ApiEndpoints.isAuthEndpoint(err.requestOptions.path)) {
      return handler.next(err);
    }
    final refreshToken = await tokenStorage.getRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      onSessionExpired?.call();
      return handler.next(err);
    }

    final String newAccessToken;
    try {
      final response = await _refreshDio.post<Map<String, dynamic>>(
        ApiEndpoints.refresh,
        data: {'refreshToken': refreshToken},
      );
      final data = response.data;
      if (data == null || data['accessToken'] == null) return handler.next(err);
      newAccessToken = data['accessToken'] as String;
      await tokenStorage.saveTokens(
        accessToken: newAccessToken,
        refreshToken: (data['refreshToken'] as String?) ?? refreshToken,
      );
    } on DioException catch (e) {
      // Only a refusal ends the session; an unreachable server does not.
      if (e.response?.statusCode == 401) {
        await tokenStorage.clearTokens();
        onSessionExpired?.call();
      }
      return handler.next(err);
    }

    // Retry the original request once with the new token, and report its own
    // outcome, success or failure, rather than the stale 401.
    final opts = err.requestOptions..headers['Authorization'] = 'Bearer $newAccessToken';
    try {
      return handler.resolve(await _refreshDio.fetch<dynamic>(opts));
    } on DioException catch (e) {
      return handler.next(e);
    }
  }
}
