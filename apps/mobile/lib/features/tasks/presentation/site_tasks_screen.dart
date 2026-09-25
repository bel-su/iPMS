import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../map/presentation/site_map_screen.dart';
import '../../projects/domain/models/project_item.dart';
import '../providers/task_providers.dart';
import 'task_detail_screen.dart';
import 'widgets/task_card.dart';

class SiteTasksScreen extends ConsumerWidget {
  const SiteTasksScreen({
    super.key,
    required this.project,
    required this.site,
  });

  final ProjectItem project;
  final ProjectSite site;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasksAsync = ref.watch(siteTasksProvider(site.siteCode));

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Site Tasks • ${site.siteCode}',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            Text(
              site.name,
              style: AppTypography.caption,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.map_outlined, size: 22),
            tooltip: 'View on OpenStreetMap',
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute<void>(
                  builder: (_) => SiteMapScreen(
                    initialLatitude: site.latitude,
                    initialLongitude: site.longitude,
                    siteCode: site.siteCode,
                    siteName: site.name,
                    geofenceRadiusMeters: (site.geofenceRadiusM ?? 100).toDouble(),
                  ),
                ),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded, size: 20),
            tooltip: 'Refresh',
            onPressed: () => ref.invalidate(siteTasksProvider(site.siteCode)),
          ),
        ],
      ),
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            // Site Information Banner
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 10),
              sliver: SliverToBoxAdapter(
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.subtleDivider),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.02),
                        blurRadius: 8,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: AppColors.darkSlate,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              site.siteCode,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: AppColors.statusOngoingBg,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              project.code,
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: AppColors.statusOngoingText,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text(
                        site.name,
                        style: AppTypography.headingSmall,
                      ),
                      if (site.address != null || site.city != null) ...[
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            const Icon(Icons.place_outlined, size: 14, color: AppColors.textSecondary),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                '${site.address ?? ""}${site.address != null && site.city != null ? ", " : ""}${site.city ?? ""}',
                                style: AppTypography.bodySmall.copyWith(color: AppColors.textSecondary),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ],
                      const SizedBox(height: 12),
                      const Divider(color: AppColors.subtleDivider),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.explore_outlined, size: 14, color: AppColors.darkSlate),
                              const SizedBox(width: 6),
                              Text(
                                '${site.latitude?.toStringAsFixed(4) ?? "27.7172"} N, ${site.longitude?.toStringAsFixed(4) ?? "85.3240"} E',
                                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.darkSlate),
                              ),
                            ],
                          ),
                          Text(
                            'Geofence: ${site.geofenceRadiusM ?? 100}m',
                            style: AppTypography.caption,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // Section Title
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 10),
              sliver: SliverToBoxAdapter(
                child: Text(
                  'Assigned Site Tasks',
                  style: AppTypography.headingSmall,
                ),
              ),
            ),

            // Tasks List
            tasksAsync.when(
              data: (tasks) {
                if (tasks.isEmpty) {
                  return SliverFillRemaining(
                    hasScrollBody: false,
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.assignment_turned_in_outlined, size: 48, color: AppColors.textSecondary),
                          const SizedBox(height: 12),
                          Text('No tasks found for ${site.siteCode}', style: AppTypography.titleMedium),
                          const SizedBox(height: 4),
                          Text('All site tasks are complete or pending assignment.', style: AppTypography.bodySmall),
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
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (_, _) => SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textSecondary),
                      const SizedBox(height: 12),
                      Text('Unable to load site tasks', style: AppTypography.titleMedium),
                      const SizedBox(height: 8),
                      TextButton.icon(
                        icon: const Icon(Icons.refresh_rounded, size: 16),
                        label: const Text('Retry'),
                        onPressed: () => ref.invalidate(siteTasksProvider(site.siteCode)),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
