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

final assignedTasksProvider = FutureProvider<List<TaskItem>>((ref) async {
  final repository = ref.watch(taskRepositoryProvider);
  final status = ref.watch(selectedStatusFilterProvider);
  return repository.getAssignedTasks(status: status);
});

final taskDetailProvider =
    FutureProvider.family<TaskItem, String>((ref, taskId) async {
  final repository = ref.watch(taskRepositoryProvider);
  return repository.getTaskById(taskId);
});
