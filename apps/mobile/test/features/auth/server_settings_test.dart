import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/env.dart';
import 'package:mobile/core/security/token_storage.dart';
import 'package:mobile/features/auth/presentation/widgets/server_settings_sheet.dart';
import 'package:mobile/features/auth/providers/auth_provider.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    AppConfig.setCustomApiUrl(null);
  });
  tearDown(() => AppConfig.setCustomApiUrl(null));

  test('normalizes what a person types into a base URL', () {
    expect(AppConfig.normalizeApiUrl('192.168.68.57:3000'), 'http://192.168.68.57:3000');
    expect(AppConfig.normalizeApiUrl(' https://ipms.example.com/ '), 'https://ipms.example.com');
    expect(AppConfig.normalizeApiUrl('ftp://x'), isNull);
    expect(AppConfig.normalizeApiUrl(''), isNull);
  });

  Future<ProviderContainer> pumpSheet(WidgetTester tester, Future<void> Function(String) probe) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: Scaffold(body: ServerSettingsSheet(probe: probe))),
    ));
    return container;
  }

  testWidgets('an unreachable server is explained, with what to check', (tester) async {
    await pumpSheet(tester, (url) async {
      throw DioException(requestOptions: RequestOptions(path: url), type: DioExceptionType.connectionError);
    });
    await tester.enterText(find.byKey(const Key('server-url')), '192.168.68.57:3000');
    await tester.tap(find.text('Test connection'));
    await tester.pumpAndSettle();

    final result = tester.widget<Text>(find.byKey(const Key('server-test-result'))).data!;
    expect(result, contains("Can't reach http://192.168.68.57:3000"));
    expect(result, contains('Local Network'));
    expect(result, contains('port 3000'));
  });

  testWidgets('saving points the app at the new server and remembers it', (tester) async {
    String? probed;
    final container = await pumpSheet(tester, (url) async => probed = url);
    final before = container.read(apiClientProvider);

    await tester.enterText(find.byKey(const Key('server-url')), '10.0.0.5:3000');
    await tester.tap(find.text('Test connection'));
    await tester.pumpAndSettle();
    expect(probed, 'http://10.0.0.5:3000');
    expect(find.text('Connected to http://10.0.0.5:3000'), findsOneWidget);

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(AppConfig.apiBaseUrl, 'http://10.0.0.5:3000');
    final after = container.read(apiClientProvider);
    expect(identical(before, after), isFalse);
    expect(after.dio.options.baseUrl, 'http://10.0.0.5:3000');
    expect(await TokenStorage().getApiBaseUrl(), 'http://10.0.0.5:3000');
  });
}
