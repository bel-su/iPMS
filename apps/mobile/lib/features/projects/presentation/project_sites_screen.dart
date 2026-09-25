import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../map/presentation/site_map_screen.dart';
import '../../tasks/presentation/site_tasks_screen.dart';
import '../data/project_repository.dart';
import '../domain/models/project_item.dart';

class ProjectSitesScreen extends ConsumerWidget {
  const ProjectSitesScreen({
    super.key,
    required this.project,
  });

  final ProjectItem project;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sites = project.sites.isNotEmpty
        ? project.sites
        : ProjectRepository.getDemoSitesForProjectCode(project.code);

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
              project.code,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            Text(
              project.name,
              style: AppTypography.caption,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            // Project Summary Banner
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 10),
              sliver: SliverToBoxAdapter(
                child: Container(
                  padding: const EdgeInsets.all(18),
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
                              color: AppColors.primaryLavenderLight,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              project.code,
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: AppColors.darkSlate,
                              ),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: AppColors.statusOngoingBg,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              project.status,
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
                        project.name,
                        style: AppTypography.headingMedium,
                      ),
                      if (project.phase != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          project.phase!,
                          style: AppTypography.bodySmall.copyWith(color: AppColors.textSecondary),
                        ),
                      ],
                      const SizedBox(height: 14),
                      const Divider(color: AppColors.subtleDivider),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            '${sites.length} Physical Infrastructure Sites',
                            style: AppTypography.caption.copyWith(fontWeight: FontWeight.bold),
                          ),
                          Text(
                            '${project.taskCount > 0 ? project.taskCount : sites.length * 3} Total Tasks',
                            style: AppTypography.caption,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // Section Header
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 10),
              sliver: SliverToBoxAdapter(
                child: Text(
                  'Select a Site to View Tasks',
                  style: AppTypography.headingSmall,
                ),
              ),
            ),

            // Sites List
            if (sites.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.location_off_outlined, size: 48, color: AppColors.textSecondary),
                      const SizedBox(height: 12),
                      Text('No sites added to this project', style: AppTypography.titleMedium),
                      const SizedBox(height: 4),
                      Text('Sites will appear once provisioned by your project manager.', style: AppTypography.bodySmall),
                    ],
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final site = sites[index];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _SiteCard(
                          project: project,
                          site: site,
                        ),
                      );
                    },
                    childCount: sites.length,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SiteCard extends StatelessWidget {
  const _SiteCard({
    required this.project,
    required this.site,
  });

  final ProjectItem project;
  final ProjectSite site;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: AppColors.subtleDivider),
      ),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute<void>(
              builder: (_) => SiteTasksScreen(
                project: project,
                site: site,
              ),
            ),
          );
        },
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.primaryLavenderLight,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(
                  Icons.cell_tower_outlined,
                  color: AppColors.darkSlate,
                  size: 24,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.darkSlate,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            site.siteCode,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        if (site.city != null) ...[
                          const SizedBox(width: 6),
                          Text(
                            site.city!,
                            style: AppTypography.caption,
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      site.name,
                      style: AppTypography.titleMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (site.address != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        site.address!,
                        style: AppTypography.caption,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              // Map quick action button
              IconButton(
                icon: const Icon(Icons.map_outlined, size: 20, color: AppColors.darkSlate),
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
              const Icon(
                Icons.arrow_forward_ios_rounded,
                size: 14,
                color: AppColors.textTertiary,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
