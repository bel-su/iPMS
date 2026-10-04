import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import '../../features/tasks/domain/models/task_evidence.dart';

/// Remembers which photos the phone holds for which work order, so captured
/// evidence and its upload state survive the app being closed.
///
/// This is the phone's own work in progress (the photos it took and has not
/// yet submitted), not server data: the media service's upload protocol
/// expects the phone to keep its queue until a submission is confirmed.
/// One file per account, next to the photos in app-private storage.
class EvidenceStore {
  EvidenceStore({Future<Directory> Function()? directory})
      : _directory = directory ?? _defaultDirectory;

  final Future<Directory> Function() _directory;
  Future<void> _lastWrite = Future.value();

  static Future<Directory> _defaultDirectory() async {
    final docs = await getApplicationDocumentsDirectory();
    return Directory('${docs.path}/app_session_evidence');
  }

  Future<File> _file(String ownerId) async {
    final dir = await _directory();
    if (!dir.existsSync()) dir.createSync(recursive: true);
    final safeOwner = ownerId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return File('${dir.path}/evidence_index_$safeOwner.json');
  }

  Future<Map<String, List<TaskEvidence>>> load(String ownerId) async {
    try {
      final file = await _file(ownerId);
      if (!file.existsSync()) return {};
      final dir = file.parent.path;
      final raw = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
      final result = <String, List<TaskEvidence>>{};
      raw.forEach((taskId, list) {
        final items = <TaskEvidence>[];
        for (final entry in list as List<dynamic>) {
          var ev = TaskEvidence.fromJson(entry as Map<String, dynamic>);
          // iOS moves the app container on every update, so paths are
          // re-rooted on the current photo directory.
          final name = ev.filePath.split(RegExp(r'[/\\]')).last;
          final path = '$dir/$name';
          if (!File(path).existsSync()) continue;
          // An upload cut off by the app closing has to be sent again; the
          // retry reuses the same media id, so nothing is duplicated.
          if (ev.uploadStatus == EvidenceUploadStatus.uploading) {
            ev = ev.copyWith(
              uploadStatus: EvidenceUploadStatus.failed,
              uploadError: 'Upload was interrupted. It will be sent again.',
            );
          }
          items.add(ev.copyWith(filePath: path));
        }
        if (items.isNotEmpty) result[taskId] = items;
      });
      return result;
    } catch (_) {
      // A missing or unreadable index must never stop the app; the photos
      // themselves are still on disk.
      return {};
    }
  }

  /// Writes are queued so a burst of changes lands in order.
  Future<void> save(String ownerId, Map<String, List<TaskEvidence>> evidence) {
    return _lastWrite = _lastWrite.then((_) async {
      try {
        final file = await _file(ownerId);
        final json = {
          for (final entry in evidence.entries)
            if (entry.value.isNotEmpty) entry.key: entry.value.map((e) => e.toJson()).toList(),
        };
        final tmp = File('${file.path}.tmp');
        await tmp.writeAsString(jsonEncode(json), flush: true);
        await tmp.rename(file.path);
      } catch (_) {
        // Best effort, as above.
      }
    });
  }
}
