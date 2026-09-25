import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../domain/models/task_item.dart';

class TaskCard extends StatelessWidget {
  const TaskCard({
    super.key,
    required this.task,
    required this.onTap,
  });

  final TaskItem task;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (statusBg, statusText) = _getStatusColors(task.status);
    final (priorityBg, priorityText) = _getPriorityColors(task.priority);

    final dateStr = task.plannedCompletionAt != null
        ? DateFormat('d MMMM').format(task.plannedCompletionAt!)
        : 'Pending';

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: const BorderSide(color: AppColors.subtleDivider, width: 1),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(24),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top Row: Category Icon + Title + Action
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.searchFieldBackground,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(
                      Icons.folder_outlined,
                      size: 20,
                      color: AppColors.darkSlate,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          task.title,
                          style: AppTypography.titleLarge,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          task.siteName ?? task.siteCode ?? task.category,
                          style: AppTypography.bodySmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  const Icon(
                    Icons.arrow_forward_ios_rounded,
                    size: 14,
                    color: AppColors.textTertiary,
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Badges Row (Status + Priority)
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: statusBg,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: statusText,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          _formatStatus(task.status),
                          style: AppTypography.badge.copyWith(color: statusText),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: priorityBg,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.flag_rounded, size: 14, color: priorityText),
                        const SizedBox(width: 4),
                        Text(
                          task.priority,
                          style: AppTypography.badge.copyWith(color: priorityText),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),

              // Progress Bar
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: LinearProgressIndicator(
                  value: task.progressPercentage,
                  minHeight: 6,
                  backgroundColor: AppColors.searchFieldBackground,
                  valueColor: const AlwaysStoppedAnimation<Color>(
                    AppColors.darkSlate,
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Bottom Row: Assignee Badge, Date Pill, Checklist Count
              Row(
                children: [
                  _buildAssigneeBadge(task.assigneeName),
                  const Spacer(),
                  // Date Chip
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: AppColors.searchFieldBackground,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.calendar_today_rounded,
                          size: 13,
                          color: AppColors.textSecondary,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          dateStr,
                          style: AppTypography.badge.copyWith(
                            color: AppColors.textSecondary,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  // Checklist Count Pill
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                    decoration: BoxDecoration(
                      color: AppColors.searchFieldBackground,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.check_circle_outline_rounded,
                          size: 13,
                          color: AppColors.textSecondary,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          '${task.completedChecklistCount}/${task.totalChecklistCount}',
                          style: AppTypography.badge.copyWith(
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAssigneeBadge(String? assignee) {
    if (assignee == null || assignee.isEmpty) {
      return const SizedBox.shrink();
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        CircleAvatar(
          radius: 12,
          backgroundColor: AppColors.primaryLavender,
          child: Text(
            assignee[0].toUpperCase(),
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.bold,
              color: AppColors.darkSlate,
            ),
          ),
        ),
        const SizedBox(width: 6),
        Text(
          assignee,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.darkSlate,
          ),
        ),
      ],
    );
  }

  (Color, Color) _getStatusColors(String status) {
    switch (status) {
      case 'ONGOING':
        return (AppColors.statusOngoingBg, AppColors.statusOngoingText);
      case 'REVIEWING':
        return (AppColors.statusReviewingBg, AppColors.statusReviewingText);
      case 'COMPLETED':
        return (AppColors.statusCompletedBg, AppColors.statusCompletedText);
      case 'BLOCKED':
        return (AppColors.statusBlockedBg, AppColors.statusBlockedText);
      default:
        return (AppColors.statusCancelledBg, AppColors.statusCancelledText);
    }
  }

  (Color, Color) _getPriorityColors(String priority) {
    switch (priority.toLowerCase()) {
      case 'high':
        return (AppColors.priorityHighBg, AppColors.priorityHighText);
      case 'low':
        return (AppColors.priorityLowBg, AppColors.priorityLowText);
      default:
        return (AppColors.priorityMediumBg, AppColors.priorityMediumText);
    }
  }

  String _formatStatus(String status) {
    return status.replaceAll('_', ' ').toLowerCase().split(' ').map((word) {
      if (word.isEmpty) return '';
      return word[0].toUpperCase() + word.substring(1);
    }).join(' ');
  }
}
