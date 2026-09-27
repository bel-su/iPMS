import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import '../../../core/services/background_watermark_service.dart';
import '../../../core/services/camera_service.dart';
import '../../../core/services/watermark_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../auth/providers/auth_provider.dart';
import '../../map/presentation/site_map_screen.dart';
import '../domain/models/checklist_item.dart';
import '../domain/models/task_evidence.dart';
import '../domain/models/task_item.dart';
import '../providers/evidence_provider.dart';
import '../providers/task_providers.dart';
import 'widgets/photo_preview_modal.dart';
import 'widgets/session_photo_browser_modal.dart';

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
  StreamSubscription<TaskEvidence>? _watermarkSub;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _checklist = _generateChecklistForTask(widget.task);

    // Reactively receive completed background watermark jobs
    _watermarkSub =
        BackgroundWatermarkService.onWatermarkCompleted.listen((evidence) {
      if (evidence.taskId == widget.task.id && mounted) {
        ref.read(taskEvidenceProvider.notifier).addEvidence(evidence);
        if (evidence.checklistItemId != null) {
          final idx =
              _checklist.indexWhere((c) => c.id == evidence.checklistItemId);
          if (idx != -1 && !_checklist[idx].isCompleted) {
            setState(() {
              _checklist[idx] = _checklist[idx].copyWith(
                isCompleted: true,
                verdict: 'PASS',
              );
            });
          }
        }
      }
    });
  }

  @override
  void dispose() {
    _watermarkSub?.cancel();
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
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            content: Row(
              children: [
                const Icon(Icons.verified_outlined,
                    color: Color(0xFFDDD7F7), size: 18),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Photo watermarked & saved to app gallery for ${item.itemNumber}',
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

  void _toggleItemNA(int index) {
    final item = _checklist[index];
    setState(() {
      if (item.verdict == 'NA') {
        final itemEvidence = ref
            .read(taskEvidenceListProvider(widget.task.id))
            .where((e) => e.checklistItemId == item.id)
            .toList();
        _checklist[index] = item.copyWith(
          verdict: itemEvidence.isNotEmpty ? 'PASS' : 'PENDING',
          isCompleted: itemEvidence.isNotEmpty,
        );
      } else {
        _checklist[index] = item.copyWith(
          verdict: 'NA',
          isCompleted: true,
        );
      }
    });
  }

  void _openSessionPhotoBrowser(TaskItem task, ChecklistItem item) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => SessionPhotoBrowserModal(
        task: task,
        item: item,
        onPhotosAttached: (attached) {
          setState(() {
            final idx = _checklist.indexWhere((c) => c.id == item.id);
            if (idx != -1) {
              _checklist[idx] = _checklist[idx].copyWith(
                isCompleted: true,
                verdict: 'PASS',
              );
            }
          });
        },
        onCaptureNewRequested: () {
          _capturePhotoForItem(task, item);
        },
      ),
    );
  }

  Future<void> _startMultiPhotoCapture(TaskItem task) async {
    final picker = ImagePicker();
    final authUser = ref.read(authStateProvider).value;
    final username = authUser?.username ?? 'engineer';
    final fullName = authUser?.displayName;

    double latitude = 27.7172;
    double longitude = 85.3240;
    double accuracy = 5.0;

    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 4),
        ),
      );
      latitude = pos.latitude;
      longitude = pos.longitude;
      accuracy = pos.accuracy;
    } catch (_) {}

    int snappedCount = 0;
    bool continueSnapping = true;

    while (continueSnapping && mounted) {
      final pickedFile = await picker.pickImage(
        source: ImageSource.camera,
        imageQuality: 88,
        maxWidth: 2048,
        maxHeight: 2048,
      );

      if (pickedFile == null) {
        break;
      }

      snappedCount++;
      final rawBytes = await pickedFile.readAsBytes();
      final now = DateTime.now();

      final metadata = WatermarkMetadata(
        siteCode: task.siteCode ?? 'KOS121',
        siteName: task.siteName ?? 'Site Location',
        projectCode: task.category.isNotEmpty ? task.category : 'PRJ-5G-METRO',
        latitude: latitude,
        longitude: longitude,
        accuracy: accuracy,
        timestamp: now,
        username: username,
        fullName: fullName,
        taskTitle: task.title,
      );

      final job = QueuedWatermarkJob(
        id: 'job-${now.millisecondsSinceEpoch}-$snappedCount',
        taskId: task.id,
        rawBytes: rawBytes,
        rawFilePath: pickedFile.path,
        metadata: metadata,
        queuedAt: now,
      );

      // Enqueue for background watermarking & app private storage
      await BackgroundWatermarkService.enqueueJob(job);

      if (!mounted) break;

      final shouldContinue = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Row(
            children: [
              const Icon(Icons.camera_alt_outlined,
                  color: AppColors.primaryLavenderDark),
              const SizedBox(width: 8),
              Text('Photo #$snappedCount Captured',
                  style: const TextStyle(fontSize: 16)),
            ],
          ),
          content: Text(
            'Photo #$snappedCount is watermarking in background and saved exclusively to the in-app session gallery.\n\nSnap another photo for this session?',
            style: const TextStyle(fontSize: 13),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Finish Shooting',
                  style: TextStyle(color: AppColors.textSecondary)),
            ),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.darkSlate,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10)),
              ),
              icon: const Icon(Icons.add_a_photo, size: 16),
              label: const Text('Snap Next Photo'),
              onPressed: () => Navigator.pop(ctx, true),
            ),
          ],
        ),
      );

      if (shouldContinue != true) {
        continueSnapping = false;
      }
    }

    if (snappedCount > 0 && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppColors.darkSlate,
          behavior: SnackBarBehavior.floating,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          content: Text(
            '$snappedCount photo(s) captured! Background watermarking running. Tap "Browse" on any checklist item to assign.',
            style: const TextStyle(fontSize: 12, color: Colors.white),
          ),
        ),
      );
    }
  }

  void _submitChecklistToQC(TaskItem task, List<TaskEvidence> evidenceList) {
    final missingItems = _checklist.where((item) {
      if (item.verdict == 'NA') return false;
      final photos =
          evidenceList.where((e) => e.checklistItemId == item.id).length;
      return photos < item.minPhotos;
    }).toList();

    if (missingItems.isNotEmpty) {
      _showIncompleteSubmissionSheet(task, missingItems);
      return;
    }

    ref.read(taskEvidenceProvider.notifier).submitEvidence(task.id);

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
                'Checklist & evidence successfully dispatched to QC Reviewer.',
                style: TextStyle(fontSize: 12, color: Colors.white),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showIncompleteSubmissionSheet(
    TaskItem task,
    List<ChecklistItem> missingItems,
  ) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(
            20, 16, 20, MediaQuery.of(ctx).viewInsets.bottom + 24),
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
                  child: const Icon(Icons.warning_amber_rounded,
                      color: Color(0xFFC62828), size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Checklist Evidence Incomplete',
                        style: AppTypography.titleMedium
                            .copyWith(fontWeight: FontWeight.bold),
                      ),
                      Text(
                        '${missingItems.length} item(s) missing photo proof or N/A declaration',
                        style: AppTypography.caption
                            .copyWith(color: AppColors.statusBlockedText),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            const Text(
              'QC requires each checklist item to have watermarked photographic evidence attached from the in-app session, or be explicitly marked N/A.',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
            ),
            const SizedBox(height: 12),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 220),
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: missingItems.length,
                separatorBuilder: (context, index) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final missingItem = missingItems[i];
                  return Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: AppColors.searchFieldBackground,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.subtleDivider),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.darkSlate,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            missingItem.itemNumber,
                            style: const TextStyle(
                                fontSize: 10,
                                color: Colors.white,
                                fontWeight: FontWeight.bold),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            missingItem.title,
                            style: const TextStyle(
                                fontSize: 12, fontWeight: FontWeight.w500),
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
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 10),
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8)),
                            ),
                            icon:
                                const Icon(Icons.camera_alt_outlined, size: 14),
                            label: const Text('Click',
                                style: TextStyle(fontSize: 11)),
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
            SizedBox(
              width: double.infinity,
              height: 44,
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Back to Checklist'),
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

    final completedItemsCount = _checklist
        .where((e) =>
            e.verdict == 'NA' ||
            evidenceList.any((ev) => ev.checklistItemId == e.id))
        .length;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(task.siteCode ?? 'Task Detail',
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
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
                            side:
                                const BorderSide(color: AppColors.subtleDivider),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 10),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Deadline', style: AppTypography.caption),
                                const SizedBox(height: 4),
                                Row(
                                  children: [
                                    const Icon(Icons.calendar_month_outlined,
                                        size: 15, color: AppColors.darkSlate),
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
                            side:
                                const BorderSide(color: AppColors.subtleDivider),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 10),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('App Evidence',
                                    style: AppTypography.caption),
                                const SizedBox(height: 4),
                                Row(
                                  children: [
                                    const Icon(Icons.photo_library_outlined,
                                        size: 15, color: AppColors.darkSlate),
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
                  const SizedBox(height: 8),

                  // Background Watermark Processing Banner
                  ValueListenableBuilder<int>(
                    valueListenable:
                        BackgroundWatermarkService.activeJobsNotifier,
                    builder: (context, activeCount, child) {
                      if (activeCount == 0) return const SizedBox.shrink();
                      return Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEDE7F6),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: const Color(0xFFDDD7F7)),
                        ),
                        child: Row(
                          children: [
                            const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppColors.primaryLavenderDark,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Background Watermark: $activeCount photo(s) processing...',
                                style: const TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.primaryLavenderDark,
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),

                  // Segmented 2-Tab Header (Checklist & Site Map)
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
                      labelStyle: const TextStyle(
                          fontSize: 12, fontWeight: FontWeight.bold),
                      tabs: [
                        Tab(
                            text:
                                'Checklist ($completedItemsCount/${_checklist.length})'),
                        const Tab(text: 'Site & Map'),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Tab View Content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: TabBarView(
                  controller: _tabController,
                  children: [
                    _buildChecklistTab(task, evidenceList),
                    _buildSiteInfoTab(task),
                  ],
                ),
              ),
            ),

            // Bottom Action Bar: OSM Map, Multi-Photo Shoot, and Submit to QC
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
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
                  // Map Button
                  IconButton.filledTonal(
                    style: IconButton.styleFrom(
                      padding: const EdgeInsets.all(12),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
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
                  const SizedBox(width: 8),

                  // Continuous Multi-Photo Rapid Shoot Button
                  Expanded(
                    flex: 5,
                    child: SizedBox(
                      height: 48,
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.darkSlate,
                          side: const BorderSide(
                              color: AppColors.darkSlate, width: 1.2),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12)),
                        ),
                        icon:
                            const Icon(Icons.add_a_photo_outlined, size: 18),
                        label: const Text(
                          'Multi-Photo Shoot',
                          style: TextStyle(
                              fontSize: 12, fontWeight: FontWeight.bold),
                        ),
                        onPressed: () => _startMultiPhotoCapture(task),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),

                  // Submit Checklist & Evidence to QC
                  Expanded(
                    flex: 5,
                    child: SizedBox(
                      height: 48,
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF2E7D32),
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12)),
                        ),
                        icon: const Icon(Icons.send_rounded, size: 18),
                        label: const Text(
                          'Submit to QC',
                          style: TextStyle(
                              fontSize: 12, fontWeight: FontWeight.bold),
                        ),
                        onPressed: () =>
                            _submitChecklistToQC(task, evidenceList),
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
    final unassignedPhotos =
        ref.watch(unassignedSessionPhotosProvider(task.id));
    final itemsWithEvidence = _checklist
        .where((item) =>
            item.verdict == 'NA' ||
            evidenceList.any((e) => e.checklistItemId == item.id))
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
                  'Cleared: $itemsWithEvidence of ${_checklist.length} items (Evidence/NA)',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.darkSlate,
                  ),
                ),
              ),
              if (unassignedPhotos.isNotEmpty)
                Container(
                  margin: const EdgeInsets.only(right: 6),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF3E5F5),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    '${unassignedPhotos.length} in Tray',
                    style: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: AppColors.primaryLavenderDark,
                    ),
                  ),
                ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
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

        // List of Checklist Item Cards (Without tick checkbox; with 3 action buttons)
        ...List.generate(_checklist.length, (index) {
          final item = _checklist[index];
          final itemEvidence = evidenceList
              .where((e) => e.checklistItemId == item.id)
              .toList();
          final hasEvidence = itemEvidence.isNotEmpty;
          final isNA = item.verdict == 'NA';

          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: BorderSide(
                color: isNA
                    ? AppColors.subtleDivider
                    : hasEvidence
                        ? const Color(0xFF2E7D32).withValues(alpha: 0.4)
                        : AppColors.subtleDivider,
                width: hasEvidence ? 1.4 : 1,
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Top Row: Item Number Pill + Title + Status Badge (NO TICK CHECKBOX!)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 2.5),
                        decoration: BoxDecoration(
                          color: isNA
                              ? AppColors.textTertiary
                              : AppColors.darkSlate,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          item.itemNumber,
                          style: const TextStyle(
                            fontSize: 10,
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          item.title,
                          style: AppTypography.bodyMedium.copyWith(
                            fontWeight: FontWeight.w600,
                            color: isNA
                                ? AppColors.textTertiary
                                : AppColors.textPrimary,
                            decoration: isNA ? TextDecoration.lineThrough : null,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),

                      // Status Badge
                      if (isNA)
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFFEEEEEE),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: AppColors.subtleDivider),
                          ),
                          child: const Text(
                            'N/A',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: AppColors.textSecondary,
                            ),
                          ),
                        )
                      else if (hasEvidence)
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFFE8F5E9),
                            borderRadius: BorderRadius.circular(6),
                            border:
                                Border.all(color: const Color(0xFFC8E6C9)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.verified,
                                  size: 12, color: Color(0xFF1B5E20)),
                              const SizedBox(width: 4),
                              Text(
                                'COMPLETED (${itemEvidence.length})',
                                style: const TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF1B5E20),
                                ),
                              ),
                            ],
                          ),
                        )
                      else
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFFF3E0),
                            borderRadius: BorderRadius.circular(6),
                            border:
                                Border.all(color: const Color(0xFFFFE0B2)),
                          ),
                          child: const Text(
                            'PENDING EVIDENCE',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFFE65100),
                            ),
                          ),
                        ),
                    ],
                  ),

                  if (item.guidanceText != null &&
                      item.guidanceText!.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(
                      item.guidanceText!,
                      style: AppTypography.caption.copyWith(
                        color: AppColors.textSecondary,
                        fontStyle: FontStyle.italic,
                        fontSize: 11,
                      ),
                    ),
                  ],

                  // Inline Evidence Thumbnails Strip (Stored in app private storage only)
                  if (hasEvidence) ...[
                    const SizedBox(height: 12),
                    SizedBox(
                      height: 82,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: itemEvidence.length,
                        separatorBuilder: (context, index) =>
                            const SizedBox(width: 8),
                        itemBuilder: (context, thumbIdx) {
                          final ev = itemEvidence[thumbIdx];
                          return Stack(
                            children: [
                              InkWell(
                                onTap: () {
                                  Navigator.push(
                                    context,
                                    MaterialPageRoute<void>(
                                      builder: (_) =>
                                          PhotoPreviewModal(evidence: ev),
                                    ),
                                  );
                                },
                                borderRadius: BorderRadius.circular(10),
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(10),
                                  child: SizedBox(
                                    width: 78,
                                    height: 82,
                                    child: Image.file(
                                      File(ev.filePath),
                                      fit: BoxFit.cover,
                                      errorBuilder:
                                          (context, error, stackTrace) =>
                                              Container(
                                        color: AppColors.searchFieldBackground,
                                        child: const Icon(
                                            Icons.broken_image_outlined,
                                            size: 20),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                              // Detach [X] Button
                              Positioned(
                                top: 3,
                                right: 3,
                                child: InkWell(
                                  onTap: () {
                                    ref
                                        .read(taskEvidenceProvider.notifier)
                                        .detachFromItem(
                                            taskId: task.id,
                                            evidenceId: ev.id);
                                    final remaining = itemEvidence.length - 1;
                                    if (remaining == 0 &&
                                        item.verdict != 'NA') {
                                      setState(() {
                                        _checklist[index] = item.copyWith(
                                          isCompleted: false,
                                          verdict: 'PENDING',
                                        );
                                      });
                                    }
                                  },
                                  child: Container(
                                    padding: const EdgeInsets.all(2),
                                    decoration: const BoxDecoration(
                                      color: Colors.black54,
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(Icons.close,
                                        size: 13, color: Colors.white),
                                  ),
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                    ),
                  ],

                  const SizedBox(height: 12),
                  const Divider(color: AppColors.subtleDivider, height: 1),
                  const SizedBox(height: 10),

                  // 3 Dedicated Action Buttons: [N/A] | [Browse (count)] | [Click Image]
                  Row(
                    children: [
                      // 1. [N/A] Button
                      Expanded(
                        flex: 3,
                        child: SizedBox(
                          height: 36,
                          child: OutlinedButton(
                            style: OutlinedButton.styleFrom(
                              backgroundColor:
                                  isNA ? AppColors.darkSlate : Colors.white,
                              foregroundColor:
                                  isNA ? Colors.white : AppColors.textSecondary,
                              side: BorderSide(
                                color: isNA
                                    ? AppColors.darkSlate
                                    : AppColors.subtleDivider,
                              ),
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 4),
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8)),
                            ),
                            onPressed: () => _toggleItemNA(index),
                            child: Text(
                              isNA ? 'N/A Active' : 'N/A',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight:
                                    isNA ? FontWeight.bold : FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),

                      // 2. [Browse] Button (Shows unassigned session photos count)
                      Expanded(
                        flex: 4,
                        child: SizedBox(
                          height: 36,
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              backgroundColor: unassignedPhotos.isNotEmpty
                                  ? const Color(0xFFF3E5F5)
                                  : Colors.white,
                              foregroundColor: AppColors.primaryLavenderDark,
                              side: const BorderSide(color: Color(0xFFDDD7F7)),
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 6),
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8)),
                            ),
                            icon: const Icon(Icons.photo_library_outlined,
                                size: 14),
                            label: Text(
                              unassignedPhotos.isNotEmpty
                                  ? 'Browse (${unassignedPhotos.length})'
                                  : 'Browse',
                              style: const TextStyle(
                                  fontSize: 11, fontWeight: FontWeight.bold),
                            ),
                            onPressed: () =>
                                _openSessionPhotoBrowser(task, item),
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),

                      // 3. [Click Image] Button
                      Expanded(
                        flex: 4,
                        child: SizedBox(
                          height: 36,
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.darkSlate,
                              foregroundColor: Colors.white,
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 6),
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8)),
                            ),
                            icon: const Icon(Icons.camera_alt_outlined,
                                size: 14),
                            label: const Text(
                              'Click Image',
                              style: TextStyle(
                                  fontSize: 11, fontWeight: FontWeight.bold),
                            ),
                            onPressed: () => _capturePhotoForItem(task, item),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        }),
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
                Text('Site Identification & GPS',
                    style: AppTypography.titleLarge),
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
