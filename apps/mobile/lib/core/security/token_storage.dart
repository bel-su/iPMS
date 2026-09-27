import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Secure enclave storage service strictly holding authentication tokens.
/// No entity or server-side domain data is ever stored here.
class TokenStorage {
  TokenStorage({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
            );

  final FlutterSecureStorage _storage;

  static const String _accessTokenKey = 'ipms_access_token';
  static const String _refreshTokenKey = 'ipms_refresh_token';
  static const String _userIdKey = 'ipms_user_id';
  static const String _biometricEnabledKey = 'ipms_biometric_enabled';
  static const String _biometricUsernameKey = 'ipms_biometric_username';
  static const String _biometricRefreshTokenKey = 'ipms_biometric_refresh_token';
  static const String _biometricUserIdKey = 'ipms_biometric_user_id';

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
    String? userId,
  }) async {
    await _storage.write(key: _accessTokenKey, value: accessToken);
    await _storage.write(key: _refreshTokenKey, value: refreshToken);
    if (userId != null) {
      await _storage.write(key: _userIdKey, value: userId);
    }
    final bioEnabled = await isBiometricEnabled();
    if (bioEnabled) {
      await _storage.write(key: _biometricRefreshTokenKey, value: refreshToken);
      if (userId != null) {
        await _storage.write(key: _biometricUserIdKey, value: userId);
      }
    }
  }

  Future<String?> getAccessToken() => _storage.read(key: _accessTokenKey);

  Future<String?> getRefreshToken() => _storage.read(key: _refreshTokenKey);

  Future<String?> getUserId() => _storage.read(key: _userIdKey);

  Future<String?> getBiometricRefreshToken() =>
      _storage.read(key: _biometricRefreshTokenKey);

  Future<String?> getBiometricUserId() =>
      _storage.read(key: _biometricUserIdKey);

  Future<bool> isBiometricEnabled() async {
    final value = await _storage.read(key: _biometricEnabledKey);
    return value == 'true';
  }

  Future<void> setBiometricEnabled(bool enabled) async {
    await _storage.write(
      key: _biometricEnabledKey,
      value: enabled ? 'true' : 'false',
    );
  }

  Future<String?> getBiometricUsername() =>
      _storage.read(key: _biometricUsernameKey);

  Future<void> setBiometricUsername(String? username) async {
    if (username != null && username.isNotEmpty) {
      await _storage.write(key: _biometricUsernameKey, value: username);
      // Sync current refresh token for biometric re-login
      final currentRefresh = await getRefreshToken();
      final currentUserId = await getUserId();
      if (currentRefresh != null && currentRefresh.isNotEmpty) {
        await _storage.write(key: _biometricRefreshTokenKey, value: currentRefresh);
      }
      if (currentUserId != null && currentUserId.isNotEmpty) {
        await _storage.write(key: _biometricUserIdKey, value: currentUserId);
      }
    } else {
      await _storage.delete(key: _biometricUsernameKey);
    }
  }

  Future<void> clearBiometric() async {
    await _storage.delete(key: _biometricEnabledKey);
    await _storage.delete(key: _biometricUsernameKey);
    await _storage.delete(key: _biometricRefreshTokenKey);
    await _storage.delete(key: _biometricUserIdKey);
  }

  Future<void> clearTokens({bool purgeBiometrics = false}) async {
    await _storage.delete(key: _accessTokenKey);
    await _storage.delete(key: _refreshTokenKey);
    await _storage.delete(key: _userIdKey);
    if (purgeBiometrics) {
      await clearBiometric();
    }
  }
}
