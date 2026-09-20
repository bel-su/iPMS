import 'package:dio/dio.dart';
import '../config/env.dart';
import '../security/token_storage.dart';
import 'auth_interceptor.dart';

/// Central singleton / provider wrapper for Dio HTTP Client.
class ApiClient {
  ApiClient({
    required TokenStorage tokenStorage,
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
          AuthInterceptor(tokenStorage: tokenStorage),
        );
  }

  final Dio dio;
}
