
/// Environment configuration for API gateway connection.
class AppConfig {
  AppConfig._();

  static const String _envApiUrl = String.fromEnvironment('API_BASE_URL');
  static String? _customApiUrl;

  /// Overrides the build-time address (null or empty restores it).
  static void setCustomApiUrl(String? url) {
    _customApiUrl = url;
  }

  /// The address the app was built with, ignoring any override.
  static String get builtInApiBaseUrl =>
      _envApiUrl.isNotEmpty ? _envApiUrl : 'http://localhost:3000';

  /// Accepts what a person types ("192.168.1.20:3000", "https://ipms.example.com/")
  /// and returns a usable base URL, or null when it is not one.
  static String? normalizeApiUrl(String input) {
    var value = input.trim();
    if (value.isEmpty) return null;
    if (!value.contains('://')) value = 'http://$value';
    while (value.endsWith('/')) {
      value = value.substring(0, value.length - 1);
    }
    final uri = Uri.tryParse(value);
    if (uri == null || uri.host.isEmpty || (uri.scheme != 'http' && uri.scheme != 'https')) {
      return null;
    }
    return value;
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

  /// Presigned uploads go straight to the bucket and can be several MB over a
  /// field connection, so they get a longer window than API calls.
  static const Duration uploadTimeout = Duration(minutes: 2);

  /// Offline demo data (sample projects, work orders and checklists, and a
  /// sign-in that works without a server). Off by default so a real gateway
  /// failure is shown rather than hidden behind sample data.
  /// Enable with `--dart-define=DEMO_MODE=true`.
  static const bool demoMode = bool.fromEnvironment('DEMO_MODE');
}
