import 'package:dio/dio.dart';
import '../config/env.dart';
import '../security/token_storage.dart';
import 'auth_interceptor.dart';

/// Central singleton / provider wrapper for Dio HTTP Client.
class ApiClient {
  ApiClient({
    required TokenStorage tokenStorage,
    void Function()? onSessionExpired,
    Dio? dio,
  }) : dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: AppConfig.apiBaseUrl,
                connectTimeout: AppConfig.connectTimeout,
                receiveTimeout: AppConfig.receiveTimeout,
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                },
              ),
            ) {
    this.dio.interceptors.add(
          AuthInterceptor(
            tokenStorage: tokenStorage,
            onSessionExpired: onSessionExpired,
            // Same server and transport, without this interceptor, so a
            // refresh or retry cannot recurse into another refresh.
            refreshDio: Dio(this.dio.options.copyWith())
              ..httpClientAdapter = this.dio.httpClientAdapter,
          ),
        );
  }

  final Dio dio;
}
