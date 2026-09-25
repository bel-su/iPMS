import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/providers/auth_provider.dart';
import '../data/task_repository.dart';
import '../domain/models/task_item.dart';

final taskRepositoryProvider = Provider<TaskRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return TaskRepository(apiClient: apiClient);
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

final siteTasksProvider =
    FutureProvider.family<List<TaskItem>, String>((ref, siteCode) async {
  final repository = ref.watch(taskRepositoryProvider);
  return repository.getAssignedTasks(siteCode: siteCode);
});


