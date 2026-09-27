
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
  /// - iOS simulator: `http://localhost:3000` (shares the Mac's network)
  /// - iOS physical device: `localhost` is the phone itself, so pass the Mac's
  ///   LAN address, e.g. `--dart-define=API_BASE_URL=http://192.168.1.20:3000`.
  ///   Plain HTTP only works in Debug builds; Release builds require HTTPS.
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
