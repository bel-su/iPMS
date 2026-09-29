import 'dart:io';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';
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
    String? checklistItemId,
    String? checklistItemTitle,
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

    // 2. Fetch live GPS coordinates. Without a fix the coordinates stay
    // placeholders and accuracy stays negative, so neither the watermark nor
    // the upload claims a location the phone never had.
    double latitude = 0;
    double longitude = 0;
    double accuracy = -1;

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
      checklistItemId: checklistItemId,
      checklistItemTitle: checklistItemTitle,
    );

    // 5. Apply bottom-left watermark (saved strictly to private in-app storage)
    final watermarkedFile = await WatermarkService.applyWatermark(
      imageBytes: rawBytes,
      metadata: metadata,
    );

    // Clean up temporary unwatermarked raw camera scratch file
    try {
      final rawFile = File(pickedFile.path);
      if (rawFile.existsSync()) {
        rawFile.deleteSync();
      }
    } catch (_) {}

    // 6. Build evidence record
    // UUIDv7: time-ordered, and the id the media service stores the file
    // under, so every upload retry names the same object.
    final evidence = TaskEvidence(
      id: const Uuid().v7(),
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
      checklistItemId: checklistItemId,
      checklistItemTitle: checklistItemTitle,
    );

    return CameraCaptureResult(
      evidence: evidence,
      file: watermarkedFile,
    );
  }
}
