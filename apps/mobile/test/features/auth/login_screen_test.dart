import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:local_auth/local_auth.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/security/biometric_auth_service.dart';
import 'package:mobile/core/security/token_storage.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/presentation/login_screen.dart';
import 'package:mobile/features/auth/providers/auth_provider.dart';
import 'package:mobile/features/auth/providers/biometric_provider.dart';
import 'package:mobile/main.dart';
import 'package:mobile/shared/layout/main_scaffold.dart';

/// iam stand-in. `/auth/login` waits on [loginGate] so a test can look at the
/// screen while the sign-in is still in flight.
class GatedIam implements HttpClientAdapter {
  Completer<void> loginGate = Completer<void>()..complete();
  int loginStatus = 200;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    ResponseBody json(int status, Object body) => ResponseBody.fromString(jsonEncode(body), status,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
    switch (options.path) {
      case '/api/v1/auth/login':
        await loginGate.future;
        if (loginStatus != 200) {
          return json(loginStatus, {'error': {'code': 'UNAUTHENTICATED', 'message': 'Invalid email or password', 'correlationId': 'c'}});
        }
        return json(200, {'accessToken': 'a', 'refreshToken': 'r', 'expiresIn': 900});
      case '/api/v1/auth/me':
        return json(200, {'id': 'u-1', 'roles': ['FIELD_ENGINEER'], 'permissions': ['task.view']});
      case '/api/v1/users/me':
        return json(200, {'id': 'u-1', 'email': 'engineer@ipms.local', 'fullName': 'Field Engineer', 'roles': []});
    }
    return json(404, {});
  }

  @override
  void close({bool force = false}) {}
}

class FakeBiometrics extends BiometricAuthService {
  FakeBiometrics(TokenStorage storage, this.result) : super(tokenStorage: storage);
  final BiometricResult result;

  @override
  Future<bool> canAuthenticateWithBiometrics() async => true;

  @override
  Future<List<BiometricType>> getAvailableBiometrics() async => const [BiometricType.face];

  @override
  Future<BiometricResult> authenticate({String? localizedReason}) async => result;
}

void main() {
  late TokenStorage storage;
  late GatedIam iam;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    storage = TokenStorage();
    iam = GatedIam();
  });

  Widget app({BiometricResult biometric = const BiometricResult.success()}) {
    final dio = Dio(BaseOptions(baseUrl: 'http://gateway.test'))..httpClientAdapter = iam;
    final repo = AuthRepository(apiClient: ApiClient(tokenStorage: storage, dio: dio), tokenStorage: storage);
    return ProviderScope(
      overrides: [
        tokenStorageProvider.overrideWithValue(storage),
        authRepositoryProvider.overrideWithValue(repo),
        biometricServiceProvider.overrideWithValue(FakeBiometrics(storage, biometric)),
      ],
      child: const IpmsApp(),
    );
  }

  Future<void> signIn(WidgetTester tester, {String password = 'right-password'}) async {
    await tester.enterText(find.byType(TextFormField).at(0), 'engineer@ipms.local');
    await tester.enterText(find.byType(TextFormField).at(1), password);
    await tester.tap(find.text('Sign In'));
    await tester.pump();
  }

  testWidgets('the sign-in page stays up while signing in, then opens the app without errors', (tester) async {
    iam.loginGate = Completer<void>();
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();

    await signIn(tester);
    await tester.pump(const Duration(milliseconds: 50));

    // Still the sign-in page, with the spinner in its button: not a
    // full-screen splash that throws the page (and its state) away.
    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    iam.loginGate.complete();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.byType(MainScaffold), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a wrong password says so', (tester) async {
    iam.loginStatus = 401;
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();
    final container = ProviderScope.containerOf(tester.element(find.byType(LoginScreen)));

    // Driven in real async: Dio does not deliver error responses under the
    // widget tester's fake clock.
    await tester.runAsync(() => container.read(authStateProvider.notifier).login('engineer@ipms.local', 'wrong'));
    await tester.pumpAndSettle();

    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.byKey(const Key('login-error')), findsOneWidget);
    expect(find.text('Incorrect email or password.'), findsOneWidget);
    expect(find.text('Sign In'), findsOneWidget); // not stuck on a spinner
  });

  testWidgets('with Face ID enrolled, a failure is shown on the Face ID card too', (tester) async {
    // Enrolled earlier, but the kept session is gone (e.g. revoked).
    await storage.setBiometricEnabled(true);
    await storage.setBiometricUsername('engineer');
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();

    expect(find.textContaining('Sign in with Face'), findsOneWidget);
    await tester.tap(find.textContaining('Sign in with Face'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('login-error')), findsOneWidget);
    expect(find.textContaining('expired'), findsOneWidget);
  });
}
