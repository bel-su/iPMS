import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/search/presentation/search_screen.dart';
import 'package:mobile/features/search/providers/search_providers.dart';
import 'package:mobile/features/tasks/domain/models/task_item.dart';

void main() {
  testWidgets('SearchScreen renders search input and category chips',
      (WidgetTester tester) async {
    final demoTask = TaskItem(
      id: 'task-1',
      siteId: 'site-1',
      taskTypeId: 'tt-1',
      title: 'Civil Works & Tower Foundation',
      status: 'ONGOING',
      priority: 'High',
      siteCode: 'KOS121',
      category: 'Civil',
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          searchResultsProvider.overrideWith((ref) async => [demoTask]),
        ],
        child: const MaterialApp(
          home: SearchScreen(),
        ),
      ),
    );

    await tester.pump();

    expect(find.text('Search Tasks & Sites'), findsOneWidget);
    expect(find.text('Civil Works'), findsOneWidget);
    expect(find.text('Telecom / RF'), findsOneWidget);
    expect(find.text('Civil Works & Tower Foundation'), findsOneWidget);
  });

  testWidgets('SearchScreen updates search query when text is typed',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: SearchScreen(),
        ),
      ),
    );

    await tester.pump();

    final inputField = find.byType(TextField);
    expect(inputField, findsOneWidget);

    await tester.enterText(inputField, 'KOS121');
    await tester.pump(const Duration(milliseconds: 350));

    expect(find.text('KOS121'), findsWidgets);
  });
}
