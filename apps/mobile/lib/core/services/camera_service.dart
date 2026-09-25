import 'dart:io';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import '../../features/tasks/domain/models/task_evidence.dart';
import 'watermark_service.dart';

class CameraCaptureResult {
  const CameraCaptureResult({
    required this.evidence,
    required this.file,
  });

  final TaskEvidence evidence;
  final File file;
}

/// Service handling hardware camera photo snapping, GPS retrieval,
/// and triggering the watermark graphics pipeline.
class CameraService {
  CameraService._();

  static final ImagePicker _picker = ImagePicker();

  /// Captures a photo with the native camera, queries GPS coordinates,
  /// applies the bottom-left watermark, and returns a TaskEvidence instance.
  static Future<CameraCaptureResult?> captureAndWatermark({
    required String taskId,
    required String siteCode,
    required String siteName,
    required String projectCode,
    required String username,
    String? fullName,
    String? taskTitle,
  }) async {
    // 1. Launch native hardware camera
    final pickedFile = await _picker.pickImage(
      source: ImageSource.camera,
      imageQuality: 88,
      maxWidth: 2048,
      maxHeight: 2048,
    );

    if (pickedFile == null) {
      // User cancelled camera capture
      return null;
    }

    // 2. Fetch live GPS coordinates with fallback
    double latitude = 27.7172;
    double longitude = 85.3240;
    double accuracy = 5.0;

    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (serviceEnabled) {
        var permission = await Geolocator.checkPermission();
        if (permission == LocationPermission.denied) {
          permission = await Geolocator.requestPermission();
        }

        if (permission == LocationPermission.always || permission == LocationPermission.whileInUse) {
          Position? position;
          try {
            position = await Geolocator.getCurrentPosition(
              locationSettings: const LocationSettings(
                accuracy: LocationAccuracy.high,
                timeLimit: Duration(seconds: 8),
              ),
            );
          } catch (_) {
            position = await Geolocator.getLastKnownPosition();
          }

          if (position != null) {
            latitude = position.latitude;
            longitude = position.longitude;
            accuracy = position.accuracy;
          }
        }
      }
    } catch (_) {
      // Graceful fallback to default/last coordinates
    }

    // 3. Read image bytes
    final rawBytes = await pickedFile.readAsBytes();

    // 4. Build metadata
    final now = DateTime.now();
    final metadata = WatermarkMetadata(
      username: username,
      fullName: fullName,
      siteCode: siteCode,
      siteName: siteName,
      projectCode: projectCode,
      latitude: latitude,
      longitude: longitude,
      accuracy: accuracy,
      timestamp: now,
      taskTitle: taskTitle,
    );

    // 5. Apply bottom-left watermark
    final watermarkedFile = await WatermarkService.applyWatermark(
      imageBytes: rawBytes,
      metadata: metadata,
    );

    // 6. Build evidence record
    final evidence = TaskEvidence(
      id: 'ev-${now.millisecondsSinceEpoch}',
      taskId: taskId,
      filePath: watermarkedFile.path,
      siteCode: siteCode,
      siteName: siteName,
      projectCode: projectCode,
      latitude: latitude,
      longitude: longitude,
      accuracy: accuracy,
      capturedBy: username,
      capturedAt: now,
    );

    return CameraCaptureResult(
      evidence: evidence,
      file: watermarkedFile,
    );
  }
}
