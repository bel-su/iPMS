import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/map/presentation/site_map_screen.dart';
import 'package:mobile/features/profile/presentation/profile_screen.dart';
import 'package:mobile/features/projects/presentation/project_list_screen.dart';
import 'package:mobile/features/tasks/presentation/task_list_screen.dart';
import 'package:mobile/shared/layout/main_scaffold.dart';

void main() {
  testWidgets('MainScaffold switches tabs when FloatingNavBar items are tapped',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: MainScaffold(
            pages: [
              TaskListScreen(),
              ProjectListScreen(),
              SiteMapScreen(),
              ProfileScreen(),
            ],
          ),
        ),
      ),
    );

    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // Initial tab is TaskListScreen
    expect(find.text('Your task'), findsOneWidget);

    // Tap Projects tab (index 1)
    await tester.tap(find.byIcon(Icons.business_outlined));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Assigned Projects'), findsOneWidget);

    // Tap Map tab (index 2)
    await tester.tap(find.byIcon(Icons.map_outlined));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('OpenStreetMap Explorer'), findsOneWidget);

    // Tap Profile tab (index 3)
    await tester.tap(find.byIcon(Icons.person_outline_rounded));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Account setting'), findsOneWidget);
  });
}
