import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/security/token_storage.dart';
import 'package:mobile/features/auth/providers/auth_provider.dart';
import 'package:mobile/features/profile/presentation/widgets/change_password_sheet.dart';

class Server implements HttpClientAdapter {
  Server(this.status, this.body);
  final int status;
  final Map<String, dynamic> body;
  final List<RequestOptions> calls = [];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    calls.add(options);
    return ResponseBody.fromString(jsonEncode(body), status,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
  }

  @override
  void close({bool force = false}) {}
}

Future<Server> open(WidgetTester tester, int status, Map<String, dynamic> body) async {
  FlutterSecureStorage.setMockInitialValues({});
  final server = Server(status, body);
  final api = ApiClient(
    tokenStorage: TokenStorage(),
    dio: Dio(BaseOptions(baseUrl: 'http://x'))..httpClientAdapter = server,
  );
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(api)],
    child: const MaterialApp(home: Scaffold(body: ChangePasswordSheet())),
  ));
  return server;
}

Future<void> fill(WidgetTester tester, {String current = 'Old-pass-1', String fresh = 'New-pass-1!', String? confirm}) async {
  await tester.enterText(find.widgetWithText(TextField, 'Current password'), current);
  await tester.enterText(find.widgetWithText(TextField, 'New password'), fresh);
  await tester.enterText(find.widgetWithText(TextField, 'Confirm new password'), confirm ?? fresh);
  await tester.pump();
}

void main() {
  Finder button() => find.widgetWithText(ElevatedButton, 'Change password');

  testWidgets('is disabled until the new password meets every rule and matches', (tester) async {
    await open(tester, 200, {'status': 'ok'});
    await fill(tester, fresh: 'short');
    expect(tester.widget<ElevatedButton>(button()).onPressed, isNull);

    await fill(tester, fresh: 'New-pass-1!', confirm: 'Different-1!');
    expect(find.text('The passwords do not match'), findsOneWidget);
    expect(tester.widget<ElevatedButton>(button()).onPressed, isNull);

    await fill(tester, current: 'New-pass-1!', fresh: 'New-pass-1!');
    expect(find.text('Choose a password different from the current one'), findsOneWidget);
    expect(tester.widget<ElevatedButton>(button()).onPressed, isNull);

    await fill(tester);
    expect(tester.widget<ElevatedButton>(button()).onPressed, isNotNull);
  });

  testWidgets('sends both passwords to the change-password route', (tester) async {
    final server = await open(tester, 200, {'status': 'ok'});
    await fill(tester);
    await tester.tap(button());
    await tester.pumpAndSettle();

    expect(server.calls.single.path, '/api/v1/auth/change-password');
    expect(server.calls.single.data, {'currentPassword': 'Old-pass-1', 'newPassword': 'New-pass-1!'});
  });

  testWidgets('shows the server\'s reason when the current password is wrong', (tester) async {
    await open(tester, 400, {
      'error': {'code': 'BAD_REQUEST', 'message': 'Current password is incorrect', 'correlationId': 'c'},
    });
    await fill(tester);
    await tester.tap(button());
    await tester.pumpAndSettle();

    expect(find.text('Current password is incorrect'), findsOneWidget);
  });
}
