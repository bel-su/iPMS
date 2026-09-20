import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/layout/main_scaffold.dart';
import '../../auth/providers/auth_provider.dart';
import '../providers/task_providers.dart';
import 'task_detail_screen.dart';
import 'widgets/hero_progress_banner.dart';
import 'widgets/status_filter_bar.dart';
import 'widgets/task_card.dart';

class TaskListScreen extends ConsumerWidget {
  const TaskListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authStateProvider).value;
    final selectedFilter = ref.watch(selectedStatusFilterProvider);
    final tasksAsync = ref.watch(assignedTasksProvider);

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(assignedTasksProvider);
          },
          child: CustomScrollView(
            slivers: [
              // Top Header (User Avatar, Greeting, Notifications, Search)
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
                sliver: SliverToBoxAdapter(
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 20,
                        backgroundColor: AppColors.primaryLavender,
                        child: Text(
                          user?.displayName?.isNotEmpty == true
                              ? user!.displayName![0].toUpperCase()
                              : 'E',
                          style: const TextStyle(
                            color: AppColors.darkSlate,
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              user?.displayName ?? 'Field Engineer',
                              style: AppTypography.titleLarge,
                            ),
                            Text(
                              user?.role ?? 'iPMS Operations',
                              style: AppTypography.caption,
                            ),
                          ],
                        ),
                      ),
                      // Notification Bell
                      IconButton(
                        icon: const Badge(
                          smallSize: 8,
                          backgroundColor: AppColors.accentOrange,
                          child: Icon(Icons.notifications_none_rounded),
                        ),
                        onPressed: () {},
                      ),
                      // Search Action
                      IconButton(
                        icon: const Icon(Icons.search_rounded),
                        onPressed: () {
                          // Switch to Search tab (index 2)
                          ref.read(navigationIndexProvider.notifier).setIndex(2);
                        },
                      ),
                    ],
                  ),
                ),
              ),

              // Hero Banner (Lilac card with dark timer and 3D clock)
              const SliverPadding(
                padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                sliver: SliverToBoxAdapter(
                  child: HeroProgressBanner(),
                ),
              ),

              // Section Header: "Your task"
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
                sliver: SliverToBoxAdapter(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Your task',
                        style: AppTypography.headingMedium,
                      ),
                      TextButton(
                        onPressed: () {
                          ref
                              .read(selectedStatusFilterProvider.notifier)
                              .setFilter('ALL');
                        },
                        child: Text(
                          'See All',
                          style: AppTypography.titleMedium.copyWith(
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // Horizontal Filter Bar
              SliverToBoxAdapter(
                child: StatusFilterBar(
                  selectedStatus: selectedFilter,
                  onSelected: (val) {
                    ref
                        .read(selectedStatusFilterProvider.notifier)
                        .setFilter(val);
                  },
                ),
              ),

              const SliverToBoxAdapter(child: SizedBox(height: 16)),

              // Task List Content
              tasksAsync.when(
                data: (tasks) {
                  if (tasks.isEmpty) {
                    return SliverFillRemaining(
                      hasScrollBody: false,
                      child: Center(
                        child: Text(
                          'No tasks found for this filter.',
                          style: AppTypography.bodyMedium,
                        ),
                      ),
                    );
                  }

                  return SliverPadding(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
                    sliver: SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (context, index) {
                          final task = tasks[index];
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 14),
                            child: TaskCard(
                              task: task,
                              onTap: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute<void>(
                                    builder: (_) => TaskDetailScreen(task: task),
                                  ),
                                );
                              },
                            ),
                          );
                        },
                        childCount: tasks.length,
                      ),
                    ),
                  );
                },
                loading: () => const SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(
                    child: CircularProgressIndicator(),
                  ),
                ),
                error: (err, _) => SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(
                    child: Text('Error loading tasks: $err'),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
