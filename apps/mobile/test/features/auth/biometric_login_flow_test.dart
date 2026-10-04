import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:local_auth/local_auth.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/network/api_exceptions.dart';
import 'package:mobile/core/security/biometric_auth_service.dart';
import 'package:mobile/core/security/token_storage.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/providers/auth_provider.dart';
import 'package:mobile/features/auth/presentation/widgets/biometric_enrollment_sheet.dart';
import 'package:mobile/features/auth/providers/biometric_provider.dart';
import 'package:mobile/main.dart';
import 'package:mobile/shared/layout/main_scaffold.dart';

/// A stand-in iam service: answers by path and records what was called.
class FakeIam implements HttpClientAdapter {
  final List<String> calls = [];
  int refreshStatus = 200;
  String userId = 'u-1';

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    // Like the gateway: a JSON POST with no body is refused before it
    // reaches the handler.
    if (options.method == 'POST' && options.data == null) {
      return ResponseBody.fromString('{"error":{"code":"VALIDATION_FAILED","message":"Body cannot be empty"}}', 400,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
    }
    calls.add('${options.method} ${options.path}');
    ResponseBody json(int status, Object body) => ResponseBody.fromString(
          jsonEncode(body),
          status,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
        );
    switch (options.path) {
      case '/api/v1/auth/refresh':
        if (refreshStatus != 200) {
          return json(refreshStatus, {'error': {'code': 'UNAUTHENTICATED', 'message': 'Session revoked', 'correlationId': 'c'}});
        }
        return json(200, {'accessToken': 'access-new', 'refreshToken': 'refresh-new', 'expiresIn': 900});
      case '/api/v1/auth/me':
        return json(200, {'id': userId, 'roles': ['FIELD_ENGINEER'], 'permissions': ['task.view']});
      case '/api/v1/users/me':
        return json(200, {'id': userId, 'email': 'engineer@ipms.local', 'fullName': 'Field Engineer', 'roles': []});
      case '/api/v1/auth/login':
        return json(200, {'accessToken': 'access-1', 'refreshToken': 'refresh-1', 'expiresIn': 900});
      case '/api/v1/auth/logout':
        return json(200, {'status': 'ok'});
    }
    return json(404, {});
  }

  @override
  void close({bool force = false}) {}
}

class FakeBiometricService extends BiometricAuthService {
  FakeBiometricService(TokenStorage storage, this.result) : super(tokenStorage: storage);

  BiometricResult result;

  @override
  Future<bool> canAuthenticateWithBiometrics() async => true;

  @override
  Future<List<BiometricType>> getAvailableBiometrics() async => const [BiometricType.face];

