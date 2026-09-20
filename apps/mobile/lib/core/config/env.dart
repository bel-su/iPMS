/// Environment configuration for API gateway connection.
class AppConfig {
  AppConfig._();

  /// Default API base URL.
  /// - `http://10.0.2.2:3000` for Android Emulator accessing host machine.
  /// - `http://127.0.0.1:3000` for desktop/web testing.
  /// - Overridable via `String.fromEnvironment('API_BASE_URL')`.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 15);
}
