
/// Environment configuration for API gateway connection.
class AppConfig {
  AppConfig._();

  static const String _envApiUrl = String.fromEnvironment('API_BASE_URL');
  static String? _customApiUrl;

  static void setCustomApiUrl(String url) {
    _customApiUrl = url;
  }

  /// Default API base URL.
  /// - Web / desktop: `http://localhost:3000`
  /// - Android (physical device with `adb reverse tcp:3000 tcp:3000` or emulator): `http://localhost:3000`
  /// - Overridable via `--dart-define=API_BASE_URL=...`
  static String get apiBaseUrl {
    if (_customApiUrl != null && _customApiUrl!.isNotEmpty) {
      return _customApiUrl!;
    }
    if (_envApiUrl.isNotEmpty) return _envApiUrl;
    return 'http://localhost:3000';
  }

  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 15);
}
