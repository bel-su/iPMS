import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../auth/providers/auth_provider.dart';
import '../providers/task_providers.dart';
import 'task_detail_screen.dart';
import 'widgets/status_filter_bar.dart';
import 'widgets/task_card.dart';

class TaskListScreen extends ConsumerStatefulWidget {
  const TaskListScreen({super.key});

  @override
  ConsumerState<TaskListScreen> createState() => _TaskListScreenState();
}

class _TaskListScreenState extends ConsumerState<TaskListScreen> {
  final _searchController = TextEditingController();
  Timer? _debounceTimer;

  @override
  void dispose() {
    _searchController.dispose();
    _debounceTimer?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String val) {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 250), () {
      ref.read(taskSearchQueryProvider.notifier).setQuery(val);
    });
  }

  void _clearSearch() {
    _searchController.clear();
    _debounceTimer?.cancel();
    ref.read(taskSearchQueryProvider.notifier).clear();
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authStateProvider).value;
    final selectedFilter = ref.watch(selectedStatusFilterProvider);
    final tasksAsync = ref.watch(assignedTasksProvider);
    final currentQuery = ref.watch(taskSearchQueryProvider);

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
              // Top Header (User Avatar, Greeting, Live Connection Status)
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                sliver: SliverToBoxAdapter(
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 22,
                        backgroundColor: AppColors.primaryLavender,
                        child: Text(
                          user?.displayName?.isNotEmpty == true
                              ? user!.displayName![0].toUpperCase()
                              : 'E',
                          style: const TextStyle(
                            color: AppColors.darkSlate,
                            fontWeight: FontWeight.bold,
                            fontSize: 18,
                          ),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              user?.displayName ?? 'Field Engineer',
                              style: AppTypography.titleLarge.copyWith(fontWeight: FontWeight.bold),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              user?.role != null ? '${user!.role} • Field Ops' : 'Field Operations',
                              style: AppTypography.caption,
                            ),
                          ],
                        ),
                      ),
                      // Connection Indicator & Manual Refresh
                      InkWell(
                        onTap: () => ref.invalidate(assignedTasksProvider),
                        borderRadius: BorderRadius.circular(20),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: AppColors.searchFieldBackground,
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: AppColors.subtleDivider),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 8,
                                height: 8,
                                decoration: const BoxDecoration(
                                  color: Color(0xFF2E7D32),
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 6),
                              const Text(
                                'Sync',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.darkSlate,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // Instant Search Bar
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 6),
                sliver: SliverToBoxAdapter(
                  child: Container(
                    decoration: BoxDecoration(
                      color: AppColors.searchFieldBackground,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppColors.subtleDivider),
                    ),
                    child: TextField(
                      controller: _searchController,
                      onChanged: _onSearchChanged,
                      decoration: InputDecoration(
                        hintText: 'Search tasks, site code, civil/telecom...',
                        hintStyle: AppTypography.bodySmall.copyWith(color: AppColors.textSecondary),
                        prefixIcon: const Icon(Icons.search_rounded, size: 20, color: AppColors.textSecondary),
                        suffixIcon: currentQuery.isNotEmpty
                            ? IconButton(
                                icon: const Icon(Icons.clear_rounded, size: 18),
                                onPressed: _clearSearch,
                              )
                            : null,
                        border: InputBorder.none,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      ),
                    ),
                  ),
                ),
              ),

              // Section Header: "Your task" + "See All"
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 14, 20, 10),
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
                          _clearSearch();
                          ref.read(selectedStatusFilterProvider.notifier).setFilter('ALL');
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
                    ref.read(selectedStatusFilterProvider.notifier).setFilter(val);
                  },
                ),
              ),

              const SliverToBoxAdapter(child: SizedBox(height: 14)),

              // Task List Content
              tasksAsync.when(
                data: (tasks) {
                  if (tasks.isEmpty) {
                    return SliverFillRemaining(
                      hasScrollBody: false,
                      child: Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.assignment_outlined, size: 44, color: AppColors.textTertiary),
                            const SizedBox(height: 12),
                            Text(
                              currentQuery.isNotEmpty
                                  ? 'No tasks matching "$currentQuery"'
                                  : 'No tasks found for this filter.',
                              style: AppTypography.bodyMedium,
                            ),
                            if (currentQuery.isNotEmpty || selectedFilter != 'ALL') ...[
                              const SizedBox(height: 8),
                              TextButton(
                                onPressed: () {
                                  _clearSearch();
                                  ref.read(selectedStatusFilterProvider.notifier).setFilter('ALL');
                                },
                                child: const Text('Reset Filters'),
                              ),
                            ],
                          ],
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
                error: (_, _) => SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textSecondary),
                        const SizedBox(height: 12),
                        Text('Unable to load tasks', style: AppTypography.titleMedium),
                        const SizedBox(height: 8),
                        TextButton.icon(
                          icon: const Icon(Icons.refresh_rounded, size: 16),
                          label: const Text('Retry'),
                          onPressed: () => ref.invalidate(assignedTasksProvider),
                        ),
                      ],
                    ),
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
