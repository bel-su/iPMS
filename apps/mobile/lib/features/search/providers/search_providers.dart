import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../tasks/domain/models/task_item.dart';
import '../../tasks/providers/task_providers.dart';

/// Provider holding the current search query.
class SearchQueryNotifier extends Notifier<String> {
  @override
  String build() => '';

  void setQuery(String q) => state = q;
  void clear() => state = '';
}

final searchQueryProvider =
    NotifierProvider<SearchQueryNotifier, String>(SearchQueryNotifier.new);

/// Category / Filter selection in search
class SearchCategoryNotifier extends Notifier<String> {
  @override
  String build() => 'ALL';

  void setCategory(String cat) => state = cat;
}

final searchCategoryFilterProvider =
    NotifierProvider<SearchCategoryNotifier, String>(SearchCategoryNotifier.new);

/// Search results provider querying tasks directly via TaskRepository
final searchResultsProvider = FutureProvider<List<TaskItem>>((ref) async {
  final repository = ref.watch(taskRepositoryProvider);
  final query = ref.watch(searchQueryProvider);
  final category = ref.watch(searchCategoryFilterProvider);

  final results = await repository.getAssignedTasks(query: query);

  if (category == 'ALL') {
    return results;
  }

  return results.where((item) {
    if (category == 'HIGH_PRIORITY') {
      return item.priority.toLowerCase() == 'high';
    }
    return item.category.toLowerCase().contains(category.toLowerCase());
  }).toList();
});
