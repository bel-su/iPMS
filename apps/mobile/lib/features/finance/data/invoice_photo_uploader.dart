import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/watermark_service.dart' show maxEvidencePhotoBytes;
import '../../media/data/media_repository.dart';

/// Sends one invoice photo to the media bucket and waits until the server has
/// verified it. Every step is repeat-safe on [mediaId] and the file's hash, so
/// a retry after a dropped connection carries on with the same object.
class InvoicePhotoUploader {
  InvoicePhotoUploader({
    required this.media,
    required this.deviceId,
    this.pollInterval = const Duration(seconds: 1),
    this.timeout = const Duration(seconds: 60),
  });

  final MediaRepository media;
  final Future<String> Function() deviceId;
  final Duration pollInterval;
  final Duration timeout;

  /// Returns [mediaId] once the photo is READY. Throws [ApiException] saying
  /// what went wrong (too large, refused, still being checked, offline).
  Future<String> upload({required String projectId, required String mediaId, required Uint8List bytes}) async {
    if (bytes.length > maxEvidencePhotoBytes) {
      throw const ApiException(message: 'The photo is larger than 5 MB. Take or choose a smaller one.');
    }
    final hash = sha256.convert(bytes).toString();
    final device = await deviceId();

    Future<String> send() async {
      final registration = await media.registerFinanceDocument(
        id: mediaId,
        projectId: projectId,
        sizeBytes: bytes.length,
        contentHash: hash,
        capturedAt: DateTime.now(),
        deviceId: device,
      );
      if (!registration.needsBytes) return registration.status;
      await media.putBytes(registration, bytes);
      return media.completeFinanceDocument(mediaId);
    }

    String status;
    try {
      status = await send();
    } on ApiException catch (e) {
      // 412: the bytes had not arrived when `complete` ran. Send again once.
      if (e.statusCode != 412) rethrow;
      status = await send();
    }

    final deadline = DateTime.now().add(timeout);
    while (status != 'READY' && status != 'ATTACHED') {
      if (status == 'REJECTED') {
        throw const ApiException(message: 'The server refused this photo. Take or choose another.');
      }
      if (!DateTime.now().isBefore(deadline)) {
        throw const ApiException(message: 'The photo is still being checked. Try again in a moment.');
      }
      await Future<void>.delayed(pollInterval);
      final item = await media.financeDocumentStatus(mediaId);
      status = item?.status ?? 'UNKNOWN';
      if (status == 'UNKNOWN' || status == 'DISCARDED') {
        throw const ApiException(message: 'The upload did not finish. Try again.');
      }
    }
    return mediaId;
  }
}
