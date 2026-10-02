import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/providers/auth_provider.dart';
import '../../projects/providers/project_providers.dart';
import '../data/task_repository.dart';
import '../domain/models/checklist_item.dart';
import '../domain/models/task_item.dart';

final taskRepositoryProvider = Provider<TaskRepository>((ref) {
  ref.watch(sessionOwnerProvider);
  return TaskRepository(
    apiClient: ref.watch(apiClientProvider),
    projectRepository: ref.watch(projectRepositoryProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
  );
});

class SelectedStatusFilterNotifier extends Notifier<String> {
  @override
  String build() => 'ALL';

  void setFilter(String status) => state = status;
}

final selectedStatusFilterProvider =
    NotifierProvider<SelectedStatusFilterNotifier, String>(
  SelectedStatusFilterNotifier.new,
);

class TaskSearchQueryNotifier extends Notifier<String> {
  @override
  String build() => '';

  void setQuery(String q) => state = q;
  void clear() => state = '';
}

final taskSearchQueryProvider =
    NotifierProvider<TaskSearchQueryNotifier, String>(
  TaskSearchQueryNotifier.new,
);

final assignedTasksProvider = FutureProvider<List<TaskItem>>((ref) async {
  final repository = ref.watch(taskRepositoryProvider);
  final status = ref.watch(selectedStatusFilterProvider);
  final query = ref.watch(taskSearchQueryProvider);
  return repository.getAssignedTasks(status: status, query: query);
});

final taskDetailProvider =
    FutureProvider.family<TaskItem, String>((ref, taskId) async {
  final repository = ref.watch(taskRepositoryProvider);
  return repository.getTaskById(taskId);
});

/// Every work order on one site that the caller can see, not only their own.
final siteTasksProvider = FutureProvider.family<List<TaskItem>,
    ({String projectId, String siteId, String siteCode})>((ref, site) async {
  final repository = ref.watch(taskRepositoryProvider);
  return repository.getAssignedTasks(
    projectId: site.projectId,
    siteId: site.siteId,
    siteCode: site.siteCode,
    assignedToMe: false,
  );
});

final taskChecklistProvider =
    FutureProvider.family<TaskChecklist, String>((ref, taskId) async {
  final repository = ref.watch(taskRepositoryProvider);
  return repository.getChecklist(taskId);
});
