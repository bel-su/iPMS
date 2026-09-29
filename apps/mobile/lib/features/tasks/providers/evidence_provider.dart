import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../domain/models/task_evidence.dart';

class TaskEvidenceNotifier extends Notifier<Map<String, List<TaskEvidence>>> {
  @override
  Map<String, List<TaskEvidence>> build() {
    return {};
  }

  void addEvidence(TaskEvidence evidence) {
    final currentList = state[evidence.taskId] ?? [];
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
