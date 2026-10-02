import 'package:dio/dio.dart';
import '../../../core/config/api_endpoints.dart';
import '../../../core/config/env.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/security/token_storage.dart';
import '../../projects/data/project_repository.dart';
import '../../projects/domain/models/project_item.dart';
import '../domain/models/checklist_item.dart';
import '../domain/models/task_item.dart';
import 'demo_tasks.dart';

/// One checklist item's answer in a submission.
class ItemResponse {
  const ItemResponse({
    required this.itemId,
    required this.result,
    this.photoMediaIds = const [],
    this.description,
  });

  final String itemId;

  /// PASS, FAIL or NA.
  final String result;
  final List<String> photoMediaIds;
  final String? description;

  Map<String, dynamic> toJson() => {
        'itemId': itemId,
        'selfCheckResult': result,
        'photoMediaIds': photoMediaIds,
        if (description != null && description!.isNotEmpty) 'selfCheckDescription': description,
      };
}

/// The field app's tasks are qc work orders: a checklist assigned to one
/// site, filled in on the phone and submitted for review.
class TaskRepository {
  TaskRepository({
    required this.apiClient,
    ProjectRepository? projectRepository,
    this.tokenStorage,
  }) : _projects = projectRepository ?? ProjectRepository(apiClient: apiClient);

  final ApiClient apiClient;
  final TokenStorage? tokenStorage;
  final ProjectRepository _projects;

  /// Sites by id, per project: work orders carry the site's code and name
  /// but not its coordinates, which the map and geofence need.
  final Map<String, Future<Map<String, ProjectSite>>> _sitesByProject = {};

  /// User names by id, for showing who a work order is assigned to.
  Future<Map<String, String>>? _directory;

  /// Sites and names change rarely; they are re-read after this long so an
  /// edit on the web still reaches a long-running app.
  static const Duration _lookupTtl = Duration(minutes: 5);
  DateTime _lookupsLoadedAt = DateTime.fromMillisecondsSinceEpoch(0);

  /// Work orders. With [assignedToMe] only the signed-in user's; a site's
  /// list shows everyone's work on it.
  Future<List<TaskItem>> getAssignedTasks({
    String? status,
    String? query,
    String? siteCode,
    String? siteId,
    String? projectId,
    bool assignedToMe = true,
  }) async {
    if (AppConfig.demoMode) {
      return DemoTasks.query(status: status, query: query, siteCode: siteCode, siteId: siteId);
    }
    try {
      final assigneeId = assignedToMe ? await tokenStorage?.getUserId() : null;
      final q = (query != null && query.trim().isNotEmpty) ? query.trim() : siteCode;
      final response = await apiClient.dio.get<Map<String, dynamic>>(
        ApiEndpoints.workOrders,
        queryParameters: {
          'limit': 100,
          if (status != null && status != 'ALL') 'status': status,
          if (q != null && q.isNotEmpty) 'q': q,
          'projectId': ?projectId,
          if (assigneeId != null && assigneeId.isNotEmpty) 'assigneeId': assigneeId,
        },
      );
      final items = (response.data?['items'] as List<dynamic>? ?? const [])
          .map((e) => TaskItem.fromWorkOrder(e as Map<String, dynamic>))
          // Cancelled work orders are closed office-side; the field never sees them.
          .where((t) => t.status != 'CANCELLED')
          .where((t) => siteId == null || t.siteId == siteId)
          .toList();
      return await _withLookups(items);
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load work orders.');
    }
  }

  Future<TaskItem> getTaskById(String taskId) async {
    if (AppConfig.demoMode) {
      return DemoTasks.query().firstWhere(
        (t) => t.id == taskId,
        orElse: () => DemoTasks.fallbackTask(taskId),
      );
    }
    try {
      final response =
          await apiClient.dio.get<Map<String, dynamic>>(ApiEndpoints.workOrder(taskId));
      final task = TaskItem.fromWorkOrder(response.data ?? const {});
      return (await _withLookups([task])).first;
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load the work order.');
    }
  }

  /// The published checklist this work order is filled in against.
  Future<TaskChecklist> getChecklist(String taskId) async {
    try {
      final response =
          await apiClient.dio.get<Map<String, dynamic>>(ApiEndpoints.checklist(taskId));
      return TaskChecklist.fromJson(response.data ?? const {});
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load the checklist.');
    }
  }

  /// The reviewer's feedback on a submission, for a work order sent back
  /// for rework.
  Future<ReviewFeedback> getReviewFeedback(String submissionId) async {
    try {
      final response =
          await apiClient.dio.get<Map<String, dynamic>>(ApiEndpoints.submission(submissionId));
      return ReviewFeedback.fromSubmission(response.data ?? const {});
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load the review.');
    }
  }

  /// Submits the filled-in checklist for review. [idempotencyKey] must stay
  /// the same across retries of one submission so a resend is not a second
  /// attempt.
  Future<Map<String, dynamic>> submitChecklist({
    required TaskChecklist checklist,
    required List<ItemResponse> responses,
    required String idempotencyKey,
    required String deviceId,
    double? latitude,
    double? longitude,
  }) async {
    try {
      final response = await apiClient.dio.post<Map<String, dynamic>>(
        ApiEndpoints.submissions,
        data: {
          'taskId': checklist.workOrderId,
          'siteId': checklist.siteId,
          'projectId': checklist.projectId,
          'templateVersionId': checklist.versionId,
          'idempotencyKey': idempotencyKey,
          'deviceId': deviceId,
          if (latitude != null && longitude != null) ...{
            'latitude': latitude,
            'longitude': longitude,
          },
          'responses': responses.map((r) => r.toJson()).toList(),
        },
      );
      return response.data ?? const {};
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to submit the checklist.');
    }
  }

  /// Adds what the work order does not carry: the site's coordinates and
  /// geofence (from the project service) and the assignee's name (from the
  /// user directory). Both are best effort.
  Future<List<TaskItem>> _withLookups(List<TaskItem> tasks) async {
    if (DateTime.now().difference(_lookupsLoadedAt) > _lookupTtl) {
      _sitesByProject.clear();
      _directory = null;
      _lookupsLoadedAt = DateTime.now();
    }
    final projectIds = tasks.map((t) => t.projectId).whereType<String>().toSet();
    final lookups = <String, Map<String, ProjectSite>>{};
    await Future.wait(projectIds.map((projectId) async {
      lookups[projectId] = await _sitesByProject.putIfAbsent(projectId, () async {
        try {
          final project = await _projects.getProjectById(projectId);
          return {for (final site in project.sites) site.id: site};
        } catch (_) {
          // Coordinates are a nicety; the work order is still usable without
          // them. Forget the failure so the next load tries again.
          _sitesByProject.remove(projectId);
          return const <String, ProjectSite>{};
        }
      });
    }));
    final names = await (_directory ??= _loadDirectory());

    return tasks.map((task) {
      final site = lookups[task.projectId]?[task.siteId];
      return task.copyWith(
        latitude: site?.latitude,
        longitude: site?.longitude,
        geofenceRadiusM: site?.geofenceRadiusM,
        assigneeName: names[task.assigneeId],
      );
    }).toList();
  }

  Future<Map<String, String>> _loadDirectory() async {
    try {
      final response = await apiClient.dio.get<List<dynamic>>(ApiEndpoints.userDirectory);
      return {
        for (final row in response.data ?? const <dynamic>[])
          if (row is Map && row['id'] != null)
            row['id'] as String: (row['fullName'] as String?) ?? '',
      };
    } catch (_) {
      _directory = null; // try again next time
      return const {};
    }
  }
}
