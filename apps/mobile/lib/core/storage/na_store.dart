import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';

/// Remembers which checklist items the engineer marked N/A, per work order,
/// so the mark survives leaving the task or closing the app. Without this an
/// N/A item comes back as unanswered and asks for its photos again.
class NaStore {
  NaStore({Future<Directory> Function()? directory})
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
    return File('${dir.path}/na_marks_$safeOwner.json');
  }

  Future<Map<String, dynamic>> _read(String ownerId) async {
    try {
      final file = await _file(ownerId);
      if (!file.existsSync()) return {};
      return jsonDecode(await file.readAsString()) as Map<String, dynamic>;
    } catch (_) {
      return {};
    }
  }

  Future<Set<String>> load(String ownerId, String taskId) async {
    final all = await _read(ownerId);
    return {
      for (final id in (all[taskId] as List<dynamic>? ?? const []))
        id as String,
    };
  }

  /// Replaces the N/A items of [taskId]; an empty set forgets the work order.
  Future<void> save(String ownerId, String taskId, Set<String> itemIds) {
    return _lastWrite = _lastWrite.then((_) async {
      try {
        final all = await _read(ownerId);
        if (itemIds.isEmpty) {
          all.remove(taskId);
        } else {
          all[taskId] = itemIds.toList();
        }
        final file = await _file(ownerId);
        final tmp = File('${file.path}.tmp');
        await tmp.writeAsString(jsonEncode(all), flush: true);
        await tmp.rename(file.path);
      } catch (_) {
        // Best effort: the mark is still held in memory for this session.
      }
    });
  }
}
