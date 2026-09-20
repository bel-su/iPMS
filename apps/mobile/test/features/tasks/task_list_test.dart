import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/tasks/domain/models/task_item.dart';
import 'package:mobile/features/tasks/presentation/task_list_screen.dart';
import 'package:mobile/features/tasks/presentation/widgets/hero_progress_banner.dart';
import 'package:mobile/features/tasks/presentation/widgets/task_card.dart';
import 'package:mobile/features/tasks/providers/task_providers.dart';

void main() {
  testWidgets('HeroProgressBanner renders time remaining and title',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: HeroProgressBanner(
            remainingTime: '7h 34m',
            subtitle: 'Your task almost done',
          ),
        ),
      ),
    );

    expect(find.text('7h 34m'), findsOneWidget);
    expect(find.text('Your task almost done'), findsOneWidget);
    expect(find.byIcon(Icons.access_time_filled_rounded), findsOneWidget);
  });

  testWidgets('TaskCard displays title, priority, status, and progress',
      (WidgetTester tester) async {
    final task = TaskItem(
      id: 'task-1',
      siteId: 'site-1',
      taskTypeId: 'tt-1',
      title: 'Civil Works & Tower Foundation',
      status: 'ONGOING',
      priority: 'High',
      siteCode: 'KOS121',
      completedChecklistCount: 3,
      totalChecklistCount: 5,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TaskCard(
            task: task,
            onTap: () {},
          ),
        ),
      ),
    );

    expect(find.text('Civil Works & Tower Foundation'), findsOneWidget);
    expect(find.text('Ongoing'), findsOneWidget);
    expect(find.text('High'), findsOneWidget);
    expect(find.text('3/5'), findsOneWidget);
  });

  testWidgets('TaskListScreen renders task list and status chips',
      (WidgetTester tester) async {
    final demoTask = TaskItem(
      id: 'task-1',
      siteId: 'site-1',
      taskTypeId: 'tt-1',
      title: 'Civil Works & Tower Foundation',
      status: 'ONGOING',
      priority: 'High',
      siteCode: 'KOS121',
      completedChecklistCount: 3,
      totalChecklistCount: 5,
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          assignedTasksProvider.overrideWith((ref) async => [demoTask]),
        ],
        child: const MaterialApp(
          home: TaskListScreen(),
        ),
      ),
    );

    await tester.pump();
    await tester.pump();

    expect(find.text('Your task'), findsOneWidget);
    expect(find.text('All'), findsOneWidget);
    // 'Ongoing' appears both in the filter chip and on the task card badge
    expect(find.text('Ongoing'), findsNWidgets(2));
    expect(find.text('Completed'), findsOneWidget);

    // Verify task card rendering
    expect(find.text('Civil Works & Tower Foundation'), findsOneWidget);
  });
}
