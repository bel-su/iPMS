import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/providers/auth_provider.dart';
import '../data/project_repository.dart';
import '../domain/models/project_item.dart';

final projectRepositoryProvider = Provider<ProjectRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return ProjectRepository(apiClient: apiClient);
});

final projectListProvider = FutureProvider<List<ProjectItem>>((ref) async {
  final repo = ref.watch(projectRepositoryProvider);
  return await repo.getProjects();
});

class SelectedProjectNotifier extends Notifier<ProjectItem?> {
  @override
  ProjectItem? build() => null;

  void select(ProjectItem? project) => state = project;
}

final selectedProjectProvider =
    NotifierProvider<SelectedProjectNotifier, ProjectItem?>(
  SelectedProjectNotifier.new,
);

class SelectedSiteNotifier extends Notifier<ProjectSite?> {
  @override
  ProjectSite? build() => null;

  void select(ProjectSite? site) => state = site;
}

final selectedSiteProvider =
    NotifierProvider<SelectedSiteNotifier, ProjectSite?>(
  SelectedSiteNotifier.new,
);
