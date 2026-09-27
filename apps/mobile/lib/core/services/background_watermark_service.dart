import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import '../../features/tasks/domain/models/task_evidence.dart';
import 'watermark_service.dart';

/// Representation of a raw camera snap pending background watermark processing.
class QueuedWatermarkJob {
  const QueuedWatermarkJob({
    required this.id,
    required this.taskId,
    required this.rawBytes,
    required this.rawFilePath,
    required this.metadata,
    this.checklistItemId,
    this.checklistItemTitle,
    required this.queuedAt,
  });

  final String id;
  final String taskId;
  final Uint8List rawBytes;
  final String rawFilePath;
  final WatermarkMetadata metadata;
  final String? checklistItemId;
  final String? checklistItemTitle;
  final DateTime queuedAt;
}

/// Asynchronous background processor for photo evidence watermarking.
/// Decouples camera shutter clicks from the canvas drawing pipeline,
/// ensuring a smooth, instant camera shooting experience for field personnel.
class BackgroundWatermarkService {
  BackgroundWatermarkService._();

  static final StreamController<TaskEvidence> _completedStream =
      StreamController<TaskEvidence>.broadcast();

  /// ValueNotifier indicating how many images are currently processing in the background.
  static final ValueNotifier<int> activeJobsNotifier = ValueNotifier<int>(0);

  static Stream<TaskEvidence> get onWatermarkCompleted => _completedStream.stream;

  /// Enqueues a captured photo for background watermarking.
  /// Runs asynchronously without freezing UI or camera viewports.
  static Future<void> enqueueJob(QueuedWatermarkJob job) async {
    activeJobsNotifier.value++;

    unawaited(() async {
      try {
        final watermarkedFile = await WatermarkService.applyWatermark(
          imageBytes: job.rawBytes,
          metadata: job.metadata,
        );

        // Delete unwatermarked scratch file from camera picker cache
        try {
          final rawFile = File(job.rawFilePath);
          if (rawFile.existsSync()) {
            rawFile.deleteSync();
          }
        } catch (_) {
          // Ignore cache deletion errors
        }

        final evidence = TaskEvidence(
          id: 'ev-${job.queuedAt.millisecondsSinceEpoch}',
          taskId: job.taskId,
          filePath: watermarkedFile.path,
          siteCode: job.metadata.siteCode,
          siteName: job.metadata.siteName,
          projectCode: job.metadata.projectCode,
          latitude: job.metadata.latitude,
          longitude: job.metadata.longitude,
          accuracy: job.metadata.accuracy,
          capturedBy: job.metadata.username,
          capturedAt: job.queuedAt,
          checklistItemId: job.checklistItemId,
          checklistItemTitle: job.checklistItemTitle,
        );

        _completedStream.add(evidence);
      } catch (err) {
        debugPrint('Background watermark processing error: $err');
      } finally {
        if (activeJobsNotifier.value > 0) {
          activeJobsNotifier.value--;
        }
      }
    }());
  }
}
