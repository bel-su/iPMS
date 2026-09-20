import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/main.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  testWidgets('iPMS boots into LoginScreen when no tokens exist', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: IpmsApp(),
      ),
    );

    // Initial pump
    await tester.pumpAndSettle();

    expect(find.text('iPMS Field App'), findsOneWidget);
    expect(find.text('Username'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.text('Sign In'), findsOneWidget);
  });
}
