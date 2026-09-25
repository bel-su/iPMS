import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/services/camera_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../auth/providers/auth_provider.dart';
import '../../map/presentation/site_map_screen.dart';
import '../domain/models/task_item.dart';
import '../providers/evidence_provider.dart';
import '../providers/task_providers.dart';
import 'widgets/evidence_gallery_card.dart';

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
  bool _isCapturing = false;
  late List<Map<String, dynamic>> _checklist;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _checklist = _generateChecklistForTask(widget.task);
  }

  List<Map<String, dynamic>> _generateChecklistForTask(TaskItem task) {
    final cat = task.category.toLowerCase();
    final title = task.title.toLowerCase();
    List<String> titles;

    if (cat.contains('civil') || title.contains('civil') || title.contains('foundation') || title.contains('mount') || title.contains('fencing')) {
      titles = [
        'Pre-work structural survey & boundary clearance',
        'Excavation depth & rebar tie wire tensile check',
        'Foundation level & mounting torque verification',
        'Perimeter fencing & site safety clearance',
        'Capture geotagged foundation / structural photograph',
      ];
    } else if (cat.contains('rf') || cat.contains('telecom') || title.contains('antenna') || title.contains('mimo')) {
      titles = [
        'Tower climb harness & PPE safety inspection',
        'Massive MIMO / Sector bracket torque alignment',
        'Azimuth & electrical down-tilt angle calibration',
        'VSWR swept frequency test (< 1.30:1)',
        'Feeder jumper weatherproofing cold-shrink wrap',
        'Capture geotagged antenna alignment evidence photograph',
      ];
    } else if (cat.contains('optical') || cat.contains('fiber') || title.contains('splicing') || title.contains('trenching')) {
      titles = [
        'Duct continuity & microduct pull-wire check',
        'Precision optical fiber cleave & fusion splice (< 0.05 dB)',
        'OTDR bi-directional insertion loss & reflection test',
        'Splice tray cassette sealing & buffer tube slack routing',
        'Capture geotagged fiber closure evidence photograph',
      ];
    } else if (cat.contains('power') || cat.contains('electrical') || title.contains('battery') || title.contains('dg') || title.contains('earthing') || title.contains('ats')) {
      titles = [
        'Lockout-Tagout (LOTO) isolation & safety clearance',
        'Battery bank string voltage & internal resistance test',
        'Automatic Transfer Switch (ATS) emergency failover drill',
        'Earthing pit electrode resistance measurement (< 5 Ohms)',
        'Capture geotagged electrical meter evidence photograph',
      ];
    } else if (cat.contains('solar') || cat.contains('green') || cat.contains('energy') || cat.contains('renewable')) {
      titles = [
        'Solar PV panel open-circuit voltage (Voc) verification',
        'MPPT charge controller firmware & output calibration',
        'Battery thermal chamber environmental insulation check',
        'High-altitude structural mount wind-load torque inspection',
        'Capture geotagged green energy array photograph',
      ];
    } else if (cat.contains('transmission') || title.contains('microwave') || title.contains('los') || title.contains('vsat')) {
      titles = [
        'Microwave / VSAT dish antenna alignment & peak RSL search',
        'Bit Error Rate (BER) & Carrier-to-Noise (C/N) ratio verification',
        'Waveguide flange weatherproofing & grounding kit installation',
        'Capture geotagged transmission LoS evidence photograph',
      ];
    } else {
      titles = [
        'Pre-installation survey & safety clearance',
        'Equipment mounting alignment & torque verification',
        'Feeder cable grounding and weatherproofing',
        'Capture geotagged QC completion photograph',
      ];
    }

    final completedCount = task.completedChecklistCount.clamp(0, titles.length);
    return List.generate(titles.length, (i) {
      return {
        'title': titles[i],
        'done': i < completedCount,
      };
    });
  }

  void _toggleChecklistItem(int index) {
    setState(() {
      _checklist[index]['done'] = !(_checklist[index]['done'] as bool);
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _capturePhoto(TaskItem task) async {
    if (_isCapturing) return;

    setState(() => _isCapturing = true);

    try {
      final authUser = ref.read(authStateProvider).value;
      final username = authUser?.username ?? 'engineer';
      final fullName = authUser?.displayName;

      final result = await CameraService.captureAndWatermark(
        taskId: task.id,
        siteCode: task.siteCode ?? 'KOS121',
        siteName: task.siteName ?? 'Site Location',
        projectCode: task.category.isNotEmpty ? task.category : 'PRJ-5G-METRO',
        username: username,
        fullName: fullName,
        taskTitle: task.title,
      );

      if (result != null && mounted) {
        ref.read(taskEvidenceProvider.notifier).addEvidence(result.evidence);
        _tabController.animateTo(1); // Switch to Site Evidence tab

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.darkSlate,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            content: Row(
              children: [
                const Icon(Icons.verified_outlined, color: Color(0xFFDDD7F7), size: 18),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Evidence watermarked: [${result.evidence.siteCode}] at ${result.evidence.latitude.toStringAsFixed(4)}, ${result.evidence.longitude.toStringAsFixed(4)}',
                    style: const TextStyle(fontSize: 12, color: Colors.white),
                  ),
                ),
              ],
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.statusBlockedText,
            content: Text('Failed to capture evidence: $e'),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isCapturing = false);
      }
    }
  }

  void _submitEvidenceToQC(String taskId) {
    ref.read(taskEvidenceProvider.notifier).submitEvidence(taskId);

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: const Color(0xFF1B5E20),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        content: const Row(
          children: [
            Icon(Icons.check_circle_outline, color: Colors.white, size: 18),
            SizedBox(width: 10),
            Expanded(
              child: Text(
                'Evidence successfully dispatched to Manager / QC Verifier.',
                style: TextStyle(fontSize: 12, color: Colors.white),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final taskAsync = ref.watch(taskDetailProvider(widget.task.id));
    final task = taskAsync.value ?? widget.task;
    final evidenceList = ref.watch(taskEvidenceListProvider(task.id));

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
        title: Text(task.siteCode ?? 'Task Detail', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
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
                    // Task Title & Header
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
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
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                task.title,
                                style: AppTypography.headingMedium,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Site: ${task.siteCode ?? "N/A"} • ${task.siteName ?? task.category}',
                                style: AppTypography.bodySmall,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // Two Summary Metric Cards (Deadline & Status)
                    Row(
                      children: [
                        Expanded(
                          child: Card(
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                              side: const BorderSide(color: AppColors.subtleDivider),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('Deadline', style: AppTypography.caption),
                                  const SizedBox(height: 6),
                                  Row(
                                    children: [
                                      const Icon(Icons.calendar_month_outlined, size: 16, color: AppColors.darkSlate),
                                      const SizedBox(width: 6),
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
                        const SizedBox(width: 10),
                        Expanded(
                          child: Card(
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                              side: const BorderSide(color: AppColors.subtleDivider),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('Evidence', style: AppTypography.caption),
                                  const SizedBox(height: 6),
                                  Row(
                                    children: [
                                      const Icon(Icons.camera_alt_outlined, size: 16, color: AppColors.darkSlate),
                                      const SizedBox(width: 6),
                                      Text(
                                        '${evidenceList.length} Photos',
                                        style: AppTypography.titleMedium,
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
                    const SizedBox(height: 20),

                    // Segmented 3-Tab Header
                    Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: AppColors.searchFieldBackground,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: TabBar(
                        controller: _tabController,
                        indicatorSize: TabBarIndicatorSize.tab,
                        indicator: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(10),
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
                        labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                        tabs: [
                          Tab(text: 'Checklist (${_checklist.where((e) => e['done'] == true).length}/${_checklist.length})'),
                          Tab(text: 'Evidence (${evidenceList.length})'),
                          const Tab(text: 'Site & Map'),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),

                    // Tab View Content
                    SizedBox(
                      height: 380,
                      child: TabBarView(
                        controller: _tabController,
                        children: [
                          _buildChecklistTab(task),
                          _buildEvidenceTab(task, evidenceList),
                          _buildSiteInfoTab(task),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Bottom Action Bar: Take Photo & OSM Map
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.white,
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.05),
                    blurRadius: 10,
                    offset: const Offset(0, -3),
                  ),
                ],
              ),
              child: Row(
                children: [
                  // OSM Navigation button
                  IconButton.filledTonal(
                    style: IconButton.styleFrom(
                      padding: const EdgeInsets.all(14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    icon: const Icon(Icons.map_outlined, size: 22),
                    tooltip: 'View on Map',
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
                  const SizedBox(width: 12),

                  // Main Primary Button: Take Watermarked Photo
                  Expanded(
                    child: SizedBox(
                      height: 50,
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.darkSlate,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        ),
                        icon: _isCapturing
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Icon(Icons.camera_alt_outlined, size: 20),
                        label: Text(
                          _isCapturing ? 'Processing GPS Watermark...' : 'Take Site Photo',
                          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                        ),
                        onPressed: _isCapturing ? null : () => _capturePhoto(task),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildChecklistTab(TaskItem task) {
    return ListView.separated(
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _checklist.length,
      separatorBuilder: (context, index) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final item = _checklist[index];
        final isDone = item['done'] as bool;

        return Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: BorderSide(
              color: isDone ? const Color(0xFF2E7D32).withValues(alpha: 0.3) : AppColors.subtleDivider,
            ),
          ),
          child: InkWell(
            onTap: () => _toggleChecklistItem(index),
            borderRadius: BorderRadius.circular(14),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Icon(
                    isDone ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
                    color: isDone ? const Color(0xFF2E7D32) : AppColors.textTertiary,
                    size: 22,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      item['title'] as String,
                      style: AppTypography.bodyMedium.copyWith(
                        color: isDone ? AppColors.textSecondary : AppColors.textPrimary,
                        decoration: isDone ? TextDecoration.lineThrough : null,
                        fontWeight: isDone ? FontWeight.normal : FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildEvidenceTab(TaskItem task, List<dynamic> evidenceList) {
    if (evidenceList.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.searchFieldBackground,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.camera_alt_outlined, size: 36, color: AppColors.textSecondary),
            ),
            const SizedBox(height: 12),
            const Text(
              'No Evidence Captured',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppColors.darkSlate),
            ),
            const SizedBox(height: 6),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 32),
              child: Text(
                'Tap "Take Site Photo" below to snap verified photo evidence with burned GPS coordinates.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
            ),
          ],
        ),
      );
    }

    final hasUnsubmitted = evidenceList.any((e) => !e.isSubmitted);

    return Column(
      children: [
        if (hasUnsubmitted)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: SizedBox(
              width: double.infinity,
              height: 42,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2E7D32),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                icon: const Icon(Icons.send_outlined, size: 16),
                label: const Text('Submit Evidence to Reviewer', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                onPressed: () => _submitEvidenceToQC(task.id),
              ),
            ),
          ),

        Expanded(
          child: GridView.builder(
            itemCount: evidenceList.length,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
              childAspectRatio: 0.82,
            ),
            itemBuilder: (context, index) {
              final ev = evidenceList[index];
              return EvidenceGalleryCard(
                evidence: ev,
                onDelete: () {
                  ref.read(taskEvidenceProvider.notifier).removeEvidence(task.id, ev.id);
                },
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildSiteInfoTab(TaskItem task) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: AppColors.subtleDivider),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Site Identification & GPS', style: AppTypography.titleLarge),
            const SizedBox(height: 14),
            Row(
              children: [
                const Icon(Icons.apartment_outlined, size: 18, color: AppColors.darkSlate),
                const SizedBox(width: 8),
                Text(
                  'Site Code: ${task.siteCode ?? "KOS121"}',
                  style: AppTypography.bodyMedium.copyWith(fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                const Icon(Icons.location_on_outlined, size: 18, color: AppColors.darkSlate),
                const SizedBox(width: 8),
                Text(
                  'Lat: ${task.latitude?.toStringAsFixed(5) ?? "27.71720"} N',
                  style: AppTypography.bodyMedium,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                const Icon(Icons.explore_outlined, size: 18, color: AppColors.darkSlate),
                const SizedBox(width: 8),
                Text(
                  'Long: ${task.longitude?.toStringAsFixed(5) ?? "85.32400"} E',
                  style: AppTypography.bodyMedium,
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Divider(color: AppColors.subtleDivider),
            const SizedBox(height: 10),
            Row(
              children: [
                const Icon(Icons.verified_outlined, size: 16, color: Color(0xFF2E7D32)),
                const SizedBox(width: 8),
                Text('Stateless Verification Active', style: AppTypography.bodySmall.copyWith(fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'Hardware camera photos capture live GPS to guarantee physical site presence for QC audit.',
              style: AppTypography.caption,
            ),
          ],
        ),
      ),
    );
  }
}
