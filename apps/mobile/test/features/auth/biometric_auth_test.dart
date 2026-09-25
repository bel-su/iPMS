import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
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
  });
}