  @override
  Future<BiometricResult> authenticate({String? localizedReason}) async => result;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late TokenStorage storage;
  late FakeIam iam;
  late AuthRepository repo;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    storage = TokenStorage();
    iam = FakeIam();
    final dio = Dio(BaseOptions(baseUrl: 'http://gateway.test'))..httpClientAdapter = iam;
    repo = AuthRepository(apiClient: ApiClient(tokenStorage: storage, dio: dio), tokenStorage: storage);
  });

  /// Signed in, then biometric sign-in turned on, as the enrollment flow does.
  Future<void> signedInAndEnrolled() async {
    await storage.saveTokens(accessToken: 'access-1', refreshToken: 'refresh-1', userId: 'u-1');
    await storage.setBiometricEnabled(true);
    await storage.setBiometricUsername('engineer');
  }

  group('TokenStorage biometric session', () {
    test('a token saved for another account never lands in the biometric slot', () async {
      await signedInAndEnrolled();
      await storage.clearTokens();
      await storage.saveTokens(accessToken: 'a-2', refreshToken: 'refresh-of-u2', userId: 'u-2');
      expect(await storage.getBiometricRefreshToken(), 'refresh-1');
    });

    test('a different account signing in removes the enrollment', () async {
      await signedInAndEnrolled();
      await storage.bindBiometricSession('u-2');
      expect(await storage.isBiometricEnabled(), isFalse);
      expect(await storage.getBiometricRefreshToken(), isNull);
    });

    test('the same account signing in refreshes the biometric session', () async {
      await signedInAndEnrolled();
      await storage.clearTokens();
      await storage.saveTokens(accessToken: 'a', refreshToken: 'refresh-2');
      await storage.bindBiometricSession('u-1');
      expect(await storage.getBiometricRefreshToken(), 'refresh-2');
      expect(await storage.isBiometricEnabled(), isTrue);
    });
  });

  group('AuthRepository', () {
    test('locking keeps the biometric session and does not revoke it on the server', () async {
      await signedInAndEnrolled();
      await repo.logout(keepBiometricSession: true);

      expect(iam.calls, isNot(contains('POST /api/v1/auth/logout')));
      expect(await storage.getAccessToken(), isNull);
      expect(await storage.getBiometricRefreshToken(), 'refresh-1');
    });

    test('a full sign-out revokes server-side and forgets biometrics', () async {
      await signedInAndEnrolled();
      await repo.logout();

      expect(iam.calls, contains('POST /api/v1/auth/logout'));
      expect(await storage.isBiometricEnabled(), isFalse);
      expect(await storage.getBiometricRefreshToken(), isNull);
    });

    test('after a lock, biometric sign-in redeems the kept session', () async {
      await signedInAndEnrolled();
      await repo.logout(keepBiometricSession: true);

      final user = await repo.loginWithBiometrics(username: 'engineer');

      expect(user.id, 'u-1');
      expect(iam.calls, containsAllInOrder(['POST /api/v1/auth/refresh', 'GET /api/v1/auth/me']));
      expect(await storage.getAccessToken(), 'access-new');
      expect(await storage.getBiometricRefreshToken(), 'refresh-new');
    });

    test('a revoked biometric session asks for the password and keeps the enrollment', () async {
      await signedInAndEnrolled();
      await repo.logout(keepBiometricSession: true);
      iam.refreshStatus = 401;

      await expectLater(
        repo.loginWithBiometrics(username: 'engineer'),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', AuthRepository.biometricSessionExpired)),
      );
      expect(await storage.getBiometricRefreshToken(), isNull);
      expect(await storage.isBiometricEnabled(), isTrue);
    });

    test('with no stored session there is nothing to unlock', () async {
      await storage.setBiometricEnabled(true);
      await storage.setBiometricUsername('engineer');
      await expectLater(repo.loginWithBiometrics(username: 'engineer'), throwsA(isA<ApiException>()));
      expect(iam.calls, isEmpty);
    });
  });

  group('BiometricAuthNotifier', () {
    ProviderContainer containerWith(BiometricResult result) {
      final container = ProviderContainer(overrides: [
        tokenStorageProvider.overrideWithValue(storage),
        authRepositoryProvider.overrideWithValue(repo),
        biometricServiceProvider.overrideWithValue(FakeBiometricService(storage, result)),
      ]);
      addTearDown(container.dispose);
      return container;
    }

    test('signs in when the scan passes and the session is restored', () async {
      await signedInAndEnrolled();
      await repo.logout(keepBiometricSession: true);
      final container = containerWith(const BiometricResult.success());
      await container.read(authStateProvider.future);
      await container.read(biometricAuthStateProvider.notifier).checkBiometricStatus();

      final ok = await container.read(biometricAuthStateProvider.notifier).authenticateAndLogin();

      expect(ok, isTrue);
      expect(container.read(authStateProvider).value?.id, 'u-1');
    });

    test('reports failure, with the reason, when the session cannot be restored', () async {
      await signedInAndEnrolled();
      await repo.logout(keepBiometricSession: true);
      iam.refreshStatus = 401;
      final container = containerWith(const BiometricResult.success());
      await container.read(authStateProvider.future);
      await container.read(biometricAuthStateProvider.notifier).checkBiometricStatus();

      final ok = await container.read(biometricAuthStateProvider.notifier).authenticateAndLogin();

      expect(ok, isFalse);
      expect(container.read(authStateProvider).value, isNull);
      expect(container.read(biometricAuthStateProvider).statusMessage, AuthRepository.biometricSessionExpired);
    });

    test('a cancelled scan does not touch the session and shows no error', () async {
      await signedInAndEnrolled();
      await repo.logout(keepBiometricSession: true);
      final container = containerWith(const BiometricResult.cancelled());
      await container.read(authStateProvider.future);
      await container.read(biometricAuthStateProvider.notifier).checkBiometricStatus();

      final ok = await container.read(biometricAuthStateProvider.notifier).authenticateAndLogin();

      expect(ok, isFalse);
      expect(iam.calls, isNot(contains('POST /api/v1/auth/refresh')));
      expect(container.read(biometricAuthStateProvider).statusMessage, isNull);
    });

    test('a lock-screen sign-out keeps biometric sign-in available', () async {
      await signedInAndEnrolled();
      final container = containerWith(const BiometricResult.success());
      await container.read(authStateProvider.future);

      await container.read(authStateProvider.notifier).logout();

      expect(iam.calls, isNot(contains('POST /api/v1/auth/logout')));
      expect(await storage.getBiometricRefreshToken(), 'refresh-1');
    });

    test('turning biometrics off forgets the kept session', () async {
      await signedInAndEnrolled();
      final container = containerWith(const BiometricResult.success());
      await container.read(biometricAuthStateProvider.notifier).checkBiometricStatus();

      await container.read(biometricAuthStateProvider.notifier).disableBiometric();

      expect(await storage.getBiometricRefreshToken(), isNull);
      expect(container.read(biometricAuthStateProvider).enrolledUsername, isNull);
      expect(container.read(biometricAuthStateProvider).isConfigured, isFalse);
    });
  });

  testWidgets('password sign-in lands on the main screen and offers biometric sign-in', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        tokenStorageProvider.overrideWithValue(storage),
        authRepositoryProvider.overrideWithValue(repo),
        biometricServiceProvider.overrideWithValue(
            FakeBiometricService(storage, const BiometricResult.success())),
      ],
      child: const IpmsApp(),
    ));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField).at(0), 'engineer@ipms.local');
    await tester.enterText(find.byType(TextFormField).at(1), 'secret-password');
    await tester.tap(find.text('Sign In'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.byType(MainScaffold), findsOneWidget);
    expect(find.byType(BiometricEnrollmentSheet), findsOneWidget);
  });
}
