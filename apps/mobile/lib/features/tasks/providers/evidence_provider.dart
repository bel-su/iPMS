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

  void submitEvidence(String taskId) {
    final list = state[taskId];
    if (list == null || list.isEmpty) return;

    final updatedList = list.map((e) => e.copyWith(isSubmitted: true)).toList();
    state = {
      ...state,
      taskId: updatedList,
    };
  }

  void removeEvidence(String taskId, String evidenceId) {
    final list = state[taskId];
    if (list == null) return;

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
