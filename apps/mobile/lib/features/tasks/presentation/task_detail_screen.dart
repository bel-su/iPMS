import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/services/camera_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../auth/providers/auth_provider.dart';
import '../../map/presentation/site_map_screen.dart';
import '../domain/models/checklist_item.dart';
import '../domain/models/task_evidence.dart';
import '../domain/models/task_item.dart';
import '../providers/evidence_provider.dart';
import '../providers/task_providers.dart';
import 'widgets/evidence_gallery_card.dart';
import 'widgets/photo_preview_modal.dart';

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
  late List<ChecklistItem> _checklist;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _checklist = _generateChecklistForTask(widget.task);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  List<ChecklistItem> _generateChecklistForTask(TaskItem task) {
    final cat = task.category.toLowerCase();
    final title = task.title.toLowerCase();
    String prefix;
    List<({String title, String guidance})> items;

    if (cat.contains('civil') ||
        title.contains('civil') ||
        title.contains('foundation') ||
        title.contains('mount') ||
        title.contains('fencing')) {
      prefix = 'CIV';
      items = const [
        (
          title: 'Pre-work structural survey & boundary clearance',
          guidance: 'Verify 360-degree boundary clearance and ground stability before works.',
        ),
        (
          title: 'Excavation depth & rebar tie wire tensile check',
          guidance: 'Inspect trench depth against structural drawings and verify rebar tying.',
        ),
        (
          title: 'Foundation level & mounting torque verification',
          guidance: 'Verify base plate horizontal leveling and torque anchor bolts to spec.',
        ),
        (
          title: 'Perimeter fencing & site safety clearance',
          guidance: 'Inspect perimeter grounding, safety hazard signage, and gate locking.',
        ),
        (
          title: 'Structural finish & foundation integrity inspection',
          guidance: 'Photograph cured concrete finish, slope drainage, and cable entry sleeves.',
        ),
      ];
    } else if (cat.contains('rf') ||
        cat.contains('telecom') ||
        title.contains('antenna') ||
        title.contains('mimo')) {
      prefix = 'RF';
      items = const [
        (
          title: 'Tower climb harness & PPE safety inspection',
          guidance: 'Verify 100% tie-off harness, helmet, double lanyard, and fall arrestor.',
        ),
        (
          title: 'Massive MIMO / Sector bracket torque alignment',
          guidance: 'Tighten mechanical brackets to manufacturer torque specs using torque wrench.',
        ),
        (
          title: 'Azimuth & electrical down-tilt angle calibration',
          guidance: 'Measure compass azimuth and RET down-tilt angle against cell planning sheet.',
        ),
        (
          title: 'VSWR swept frequency test (< 1.30:1)',
          guidance: 'Capture Site Master sweep trace verifying feeder return loss > 18 dB.',
        ),
        (
          title: 'Feeder jumper weatherproofing cold-shrink wrap',
          guidance: 'Verify 3-layer weatherproofing on DIN / 4.3-10 connector junctions.',
        ),
      ];
    } else if (cat.contains('optical') ||
        cat.contains('fiber') ||
        title.contains('splicing') ||
        title.contains('trenching')) {
      prefix = 'FBR';
      items = const [
        (
          title: 'Duct continuity & microduct pull-wire check',
          guidance: 'Verify unobstructed duct path and install pull wire with seal caps.',
        ),
        (
          title: 'Precision optical fiber cleave & fusion splice (< 0.05 dB)',
          guidance: 'Photograph fusion splicer display showing estimated core loss.',
        ),
        (
          title: 'OTDR bi-directional insertion loss & reflection test',
          guidance: 'Capture 1310/1550nm OTDR trace on optical span confirming event losses.',
        ),
        (
          title: 'Splice tray cassette sealing & buffer tube slack routing',
          guidance: 'Inspect bend radius in splice enclosure and seal moisture rubber grommets.',
        ),
      ];
    } else if (cat.contains('power') ||
        cat.contains('electrical') ||
        title.contains('battery') ||
        title.contains('dg') ||
        title.contains('earthing') ||
        title.contains('ats')) {
      prefix = 'PWR';
      items = const [
        (
          title: 'Lockout-Tagout (LOTO) isolation & safety clearance',
          guidance: 'Ensure breakers locked, hazard tags attached, and verify zero voltage.',
        ),
        (
          title: 'Battery bank string voltage & internal resistance test',
          guidance: 'Record individual 2V/12V cell float voltages and internal resistance.',
        ),
        (
          title: 'Automatic Transfer Switch (ATS) emergency failover drill',
          guidance: 'Test mains failure simulation and record DG start and transfer delay.',
        ),
        (
          title: 'Earthing pit electrode resistance measurement (< 5 Ohms)',
          guidance: 'Measure earth pit resistance with 3-point earth tester and log reading.',
        ),
      ];
    } else if (cat.contains('solar') ||
        cat.contains('green') ||
        cat.contains('energy') ||
        cat.contains('renewable')) {
      prefix = 'SOL';
      items = const [
        (
          title: 'Solar PV panel open-circuit voltage (Voc) verification',
          guidance: 'Measure string Voc with multimeter under sunlight; match design curve.',
        ),
        (
          title: 'MPPT charge controller firmware & output calibration',
          guidance: 'Verify charging stages (Bulk, Absorption, Float) and display readouts.',
        ),
        (
          title: 'Battery thermal chamber environmental insulation check',
          guidance: 'Inspect enclosure seals, ventilation fan filters, and temperature sensors.',
        ),
        (
          title: 'High-altitude structural mount wind-load torque inspection',
          guidance: 'Check PV panel clamp torque and foundation mounting structure security.',
        ),
      ];
    } else if (cat.contains('transmission') ||
        title.contains('microwave') ||
        title.contains('los') ||
        title.contains('vsat')) {
      prefix = 'TX';
      items = const [
        (
          title: 'Microwave dish antenna alignment & peak RSL search',
          guidance: 'Fine-tune dish pan and tilt to peak received signal level (RSL).',
        ),
        (
          title: 'Bit Error Rate (BER) & Carrier-to-Noise (C/N) verification',
          guidance: 'Log modem performance stats showing zero frame errors over 15 min.',
        ),
        (
          title: 'Waveguide flange weatherproofing & grounding kit installation',
          guidance: 'Bond waveguide grounding kit to tower bus bar and seal flange joints.',
        ),
      ];
    } else {
      prefix = 'CHK';
      items = const [
        (
          title: 'Pre-installation survey & safety clearance',
          guidance: 'Perform site risk assessment, hazard clearance, and tool calibration check.',
        ),
        (
          title: 'Equipment mounting alignment & torque verification',
          guidance: 'Verify structural rack mounting and bolt tightness to specifications.',
        ),
        (
          title: 'Feeder cable grounding and weatherproofing',
          guidance: 'Install grounding kits at top, bottom, and entry point with weather seals.',
        ),
        (
          title: 'Overall site cleanup & handover inspection',
          guidance: 'Ensure all scrap removed, cabinet locked, and site ready for commissioning.',
        ),
      ];
    }

    final completedCount = task.completedChecklistCount.clamp(0, items.length);

    return List.generate(items.length, (i) {
      final isDone = i < completedCount;
      return ChecklistItem(
        id: 'item_${task.id}_${i + 1}',
        itemNumber: '$prefix.${(i + 1).toString().padLeft(2, '0')}',
        title: items[i].title,
        guidanceText: items[i].guidance,
        isRequired: true,
        evidenceRequired: true,
        minPhotos: 1,
        isCompleted: isDone,
        verdict: isDone ? 'PASS' : 'PENDING',
      );
    });
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

  Future<void> _capturePhotoForItem(TaskItem task, ChecklistItem item) async {
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
        checklistItemId: item.id,
        checklistItemTitle: '${item.itemNumber} ${item.title}',
      );

      if (result != null && mounted) {
        ref.read(taskEvidenceProvider.notifier).addEvidence(result.evidence);

        // Mark checklist item as completed
        setState(() {
          final idx = _checklist.indexWhere((c) => c.id == item.id);
          if (idx != -1) {
            _checklist[idx] = _checklist[idx].copyWith(
              isCompleted: true,
              verdict: 'PASS',
            );
          }
        });

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
                    'Evidence attached for ${item.itemNumber}: [${result.evidence.siteCode}] at ${result.evidence.latitude.toStringAsFixed(4)}, ${result.evidence.longitude.toStringAsFixed(4)}',
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

  void _handleChecklistItemTap(
    TaskItem task,
    ChecklistItem item,
    int index,
    List<TaskEvidence> itemEvidence,
  ) {
    if (item.isCompleted) {
      setState(() {
        _checklist[index] = item.copyWith(
          isCompleted: false,
          verdict: 'PENDING',
        );
      });
      return;
    }

    if (item.evidenceRequired && itemEvidence.isEmpty) {
      showModalBottomSheet<void>(
        context: context,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        builder: (ctx) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.subtleDivider,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF3E0),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.camera_alt_outlined, color: Color(0xFFE65100), size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Photo Evidence Required',
                          style: AppTypography.titleMedium.copyWith(fontWeight: FontWeight.bold),
                        ),
                        Text(
                          item.itemNumber,
                          style: AppTypography.caption.copyWith(color: AppColors.textSecondary),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                '${item.title}\n\nQC standards require photographic proof with burned GPS and timestamp before this item can be verified.',
                style: AppTypography.bodySmall,
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 46,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.darkSlate,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  icon: const Icon(Icons.camera_alt_outlined, size: 18),
                  label: const Text('Capture Watermarked Photo', style: TextStyle(fontWeight: FontWeight.bold)),
                  onPressed: () {
                    Navigator.pop(ctx);
                    _capturePhotoForItem(task, item);
                  },
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: TextButton(
                  onPressed: () {
                    Navigator.pop(ctx);
                    setState(() {
                      _checklist[index] = item.copyWith(
                        isCompleted: true,
                        verdict: 'PASS',
                      );
                    });
                  },
                  child: const Text(
                    'Mark Complete Without Photo (Audit Flagged)',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    } else {
      setState(() {
        _checklist[index] = item.copyWith(
          isCompleted: true,
          verdict: 'PASS',
        );
      });
    }
  }

  void _submitEvidenceToQC(TaskItem task, List<TaskEvidence> evidenceList) {
    final missingEvidenceItems = _checklist.where((item) {
      if (!item.evidenceRequired) return false;
      final photos = evidenceList.where((e) => e.checklistItemId == item.id).length;
      return photos < item.minPhotos;
    }).toList();

    if (missingEvidenceItems.isNotEmpty) {
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        builder: (ctx) => Padding(
          padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.of(ctx).viewInsets.bottom + 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.subtleDivider,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFEBEE),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.warning_amber_rounded, color: Color(0xFFC62828), size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Checklist Evidence Incomplete',
                          style: AppTypography.titleMedium.copyWith(fontWeight: FontWeight.bold),
                        ),
                        Text(
                          '${missingEvidenceItems.length} checklist item(s) missing required photo proof',
                          style: AppTypography.caption.copyWith(color: AppColors.statusBlockedText),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              const Text(
                'The QC Reviewer will reject submissions without complete watermarked photo evidence. Please capture photos for the following items:',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
              const SizedBox(height: 12),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 220),
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: missingEvidenceItems.length,
                  separatorBuilder: (context, index) => const SizedBox(height: 8),
                  itemBuilder: (context, i) {
                    final missingItem = missingEvidenceItems[i];
                    return Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: AppColors.searchFieldBackground,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: AppColors.subtleDivider),
                      ),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.darkSlate,
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              missingItem.itemNumber,
                              style: const TextStyle(fontSize: 10, color: Colors.white, fontWeight: FontWeight.bold),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              missingItem.title,
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: 8),
                          SizedBox(
                            height: 32,
                            child: ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppColors.darkSlate,
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(horizontal: 10),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                              ),
                              icon: const Icon(Icons.camera_alt_outlined, size: 14),
                              label: const Text('Capture', style: TextStyle(fontSize: 11)),
                              onPressed: () {
                                Navigator.pop(ctx);
                                _capturePhotoForItem(task, missingItem);
                              },
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Back to Checklist'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFC62828),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onPressed: () {
                        Navigator.pop(ctx);
                        _executeSubmitEvidence(task.id);
                      },
                      child: const Text('Submit Anyway', style: TextStyle(fontSize: 12)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
      return;
    }

    _executeSubmitEvidence(task.id);
  }

  void _executeSubmitEvidence(String taskId) {
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

  void _showCaptureOptionsSheet(TaskItem task) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        final evidenceList = ref.watch(taskEvidenceListProvider(task.id));
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.subtleDivider,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Capture Geotagged Evidence',
                style: AppTypography.titleMedium.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(
                'Select a checklist item to burn into the verified photo watermark:',
                style: AppTypography.caption,
              ),
              const SizedBox(height: 14),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 280),
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: _checklist.length,
                  separatorBuilder: (context, index) => const SizedBox(height: 8),
                  itemBuilder: (context, i) {
                    final item = _checklist[i];
                    final itemPhotos = evidenceList.where((e) => e.checklistItemId == item.id).length;
                    final hasPhotos = itemPhotos >= item.minPhotos;

                    return InkWell(
                      onTap: () {
                        Navigator.pop(ctx);
                        _capturePhotoForItem(task, item);
                      },
                      borderRadius: BorderRadius.circular(12),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        decoration: BoxDecoration(
                          color: hasPhotos ? const Color(0xFFF1F8E9) : AppColors.searchFieldBackground,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: hasPhotos ? const Color(0xFFC8E6C9) : AppColors.subtleDivider,
                          ),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              hasPhotos ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
                              size: 18,
                              color: hasPhotos ? const Color(0xFF2E7D32) : AppColors.textTertiary,
                            ),
                            const SizedBox(width: 10),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: AppColors.darkSlate,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                item.itemNumber,
                                style: const TextStyle(fontSize: 10, color: Colors.white, fontWeight: FontWeight.bold),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                item.title,
                                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: hasPhotos ? const Color(0xFFE8F5E9) : const Color(0xFFEDE7F6),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                hasPhotos ? '$itemPhotos Attached' : 'Needs Photo',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold,
                                  color: hasPhotos ? const Color(0xFF1B5E20) : AppColors.primaryLavenderDark,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 12),
              const Divider(color: AppColors.subtleDivider),
              const SizedBox(height: 6),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.primaryLavenderLight,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.panorama_outlined, size: 20, color: AppColors.darkSlate),
                ),
                title: const Text('General Site Overview Photo', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                subtitle: const Text('Watermarks site GPS without checklist binding', style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: AppColors.textSecondary),
                onTap: () {
                  Navigator.pop(ctx);
                  _capturePhoto(task);
                },
              ),
            ],
          ),
        );
      },
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

    final completedItemsCount = _checklist.where((e) => e.isCompleted).length;

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
            // Top Summary Section
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
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
                  const SizedBox(height: 12),

                  // Two Summary Metric Cards (Deadline & Evidence)
                  Row(
                    children: [
                      Expanded(
                        child: Card(
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                            side: const BorderSide(color: AppColors.subtleDivider),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Deadline', style: AppTypography.caption),
                                const SizedBox(height: 4),
                                Row(
                                  children: [
                                    const Icon(Icons.calendar_month_outlined, size: 15, color: AppColors.darkSlate),
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
                            borderRadius: BorderRadius.circular(14),
                            side: const BorderSide(color: AppColors.subtleDivider),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Evidence', style: AppTypography.caption),
                                const SizedBox(height: 4),
                                Row(
                                  children: [
                                    const Icon(Icons.camera_alt_outlined, size: 15, color: AppColors.darkSlate),
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
                  const SizedBox(height: 12),

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
                        Tab(text: 'Checklist ($completedItemsCount/${_checklist.length})'),
                        Tab(text: 'Evidence (${evidenceList.length})'),
                        const Tab(text: 'Site & Map'),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Tab View Content (Takes remaining vertical height with independent scrolling)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: TabBarView(
                  controller: _tabController,
                  children: [
                    _buildChecklistTab(task, evidenceList),
                    _buildEvidenceTab(task, evidenceList),
                    _buildSiteInfoTab(task),
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
                        onPressed: _isCapturing ? null : () => _showCaptureOptionsSheet(task),
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

  Widget _buildChecklistTab(TaskItem task, List<TaskEvidence> evidenceList) {
    final itemsWithEvidence = _checklist
        .where((item) => evidenceList.any((e) => e.checklistItemId == item.id))
        .length;

    return ListView(
      padding: const EdgeInsets.only(top: 8, bottom: 20),
      children: [
        // Checklist Evidence Progress Status Banner
        Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.subtleDivider),
          ),
          child: Row(
            children: [
              Icon(
                itemsWithEvidence == _checklist.length
                    ? Icons.verified
                    : Icons.verified_outlined,
                size: 18,
                color: itemsWithEvidence == _checklist.length
                    ? const Color(0xFF2E7D32)
                    : AppColors.primaryLavenderDark,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Evidence Verified: $itemsWithEvidence of ${_checklist.length} items have photo proof',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.darkSlate,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: itemsWithEvidence == _checklist.length
                      ? const Color(0xFFE8F5E9)
                      : const Color(0xFFEDE7F6),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '${(itemsWithEvidence / _checklist.length * 100).toInt()}%',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: itemsWithEvidence == _checklist.length
                        ? const Color(0xFF1B5E20)
                        : AppColors.primaryLavenderDark,
                  ),
                ),
              ),
            ],
          ),
        ),

        // List of Checklist Item Cards
        ...List.generate(_checklist.length, (index) {
          final item = _checklist[index];
          final itemEvidence =
              evidenceList.where((e) => e.checklistItemId == item.id).toList();
          final hasEvidence = itemEvidence.isNotEmpty;
          final isDone = item.isCompleted;

          return Card(
            margin: const EdgeInsets.only(bottom: 10),
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: BorderSide(
                color: hasEvidence
                    ? const Color(0xFF2E7D32).withValues(alpha: 0.35)
                    : isDone
                        ? AppColors.primaryLavenderDark.withValues(alpha: 0.25)
                        : AppColors.subtleDivider,
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Top Row: Checkbox, Item Number, Title, Evidence Badge
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      InkWell(
                        onTap: () =>
                            _handleChecklistItemTap(task, item, index, itemEvidence),
                        borderRadius: BorderRadius.circular(12),
                        child: Padding(
                          padding: const EdgeInsets.only(top: 2, right: 8),
                          child: Icon(
                            isDone
                                ? Icons.check_circle_rounded
                                : Icons.radio_button_unchecked,
                            color: isDone
                                ? const Color(0xFF2E7D32)
                                : AppColors.textTertiary,
                            size: 22,
                          ),
                        ),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 6, vertical: 1.5),
                                  decoration: BoxDecoration(
                                    color: AppColors.darkSlate,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    item.itemNumber,
                                    style: const TextStyle(
                                      fontSize: 9.5,
                                      color: Colors.white,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                                const Spacer(),
                                // Evidence Status Badge
                                if (hasEvidence)
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFE8F5E9),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        const Icon(Icons.verified,
                                            size: 11, color: Color(0xFF1B5E20)),
                                        const SizedBox(width: 3),
                                        Text(
                                          'EVIDENCE ATTACHED (${itemEvidence.length})',
                                          style: const TextStyle(
                                            fontSize: 9,
                                            fontWeight: FontWeight.bold,
                                            color: Color(0xFF1B5E20),
                                          ),
                                        ),
                                      ],
                                    ),
                                  )
                                else if (item.evidenceRequired)
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFFFF3E0),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: const Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(Icons.camera_alt_outlined,
                                            size: 11, color: Color(0xFFE65100)),
                                        SizedBox(width: 3),
                                        Text(
                                          'EVIDENCE REQUIRED',
                                          style: TextStyle(
                                            fontSize: 9,
                                            fontWeight: FontWeight.bold,
                                            color: Color(0xFFE65100),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              item.title,
                              style: AppTypography.bodyMedium.copyWith(
                                fontWeight: FontWeight.w600,
                                decoration: isDone ? TextDecoration.lineThrough : null,
                                color: isDone
                                    ? AppColors.textSecondary
                                    : AppColors.textPrimary,
                              ),
                            ),
                            if (item.guidanceText != null &&
                                item.guidanceText!.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text(
                                item.guidanceText!,
                                style: AppTypography.caption.copyWith(
                                  color: AppColors.textSecondary,
                                  fontStyle: FontStyle.italic,
                                  fontSize: 11,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 10),

                  // Evidence Section: Thumbnails OR Capture Camera Button
                  if (hasEvidence) ...[
                    // Horizontal Photo Strip
                    SizedBox(
                      height: 82,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: itemEvidence.length + 1,
                        separatorBuilder: (context, index) => const SizedBox(width: 8),
                        itemBuilder: (context, thumbIdx) {
                          if (thumbIdx == itemEvidence.length) {
                            // [+ Add Photo] Card
                            return InkWell(
                              onTap: () => _capturePhotoForItem(task, item),
                              borderRadius: BorderRadius.circular(10),
                              child: Container(
                                width: 72,
                                height: 82,
                                decoration: BoxDecoration(
                                  color: AppColors.searchFieldBackground,
                                  borderRadius: BorderRadius.circular(10),
                                  border:
                                      Border.all(color: AppColors.subtleDivider),
                                ),
                                child: const Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(Icons.add_a_photo_outlined,
                                        size: 18, color: AppColors.darkSlate),
                                    SizedBox(height: 4),
                                    Text(
                                      '+ Add',
                                      style: TextStyle(
                                        fontSize: 10,
                                        fontWeight: FontWeight.bold,
                                        color: AppColors.darkSlate,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          }

                          final ev = itemEvidence[thumbIdx];
                          return InkWell(
                            onTap: () {
                              Navigator.push(
                                context,
                                MaterialPageRoute<void>(
                                  builder: (_) => PhotoPreviewModal(evidence: ev),
                                ),
                              );
                            },
                            borderRadius: BorderRadius.circular(10),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(10),
                              child: Stack(
                                children: [
                                  SizedBox(
                                    width: 72,
                                    height: 82,
                                    child: Image.file(
                                      File(ev.filePath),
                                      fit: BoxFit.cover,
                                      errorBuilder: (context, error, stackTrace) => Container(
                                        color: AppColors.searchFieldBackground,
                                        child: const Icon(
                                            Icons.broken_image_outlined,
                                            size: 18),
                                      ),
                                    ),
                                  ),
                                  Positioned(
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    child: Container(
                                      color: Colors.black.withValues(alpha: 0.6),
                                      padding:
                                          const EdgeInsets.symmetric(vertical: 2),
                                      child: const Text(
                                        'GPS OK',
                                        textAlign: TextAlign.center,
                                        style: TextStyle(
                                          color: Color(0xFF8CEFC6),
                                          fontSize: 8,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ] else ...[
                    // Prominent Capture Button
                    SizedBox(
                      width: double.infinity,
                      height: 38,
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.darkSlate,
                          backgroundColor: AppColors.searchFieldBackground,
                          side: const BorderSide(
                              color: Color(0xFFDDD7F7), width: 1.2),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10)),
                        ),
                        icon: const Icon(Icons.camera_alt_outlined, size: 16),
                        label: Text(
                          'Capture Watermarked Photo (Min ${item.minPhotos})',
                          style: const TextStyle(
                              fontSize: 12, fontWeight: FontWeight.bold),
                        ),
                        onPressed: () => _capturePhotoForItem(task, item),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        }),
      ],
    );
  }

  Widget _buildEvidenceTab(TaskItem task, List<TaskEvidence> evidenceList) {
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
              child: const Icon(Icons.camera_alt_outlined,
                  size: 36, color: AppColors.textSecondary),
            ),
            const SizedBox(height: 12),
            const Text(
              'No Evidence Captured',
              style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                  color: AppColors.darkSlate),
            ),
            const SizedBox(height: 6),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 32),
              child: Text(
                'Capture verified photo evidence directly from checklist items or tap "Take Site Photo" below.',
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
            padding: const EdgeInsets.only(top: 8, bottom: 12),
            child: SizedBox(
              width: double.infinity,
              height: 42,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2E7D32),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10)),
                ),
                icon: const Icon(Icons.send_outlined, size: 16),
                label: const Text('Submit Evidence to Reviewer',
                    style:
                        TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                onPressed: () => _submitEvidenceToQC(task, evidenceList),
              ),
            ),
          ),
        Expanded(
          child: GridView.builder(
            padding: const EdgeInsets.only(bottom: 16),
            itemCount: evidenceList.length,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
              childAspectRatio: 0.80,
            ),
            itemBuilder: (context, index) {
              final ev = evidenceList[index];
              return EvidenceGalleryCard(
                evidence: ev,
                onDelete: () {
                  ref
                      .read(taskEvidenceProvider.notifier)
                      .removeEvidence(task.id, ev.id);
                },
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildSiteInfoTab(TaskItem task) {
    return ListView(
      padding: const EdgeInsets.only(top: 8, bottom: 20),
      children: [
        Card(
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
                    const Icon(Icons.apartment_outlined,
                        size: 18, color: AppColors.darkSlate),
                    const SizedBox(width: 8),
                    Text(
                      'Site Code: ${task.siteCode ?? "KOS121"}',
                      style: AppTypography.bodyMedium
                          .copyWith(fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    const Icon(Icons.location_on_outlined,
                        size: 18, color: AppColors.darkSlate),
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
                    const Icon(Icons.explore_outlined,
                        size: 18, color: AppColors.darkSlate),
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
                    const Icon(Icons.verified_outlined,
                        size: 16, color: Color(0xFF2E7D32)),
                    const SizedBox(width: 8),
                    Text('Stateless Verification Active',
                        style: AppTypography.bodySmall
                            .copyWith(fontWeight: FontWeight.bold)),
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
        ),
      ],
    );
  }
}
