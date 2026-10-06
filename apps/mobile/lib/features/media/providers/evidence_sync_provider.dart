import 'dart:async';
import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/config/env.dart';
import '../../../core/storage/evidence_store.dart';
import '../../tasks/domain/models/task_evidence.dart';
import '../../tasks/domain/models/task_item.dart';
import '../../tasks/providers/evidence_provider.dart';
import '../data/media_repository.dart';
import 'evidence_upload_provider.dart';

final evidenceSyncProvider = Provider<EvidenceSync>((ref) => EvidenceSync(ref));

/// Brings the photos of a work order that were taken or uploaded elsewhere
/// (another phone, an earlier install) onto this phone.
///
/// The media bucket is the shared record: each photo is listed against the
/// work order and checklist item it was filed under. Whatever this phone does
/// not hold is downloaded into the same private storage as its own photos, so
/// the checklist shows and handles them exactly like a photo taken here.
class EvidenceSync {
  EvidenceSync(this._ref);

  final Ref _ref;
  final Set<String> _running = {};

  static const int _parallelDownloads = 3;

  /// Downloads the viewable photos of [task] this phone does not have yet and
  /// returns the checklist item ids that gained one. [itemTitles] names each
  /// item (`1.2 Title`) for the photo's record.
  Future<Set<String>> pull(
    TaskItem task,
    Map<String, String> itemTitles,
  ) async {
    if (AppConfig.demoMode || !_running.add(task.id)) return const {};
    try {
      final media = _ref.read(mediaRepositoryProvider);
      await _ref.read(taskEvidenceProvider.notifier).restored;

      final remote = (await media.listForWorkOrder(task.id))
          .where(
            (m) =>
                m.kind == 'PHOTO' && m.isViewable && m.checklistItemId != null,
          )
          .toList();
      final have =
          _ref
              .read(taskEvidenceProvider)[task.id]
              ?.map((e) => e.mediaId)
              .toSet() ??
          <String>{};
      final missing = remote.where((m) => !have.contains(m.id)).toList();
      if (missing.isEmpty) return const {};

      final dir = await EvidenceStore.defaultDirectory();
      if (!dir.existsSync()) dir.createSync(recursive: true);
      final gained = <String>{};

      Future<void> fetch(RemoteMedia m) async {
        try {
          final bytes = await media.download(await media.viewUrl(m.id));
          if (bytes.isEmpty) return;
          final file = File('${dir.path}/remote_${m.id}.jpg');
          await file.writeAsBytes(bytes, flush: true);
          final located = m.latitude != null && m.longitude != null;
          _ref
              .read(taskEvidenceProvider.notifier)
              .addEvidence(
                TaskEvidence(
                  id: m.id,
                  taskId: task.id,
                  filePath: file.path,
                  siteCode: task.siteCode ?? '',
                  siteName: task.siteName ?? '',
                  projectCode: task.projectCode ?? '',
                  latitude: m.latitude ?? 0,
                  longitude: m.longitude ?? 0,
                  // Negative accuracy marks "no fix", as for a photo taken here.
                  accuracy: located ? 0 : -1,
                  capturedBy: m.uploadedBy ?? '',
                  capturedAt: m.capturedAt ?? DateTime.now(),
                  checklistItemId: m.checklistItemId,
                  checklistItemTitle: itemTitles[m.checklistItemId],
                  // On a submission already: it is not sent again, only reused.
                  isSubmitted: m.status == 'ATTACHED',
                  uploadStatus: m.status == 'ATTACHED'
                      ? EvidenceUploadStatus.attached
                      : EvidenceUploadStatus.ready,
                ),
              );
          gained.add(m.checklistItemId!);
        } catch (_) {
          // This photo is tried again on the next visit; the rest go on.
        }
      }

      // A few at a time: all at once would swamp a site's weak connection.
      final queue = [...missing];
      await Future.wait(
        List.generate(_parallelDownloads, (_) async {
          while (queue.isNotEmpty) {
            await fetch(queue.removeLast());
          }
        }),
      );
      return gained;
    } finally {
      _running.remove(task.id);
    }
  }
}
