import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/map/presentation/site_map_screen.dart';
import 'package:mobile/features/profile/presentation/profile_screen.dart';
import 'package:mobile/features/search/presentation/search_screen.dart';
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
              SiteMapScreen(),
              SearchScreen(),
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
    expect(find.text('OpenStreetMap View'), findsNothing);

    // Tap Site Map tab (index 1)
    await tester.tap(find.byIcon(Icons.map_rounded));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('OpenStreetMap Explorer'), findsOneWidget);

    // Tap Search tab (index 2)
    await tester.tap(find.byIcon(Icons.search_rounded));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Search Tasks & Sites'), findsOneWidget);

    // Tap Profile tab (index 3)
    await tester.tap(find.byIcon(Icons.person_rounded));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Account setting'), findsOneWidget);
  });
}
