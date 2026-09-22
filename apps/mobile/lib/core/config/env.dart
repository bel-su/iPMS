import 'package:flutter/foundation.dart';

/// Environment configuration for API gateway connection.
class AppConfig {
  AppConfig._();

  static const String _envApiUrl = String.fromEnvironment('API_BASE_URL');

  /// Default API base URL.
  /// - Web / desktop: `http://localhost:3000`
  /// - Android Emulator: `http://10.0.2.2:3000`
  /// - Overridable via `--dart-define=API_BASE_URL=...`
  static String get apiBaseUrl {
    if (_envApiUrl.isNotEmpty) return _envApiUrl;
    if (kIsWeb) return 'http://localhost:3000';
    return 'http://10.0.2.2:3000';
  }

  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 15);
}
