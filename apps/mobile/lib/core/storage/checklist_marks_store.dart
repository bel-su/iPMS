import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';

/// What the engineer has answered on a work order's checklist apart from its
/// photos: which items are N/A, and the remark written on each item.
class ChecklistMarks {
  ChecklistMarks({this.na = const {}, this.remarks = const {}, DateTime? savedAt})
      : savedAt = savedAt ?? DateTime.now();

  final Set<String> na;
  final Map<String, String> remarks;

  /// When this phone last changed them, to tell whether a submission made
  /// since (from this or another phone) supersedes them.
  final DateTime savedAt;

  Map<String, dynamic> toJson() =>
      {'na': na.toList(), 'remarks': remarks, 'savedAt': savedAt.toIso8601String()};

  factory ChecklistMarks.fromJson(Map<String, dynamic> json) => ChecklistMarks(
        savedAt: DateTime.tryParse(json['savedAt']?.toString() ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0),
    na: {
      for (final id in (json['na'] as List<dynamic>? ?? const [])) id as String,
    },
    remarks: {
      for (final e
          in (json['remarks'] as Map<String, dynamic>? ?? const {}).entries)
        e.key: e.value as String,
    },
  );
}

/// Remembers [ChecklistMarks] per work order on the phone, so they survive
/// leaving the task or closing the app. A work order with no entry has not
/// been touched on this phone, and starts from what the server holds (its last
/// submission); an entry, even an empty one, is the phone's own newer work.
class ChecklistMarksStore {
  ChecklistMarksStore({Future<Directory> Function()? directory})
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
    return File('${dir.path}/checklist_marks_$safeOwner.json');
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

  /// Null when this phone has not recorded anything for [taskId].
  Future<ChecklistMarks?> load(String ownerId, String taskId) async {
    final entry = (await _read(ownerId))[taskId];
    return entry is Map<String, dynamic>
        ? ChecklistMarks.fromJson(entry)
        : null;
  }

  /// Saves [marks] for [taskId]; a null forgets the work order, so the next
  /// visit starts from the server again.
  Future<void> save(String ownerId, String taskId, ChecklistMarks? marks) {
    return _lastWrite = _lastWrite.then((_) async {
      try {
        final all = await _read(ownerId);
        if (marks == null) {
          all.remove(taskId);
        } else {
          all[taskId] = marks.toJson();
        }
        final file = await _file(ownerId);
        final tmp = File('${file.path}.tmp');
        await tmp.writeAsString(jsonEncode(all), flush: true);
        await tmp.rename(file.path);
      } catch (_) {
        // Best effort: the marks are still held in memory for this session.
      }
    });
  }
}
