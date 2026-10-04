import 'dart:async';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import '../../../core/services/background_watermark_service.dart';
import '../../../core/services/geofence_service.dart';
import '../../../core/services/watermark_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../auth/providers/auth_provider.dart';
import '../domain/models/checklist_item.dart';
import '../domain/models/task_item.dart';

/// A camera that stays open: every tap of the shutter files a photo against
/// one checklist item and is ready for the next. There is no retake / use
/// photo step, so it works one-handed (on a tower, say). Each photo is
/// watermarked in the background and then uploaded by the task screen.
///
/// Pops with the number of photos taken.
class ContinuousCameraScreen extends ConsumerStatefulWidget {
  const ContinuousCameraScreen({
    super.key,
    required this.task,
    required this.item,
  });

  final TaskItem task;
  final ChecklistItem item;

  @override
  ConsumerState<ContinuousCameraScreen> createState() =>
      _ContinuousCameraScreenState();
}

class _ContinuousCameraScreenState extends ConsumerState<ContinuousCameraScreen>
    with WidgetsBindingObserver {
  CameraController? _camera;
  String? _error;
  bool _taking = false;
  bool _torch = false;
  bool _flash = false;
  int _taken = 0;

  Position? _position;
  StreamSubscription<Position>? _positionSub;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_startCamera());
    unawaited(_startLocation());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _positionSub?.cancel();
    _camera?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final camera = _camera;
    if (state == AppLifecycleState.inactive) {
      _camera = null;
      if (mounted) setState(() {});
      camera?.dispose();
    } else if (state == AppLifecycleState.resumed &&
        _camera == null &&
        _error == null) {
      unawaited(_startCamera());
    }
  }

  Future<void> _startCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        throw CameraException('none', 'This phone has no camera.');
      }
      final back = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );
      final controller = CameraController(
        back,
        ResolutionPreset.veryHigh,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg,
      );
      await controller.initialize();
      await controller.setFlashMode(FlashMode.off);
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _camera = controller;
        _torch = false;
      });
    } on CameraException catch (e) {
      if (!mounted) return;
      setState(
        () => _error =
            e.code == 'CameraAccessDenied' ||
                e.code == 'CameraAccessDeniedWithoutPrompt'
            ? 'Camera access is turned off. Allow it for this app in Settings.'
            : (e.description ?? 'The camera could not be started.'),
      );
    }
  }

  Future<void> _startLocation() async {
    final first = await GeofenceService.currentPosition();
    if (!mounted) return;
    if (first != null) setState(() => _position = first);
    try {
      _positionSub =
          Geolocator.getPositionStream(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              distanceFilter: 0,
            ),
          ).listen((p) {
            if (mounted) setState(() => _position = p);
          }, onError: (_) {});
    } catch (_) {
      // Without a live stream the first fix still stands.
    }
  }

  GeofenceCheck get _fence => GeofenceService.evaluate(
    siteLatitude: widget.task.latitude,
    siteLongitude: widget.task.longitude,
    radiusM: widget.task.geofenceRadiusM,
    position: _position,
  );

  Future<void> _toggleTorch() async {
    final camera = _camera;
    if (camera == null) return;
    final next = !_torch;
    await camera.setFlashMode(next ? FlashMode.torch : FlashMode.off);
    if (mounted) setState(() => _torch = next);
  }

  Future<void> _shoot() async {
    final camera = _camera;
    if (camera == null || _taking || !camera.value.isInitialized) return;
    if (!_fence.allowed) return;
    setState(() => _taking = true);
    try {
      final shot = await camera.takePicture();
      final position = _position;
      final bytes = await shot.readAsBytes();
      final now = DateTime.now();
      final authUser = ref.read(authStateProvider).value;
      final task = widget.task;
      final item = widget.item;
      final itemTitle = '${item.itemNumber} ${item.title}';

      await BackgroundWatermarkService.enqueueJob(
        QueuedWatermarkJob(
          id: 'job-${now.microsecondsSinceEpoch}',
          taskId: task.id,
          rawBytes: bytes,
          rawFilePath: shot.path,
          checklistItemId: item.id,
          checklistItemTitle: itemTitle,
          queuedAt: now,
          metadata: WatermarkMetadata(
            username: authUser?.username ?? 'engineer',
            fullName: authUser?.displayName,
            siteCode: task.siteCode ?? '',
            siteName: task.siteName ?? 'Site Location',
            projectCode: task.projectCode ?? task.category,
            // No fix leaves the placeholders and a negative accuracy, so nothing
            // claims a location the phone never had.
            latitude: position?.latitude ?? 0,
            longitude: position?.longitude ?? 0,
            accuracy: position?.accuracy ?? -1,
            timestamp: now,
            taskTitle: task.title,
            checklistItemId: item.id,
            checklistItemTitle: itemTitle,
          ),
        ),
      );

      unawaited(HapticFeedback.mediumImpact());
      if (!mounted) return;
      setState(() {
        _taken++;
        _flash = true;
      });
      unawaited(
        Future<void>.delayed(const Duration(milliseconds: 90), () {
          if (mounted) setState(() => _flash = false);
        }),
      );
    } on CameraException catch (e) {
      _toast(e.description ?? 'The photo could not be taken.');
    } catch (e) {
      _toast('The photo could not be taken: $e');
    } finally {
      if (mounted) setState(() => _taking = false);
    }
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
      );
  }

  @override
  Widget build(BuildContext context) {
    final fence = _fence;
    final camera = _camera;
    final canShoot = camera != null && fence.allowed && !_taking;

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          if (camera != null && camera.value.isInitialized)
            Center(child: CameraPreview(camera))
          else if (_error != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70, fontSize: 15),
                ),
              ),
            )
          else
            const Center(child: CircularProgressIndicator(color: Colors.white)),
          if (_flash) const ColoredBox(color: Colors.white54),

          // Top: which item, where we stand against the geofence, torch.
          SafeArea(
            child: Align(
              alignment: Alignment.topCenter,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 8,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.black54,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              '${widget.item.itemNumber}  ${widget.item.title}',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filled(
                          style: IconButton.styleFrom(
                            backgroundColor: _torch
                                ? Colors.amber
                                : Colors.black54,
                            foregroundColor: _torch
                                ? Colors.black
                                : Colors.white,
                            fixedSize: const Size(48, 48),
                          ),
                          icon: Icon(
                            _torch ? Icons.flashlight_on : Icons.flashlight_off,
                            size: 22,
                          ),
                          tooltip: 'Torch',
                          onPressed: camera == null ? null : _toggleTorch,
                        ),
                      ],
                    ),
                    if (fence.state != GeofenceState.notApplicable) ...[
                      const SizedBox(height: 8),
                      _FenceBanner(check: fence, accuracy: _position?.accuracy),
                    ],
                  ],
                ),
              ),
            ),
          ),

          // Bottom Control Panel: Positioned directly at the bottom bezel for true thumb ergonomics
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              width: double.infinity,
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    Colors.black54,
                    Colors.black87,
                    Colors.black,
                  ],
                  stops: [0.0, 0.2, 0.55, 1.0],
                ),
              ),
              padding: const EdgeInsets.only(top: 24),
              child: SafeArea(
                top: false,
                minimum: const EdgeInsets.only(bottom: 28),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      // {image taken} component
                      Expanded(
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 10,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.18),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.25),
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(
                                  Icons.photo_camera_back_outlined,
                                  size: 16,
                                  color: Colors.white,
                                ),
                                const SizedBox(width: 6),
                                Flexible(
                                  child: Text(
                                    '$_taken taken',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w700,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),

                      // Clicking Shutter Button (Center)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: GestureDetector(
                          onTap: canShoot ? _shoot : null,
                          child: AnimatedOpacity(
                            duration: const Duration(milliseconds: 120),
                            opacity: canShoot ? 1 : 0.35,
                            child: Container(
                              width: 80,
                              height: 80,
                              padding: const EdgeInsets.all(5),
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                border: Border.all(color: Colors.white, width: 4),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withValues(alpha: 0.3),
                                    blurRadius: 10,
                                    offset: const Offset(0, 4),
                                  ),
                                ],
                              ),
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: _taking ? Colors.white70 : Colors.white,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),

                      // Done Button (Right)
                      Expanded(
                        child: Align(
                          alignment: Alignment.centerRight,
                          child: FilledButton.icon(
                            style: FilledButton.styleFrom(
                              backgroundColor: AppColors.primaryLavenderDark,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 14,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16),
                              ),
                              elevation: 2,
                            ),
                            icon: const Icon(Icons.check_rounded, size: 18),
                            label: const Text(
                              'Done',
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            onPressed: () => Navigator.pop(context, _taken),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FenceBanner extends StatelessWidget {
  const _FenceBanner({required this.check, required this.accuracy});

  final GeofenceCheck check;
  final double? accuracy;

  @override
  Widget build(BuildContext context) {
    final ok = check.allowed;
    final waiting = check.state == GeofenceState.noFix;
    final color = ok
        ? const Color(0xFF2E7D32)
        : (waiting ? const Color(0xFF8D6E00) : const Color(0xFFC62828));
    final text = switch (check.state) {
      GeofenceState.inside =>
        'On site · ${check.distanceM!.round()}m from centre (limit ${check.radiusM}m)',
      GeofenceState.noFix =>
        'Acquiring GPS… photos unlock once you are on site',
      _ => check.blockedReason ?? '',
    };
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(
            ok
                ? Icons.location_on
                : (waiting ? Icons.gps_not_fixed : Icons.location_off),
            size: 16,
            color: Colors.white,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
