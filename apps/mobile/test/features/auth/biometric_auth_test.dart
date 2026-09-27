import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:local_auth/local_auth.dart';
import 'package:mobile/core/security/token_storage.dart';
import 'package:mobile/features/auth/providers/biometric_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  group('TokenStorage Biometric Key Management', () {
    test('manages biometric enabled flag and enrolled username', () async {
      final storage = TokenStorage();

      // Initially false
      expect(await storage.isBiometricEnabled(), isFalse);
      expect(await storage.getBiometricUsername(), isNull);

      // Enable and set username
      await storage.setBiometricEnabled(true);
      await storage.setBiometricUsername('alex_engineer');

      expect(await storage.isBiometricEnabled(), isTrue);
      expect(await storage.getBiometricUsername(), 'alex_engineer');

      // Clear tokens with purgeBiometrics = true
      await storage.clearTokens(purgeBiometrics: true);
      expect(await storage.isBiometricEnabled(), isFalse);
      expect(await storage.getBiometricUsername(), isNull);
    });

    test('preserves biometric refresh token across normal token clear and purges on demand', () async {
      final storage = TokenStorage();

      await storage.setBiometricEnabled(true);
      await storage.saveTokens(
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        userId: 'usr-1',
      );

      expect(await storage.getAccessToken(), 'access-123');
      expect(await storage.getRefreshToken(), 'refresh-456');
      expect(await storage.getBiometricRefreshToken(), 'refresh-456');

      // Normal logout (purgeBiometrics = false): access token cleared, biometric refresh token preserved
      await storage.clearTokens(purgeBiometrics: false);
      expect(await storage.getAccessToken(), isNull);
      expect(await storage.getRefreshToken(), isNull);
      expect(await storage.getBiometricRefreshToken(), 'refresh-456');
      expect(await storage.isBiometricEnabled(), isTrue);

      // Purge all biometrics
      await storage.clearTokens(purgeBiometrics: true);
      expect(await storage.getBiometricRefreshToken(), isNull);
      expect(await storage.isBiometricEnabled(), isFalse);
    });
  });

  group('BiometricAuthState Model', () {
    test('initializes with default state and updates correctly', () {
      const state = BiometricAuthState(
        isHardwareSupported: true,
        isConfigured: true,
        enrolledUsername: 'field_tech',
      );

      expect(state.isHardwareSupported, isTrue);
      expect(state.isConfigured, isTrue);
      expect(state.enrolledUsername, 'field_tech');
      expect(state.isAuthenticating, isFalse);

      final updated = state.copyWith(isAuthenticating: true);
      expect(updated.isAuthenticating, isTrue);
      expect(updated.enrolledUsername, 'field_tech');
    });

    test('detects Face ID and adapts labels and icons for iOS', () {
      const faceIdState = BiometricAuthState(
        isHardwareSupported: true,
        isConfigured: true,
        availableBiometrics: [BiometricType.face],
        enrolledUsername: 'ios_engineer',
      );

      expect(faceIdState.hasFaceId, isTrue);
      expect(faceIdState.hasFingerprint, isFalse);
      expect(faceIdState.biometricName, 'Face ID');

      const fingerprintState = BiometricAuthState(
        isHardwareSupported: true,
        isConfigured: true,
        availableBiometrics: [BiometricType.fingerprint],
        enrolledUsername: 'android_engineer',
      );

      expect(fingerprintState.hasFaceId, isFalse);
      expect(fingerprintState.hasFingerprint, isTrue);
      expect(fingerprintState.biometricName, 'Fingerprint');
    });
  });
}
