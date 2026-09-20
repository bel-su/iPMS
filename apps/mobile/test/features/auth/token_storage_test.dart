import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/security/token_storage.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('TokenStorage (Secure Enclave)', () {
    setUp(() {
      FlutterSecureStorage.setMockInitialValues({});
    });

    test('saves, retrieves, and clears authentication tokens', () async {
      final storage = TokenStorage();

      expect(await storage.getAccessToken(), isNull);
      expect(await storage.getRefreshToken(), isNull);

      await storage.saveTokens(
        accessToken: 'mock_jwt_access_token_123',
        refreshToken: 'mock_jwt_refresh_token_456',
        userId: 'user-uuid-789',
      );

      expect(await storage.getAccessToken(), 'mock_jwt_access_token_123');
      expect(await storage.getRefreshToken(), 'mock_jwt_refresh_token_456');
      expect(await storage.getUserId(), 'user-uuid-789');

      await storage.clearTokens();

      expect(await storage.getAccessToken(), isNull);
      expect(await storage.getRefreshToken(), isNull);
      expect(await storage.getUserId(), isNull);
    });
  });
}
