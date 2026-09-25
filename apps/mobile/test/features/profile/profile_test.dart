import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/domain/models/auth_user.dart';
import 'package:mobile/features/auth/providers/auth_provider.dart';
import 'package:mobile/features/profile/presentation/profile_screen.dart';

void main() {
  testWidgets('ProfileScreen renders user details, settings items, and logout',
      (WidgetTester tester) async {
    const user = AuthUser(
      id: 'user-123',
      email: 'mohammad.hasan@ipms.local',
      displayName: 'Mohammad Oalid Hasan',
      role: 'Field Engineer',
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authStateProvider.overrideWith(() => _MockAuthNotifier(user)),
        ],
        child: const MaterialApp(
          home: ProfileScreen(),
        ),
      ),
    );

    await tester.pump();

    expect(find.text('Mohammad Oalid Hasan'), findsOneWidget);
    expect(find.text('Field Engineer • Field Operations'), findsOneWidget);
    expect(find.text('Account setting'), findsOneWidget);
    expect(find.text('Privacy & Security'), findsOneWidget);
    expect(find.text('Notification'), findsOneWidget);
    expect(find.text('Dark mode'), findsOneWidget);

    // Scroll until Log Out is visible in viewport, then tap
    final logoutFinder = find.text('Log Out');
    await tester.scrollUntilVisible(logoutFinder, 200);
    await tester.pumpAndSettle();

    expect(logoutFinder, findsOneWidget);

    await tester.tap(logoutFinder);
    await tester.pumpAndSettle();

    expect(find.text('Confirm Logout'), findsOneWidget);
    expect(find.text('Cancel'), findsOneWidget);
  });
}

class _MockAuthNotifier extends AuthNotifier {
  _MockAuthNotifier(this._user);

  final AuthUser _user;

  @override
  Future<AuthUser?> build() async => _user;
}
