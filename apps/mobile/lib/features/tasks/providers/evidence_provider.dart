import 'dart:async';
import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/services/background_watermark_service.dart';
import '../../../core/storage/evidence_store.dart';
import '../../auth/providers/auth_provider.dart';
import '../domain/models/task_evidence.dart';

final evidenceStoreProvider = Provider<EvidenceStore>((ref) => EvidenceStore());

/// The photos this phone holds, by work order id. Kept per account and saved
/// to app-private storage, so unsent evidence survives the app being closed.
class TaskEvidenceNotifier extends Notifier<Map<String, List<TaskEvidence>>> {
  bool _restored = false;
  int _generation = 0;

  /// Submitted photos stay on the phone this long, then are deleted.
  static const Duration keepSubmittedFor = Duration(days: 30);

  /// Completes once the saved evidence for the current account is loaded.
  Future<void> get restored => _restoredCompleter.future;
  Completer<void> _restoredCompleter = Completer<void>();

  @override
  Map<String, List<TaskEvidence>> build() {
    // A different account signing in on this phone starts with its own photos.
    final owner = ref.watch(sessionOwnerProvider);
    final store = ref.watch(evidenceStoreProvider);
    _restored = false;
    _restoredCompleter = Completer<void>();
    final generation = ++_generation;

    listenSelf((_, next) {
      if (_restored && owner != null) unawaited(store.save(owner, next));
    });

    // Photos from a multi-shot session finish watermarking in the background,
    // possibly after the task screen has closed; record them here so none is
    // lost.
    final watermarked = BackgroundWatermarkService.onWatermarkCompleted.listen(addEvidence);
    ref.onDispose(watermarked.cancel);

    if (owner == null) {
      _restored = true;
      _restoredCompleter.complete();
    } else {
      unawaited(_restore(owner, store, generation));
    }
    return {};
  }

  Future<void> _restore(String owner, EvidenceStore store, int generation) async {
    final saved = _dropExpired(await store.load(owner));
    // Another account signed in while this one was loading.
    if (generation != _generation) return;
    // Photos taken while loading are kept and listed first.
    final merged = <String, List<TaskEvidence>>{...saved};
    state.forEach((taskId, fresh) {
      final ids = fresh.map((e) => e.id).toSet();
      merged[taskId] = [...fresh, ...?saved[taskId]?.where((e) => !ids.contains(e.id))];
    });
    _restored = true;
    state = merged;
    if (!_restoredCompleter.isCompleted) _restoredCompleter.complete();
  }

  /// Deletes photos submitted more than [keepSubmittedFor] ago.
  Map<String, List<TaskEvidence>> _dropExpired(Map<String, List<TaskEvidence>> saved) {
    final cutoff = DateTime.now().subtract(keepSubmittedFor);
    final kept = <String, List<TaskEvidence>>{};
    saved.forEach((taskId, list) {
      final keep = <TaskEvidence>[];
      for (final e in list) {
        if (e.isSubmitted && e.capturedAt.isBefore(cutoff)) {
          try {
            File(e.filePath).deleteSync();
          } catch (_) {}
        } else {
          keep.add(e);
        }
      }
      if (keep.isNotEmpty) kept[taskId] = keep;
    });
    return kept;
  }

  void addEvidence(TaskEvidence evidence) {
    final currentList = state[evidence.taskId] ?? [];
    if (currentList.any((e) => e.id == evidence.id)) return;
    state = {
      ...state,
      evidence.taskId: [evidence, ...currentList],
    };
  }

  TaskEvidence? find(String taskId, String evidenceId) {
    for (final e in state[taskId] ?? const <TaskEvidence>[]) {
      if (e.id == evidenceId) return e;
    }
    return null;
  }

  /// Replaces one evidence record with [change] applied to it.
  void updateEvidence(
    String taskId,
    String evidenceId,
    TaskEvidence Function(TaskEvidence current) change,
  ) {
    final list = state[taskId];
    if (list == null) return;
    state = {
      ...state,
      taskId: [for (final e in list) e.id == evidenceId ? change(e) : e],
    };
  }

  /// Assigns a session photo to a specific checklist item
  void assignToItem({
    required String taskId,
    required String evidenceId,
    required String checklistItemId,
    required String checklistItemTitle,
  }) {
    final list = state[taskId];
    if (list == null) return;

    final updated = list.map((e) {
      if (e.id == evidenceId) {
        return e.copyWith(
          checklistItemId: checklistItemId,
          checklistItemTitle: checklistItemTitle,
        );
      }
      return e;
    }).toList();

    state = {
      ...state,
      taskId: updated,
    };
  }

  /// Detaches a photo from a checklist item back to unassigned session tray
  void detachFromItem({
    required String taskId,
    required String evidenceId,
  }) {
    final list = state[taskId];
    if (list == null) return;

    final updated = list.map((e) {
      if (e.id == evidenceId) {
        return e.copyWith(
          checklistItemId: '',
          checklistItemTitle: '',
        );
      }
      return e;
    }).toList();

    state = {
      ...state,
      taskId: updated,
    };
  }

  void submitEvidence(String taskId) {
    final list = state[taskId];
    if (list == null || list.isEmpty) return;

    final updatedList = list.map((e) => e.copyWith(isSubmitted: true)).toList();
    state = {
      ...state,
      taskId: updatedList,
    };
  }

  /// Removes evidence and permanently cleans up sandboxed file storage
  void removeEvidence(String taskId, String evidenceId) {
    final list = state[taskId];
    if (list == null) return;

    final toRemove = list.firstWhere(
      (e) => e.id == evidenceId,
      orElse: () => list.first,
    );

    // Physically delete file from private in-app storage
    try {
      final file = File(toRemove.filePath);
      if (file.existsSync()) {
        file.deleteSync();
      }
    } catch (_) {
      // Best-effort file cleanup
    }

    state = {
      ...state,
      taskId: list.where((e) => e.id != evidenceId).toList(),
    };
  }
}

final taskEvidenceProvider =
    NotifierProvider<TaskEvidenceNotifier, Map<String, List<TaskEvidence>>>(
  TaskEvidenceNotifier.new,
);

final taskEvidenceListProvider =
    Provider.family<List<TaskEvidence>, String>((ref, taskId) {
  final allEvidence = ref.watch(taskEvidenceProvider);
  return allEvidence[taskId] ?? [];
});

/// Returns evidence specifically captured for a given checklist item
final checklistItemEvidenceProvider =
    Provider.family<List<TaskEvidence>, ({String taskId, String itemId})>(
        (ref, arg) {
  final allEvidence = ref.watch(taskEvidenceProvider);
  final taskList = allEvidence[arg.taskId] ?? [];
  return taskList.where((e) => e.checklistItemId == arg.itemId).toList();
});

/// Returns unassigned photos in the session tray (available to browse & attach)
final unassignedSessionPhotosProvider =
    Provider.family<List<TaskEvidence>, String>((ref, taskId) {
  final allEvidence = ref.watch(taskEvidenceProvider);
  final taskList = allEvidence[taskId] ?? [];
  return taskList
      .where((e) => e.checklistItemId == null || e.checklistItemId!.isEmpty)
      .toList();
});
