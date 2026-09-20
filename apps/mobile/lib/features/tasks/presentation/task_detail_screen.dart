import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../map/presentation/site_map_screen.dart';
import '../domain/models/task_item.dart';
import '../providers/task_providers.dart';

class TaskDetailScreen extends ConsumerStatefulWidget {
  const TaskDetailScreen({
    super.key,
    required this.task,
  });

  final TaskItem task;

  @override
  ConsumerState<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends ConsumerState<TaskDetailScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final taskAsync = ref.watch(taskDetailProvider(widget.task.id));
    final task = taskAsync.value ?? widget.task;

    final dateStr = task.plannedCompletionAt != null
        ? DateFormat('d MMMM').format(task.plannedCompletionAt!)
        : 'Not set';

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit_outlined, size: 20),
            onPressed: () {},
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Task Title & Category
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.primaryLavenderLight,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: const Icon(
                        Icons.inventory_2_outlined,
                        color: AppColors.darkSlate,
                        size: 24,
                      ),
                    ),
                    const SizedBox(height: 14),
                    Text(
                      task.title,
                      style: AppTypography.headingLarge,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Site: ${task.siteCode ?? "N/A"} • ${task.siteName ?? task.category}',
                      style: AppTypography.bodyMedium,
                    ),
                    const SizedBox(height: 20),

                    // Two Summary Metric Cards (Deadline & People)
                    Row(
                      children: [
                        // Deadline Card
                        Expanded(
                          child: Card(
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Deadline',
                                    style: AppTypography.caption,
                                  ),
                                  const SizedBox(height: 10),
                                  Row(
                                    children: [
                                      const Icon(
                                        Icons.calendar_month_rounded,
                                        size: 20,
                                        color: AppColors.darkSlate,
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          dateStr,
                                          style: AppTypography.titleMedium,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        // People Card
                        Expanded(
                          child: Card(
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Assignee',
                                    style: AppTypography.caption,
                                  ),
                                  const SizedBox(height: 10),
                                  Row(
                                    children: [
                                      CircleAvatar(
                                        radius: 12,
                                        backgroundColor: AppColors.primaryLavender,
                                        child: Text(
                                          task.assigneeName != null &&
                                                  task.assigneeName!.isNotEmpty
                                              ? task.assigneeName![0].toUpperCase()
                                              : 'U',
                                          style: const TextStyle(
                                            fontSize: 10,
                                            fontWeight: FontWeight.bold,
                                            color: AppColors.darkSlate,
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          task.assigneeName ?? 'Field Staff',
                                          style: AppTypography.titleMedium,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),

                    // Segmented Tabs Header
                    Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: AppColors.searchFieldBackground,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: TabBar(
                        controller: _tabController,
                        indicatorSize: TabBarIndicatorSize.tab,
                        indicator: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.04),
                              blurRadius: 6,
                              offset: const Offset(0, 2),
                            ),
                          ],
                        ),
                        dividerColor: Colors.transparent,
                        labelColor: AppColors.darkSlate,
                        unselectedLabelColor: AppColors.textSecondary,
                        labelStyle: AppTypography.titleMedium,
                        tabs: const [
                          Tab(text: 'Checklist'),
                          Tab(text: 'Site & Coordinates'),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Tab View Content
                    SizedBox(
                      height: 320,
                      child: TabBarView(
                        controller: _tabController,
                        children: [
                          _buildChecklistTab(task),
                          _buildSiteInfoTab(task),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Bottom Action: View on OpenStreetMap
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              child: SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton.icon(
                  icon: const Icon(Icons.map_rounded, size: 20),
                  label: const Text('View Site on OpenStreetMap'),
                  onPressed: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute<void>(
                        builder: (_) => SiteMapScreen(
                          initialLatitude: task.latitude,
                          initialLongitude: task.longitude,
                          siteCode: task.siteCode,
                          siteName: task.siteName,
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildChecklistTab(TaskItem task) {
    final subtasks = [
      {'title': 'Pre-installation survey and safety clearance', 'done': true},
      {'title': 'Mounting structure alignment & torque verification', 'done': true},
      {'title': 'Feeder cable grounding and waterproofing', 'done': false},
      {'title': 'Capture geotagged QC completion photograph', 'done': false},
    ];

    return ListView.separated(
      physics: const NeverScrollableScrollPhysics(),
      itemCount: subtasks.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final item = subtasks[index];
        final isDone = item['done'] as bool;

        return Card(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Icon(
                  isDone
                      ? Icons.check_circle_rounded
                      : Icons.radio_button_unchecked_rounded,
                  color: isDone ? AppColors.mintDark : AppColors.textTertiary,
                  size: 22,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    item['title'] as String,
                    style: AppTypography.bodyMedium.copyWith(
                      color: isDone ? AppColors.textSecondary : AppColors.textPrimary,
                      decoration: isDone ? TextDecoration.lineThrough : null,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildSiteInfoTab(TaskItem task) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Geographic Coordinates', style: AppTypography.titleLarge),
            const SizedBox(height: 14),
            Row(
              children: [
                const Icon(Icons.location_on_outlined, size: 20, color: AppColors.darkSlate),
                const SizedBox(width: 8),
                Text(
                  'Latitude: ${task.latitude?.toStringAsFixed(5) ?? "27.71720"}',
                  style: AppTypography.bodyMedium,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                const Icon(Icons.explore_outlined, size: 20, color: AppColors.darkSlate),
                const SizedBox(width: 8),
                Text(
                  'Longitude: ${task.longitude?.toStringAsFixed(5) ?? "85.32400"}',
                  style: AppTypography.bodyMedium,
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Divider(color: AppColors.subtleDivider),
            const SizedBox(height: 12),
            Text('Geofence Radius: 100 meters', style: AppTypography.bodySmall),
            const SizedBox(height: 4),
            Text(
              'Stateless check: live GPS distance will verify site presence without local cache.',
              style: AppTypography.caption,
            ),
          ],
        ),
      ),
    );
  }
}
