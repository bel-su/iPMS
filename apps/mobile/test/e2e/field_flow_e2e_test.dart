// End-to-end check of the field app's data layer against a running stack.
//
// Skipped unless IPMS_E2E_URL points at a gateway, e.g.
//   docker compose -f docker/docker-compose.yml up -d
//   IPMS_E2E_URL=http://localhost:3000 flutter test test/e2e
//
// As the admin it creates a project, a site, a published checklist and a work
// order assigned to the demo engineer; then, as the engineer and through the
// app's own repositories, it loads the work order and checklist, uploads a
// photo to the bucket, waits for the server to verify it, and submits.
import 'dart:io';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/env.dart';
import 'package:mobile/core/services/watermark_service.dart';
import 'package:mobile/features/auth/providers/auth_provider.dart';
import 'package:mobile/features/media/providers/evidence_upload_provider.dart';
import 'package:mobile/features/projects/providers/project_providers.dart';
import 'package:mobile/features/tasks/data/task_repository.dart';
import 'package:mobile/features/tasks/domain/models/task_evidence.dart';
import 'package:mobile/features/tasks/providers/evidence_provider.dart';
import 'package:mobile/features/tasks/providers/task_providers.dart';
import 'package:uuid/uuid.dart';

void main() {
  final baseUrl = Platform.environment['IPMS_E2E_URL'];
  // The demo accounts' password: IAM_DEMO_PASSWORD in docker/env/iam.env.
  final password = Platform.environment['IPMS_E2E_PASSWORD'] ?? 'P@ssw0rd1234';

  TestWidgetsFlutterBinding.ensureInitialized();

  test('engineer loads a work order, uploads evidence to the bucket and submits', () async {
    // flutter_test answers every HTTP request with 400; this test needs the network.
    HttpOverrides.global = null;
    FlutterSecureStorage.setMockInitialValues({});
    AppConfig.setCustomApiUrl(baseUrl!);

    final admin = await _session(baseUrl, 'admin@ipms.local', password);
    final engineerMe = (await (await _session(baseUrl, 'engineer@ipms.local', password)).get<Map<String, dynamic>>('/api/v1/auth/me')).data!;
    final engineerId = engineerMe['id'] as String;
    final suffix = DateTime.now().millisecondsSinceEpoch.toString();

    final project = (await admin.post<Map<String, dynamic>>('/api/v1/projects', data: {
      'code': 'E2E-$suffix',
      'name': 'Mobile E2E $suffix',
      'defaultGeofenceRadiusM': 300,
    })).data!;
    final projectId = project['id'] as String;
    final site = (await admin.post<Map<String, dynamic>>('/api/v1/projects/$projectId/sites', data: {
      'siteCode': 'E2E$suffix'.substring(0, 12),
      'name': 'E2E Tower',
      'latitude': 27.7172,
      'longitude': 85.324,
    })).data!;
    final siteId = site['id'] as String;
    await admin.post<void>('/api/v1/users/$engineerId/projects', data: {'level': 'PROJECT', 'projectId': projectId});

    final draft = (await admin.post<Map<String, dynamic>>('/api/v1/qc/templates/import/commit', data: {
      'code': 'E2E-$suffix',
      'name': 'E2E checklist',
      'category': 'QUALITY',
      'document': {
        'sections': [
          {
            'number': '1',
            'title': 'Civil',
            'items': [
              {'number': '1.1', 'requirementText': 'Foundation photo', 'minPhotos': 1, 'maxPhotos': 2},
              {'number': '1.2', 'requirementText': 'Fence (may be N/A)', 'allowsNa': true},
            ],
          },
        ],
      },
    })).data!;
    final templateId = (draft['templateId'] ?? draft['id']) as String;
    await admin.post<void>('/api/v1/qc/templates/$templateId/publish');

    // Scope grants reach qc and project over NATS; retry until they land.
    var created = false;
    for (var attempt = 0; attempt < 20 && !created; attempt++) {
      try {
        await admin.post<dynamic>('/api/v1/work-orders', data: {
          'projectId': projectId,
          'workOrderType': 'QUALITY_SELF_CHECK',
          'templateId': templateId,
          'siteIds': [siteId],
          'assigneeId': engineerId,
          'plannedCompletionAt': DateTime.now().add(const Duration(days: 3)).toUtc().toIso8601String(),
        });
        created = true;
      } on DioException {
        await Future<void>.delayed(const Duration(milliseconds: 500));
      }
    }
    expect(created, isTrue, reason: 'work order could not be created');

    // Everything below goes through the app's own code, signed in as the engineer.
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await container.read(authStateProvider.future);
    await container.read(authStateProvider.notifier).login('engineer@ipms.local', password);
    final user = container.read(authStateProvider).value!;
    expect(user.id, engineerId);
    expect(user.can('qc_evidence.upload'), isTrue);

    final projects = await container.read(projectRepositoryProvider).getProjects();
    expect(projects.map((p) => p.id), contains(projectId));
    final detail = await container.read(projectRepositoryProvider).getProjectById(projectId);
    expect(detail.sites.single.latitude, closeTo(27.7172, 1e-6));

    final tasks = await container.read(taskRepositoryProvider).getAssignedTasks(projectId: projectId);
    final task = tasks.single;
    expect(task.siteId, siteId);
    expect(task.latitude, closeTo(27.7172, 1e-6));

    final checklist = await container.read(taskRepositoryProvider).getChecklist(task.id);
    expect(checklist.items, hasLength(2));
    final photoItem = checklist.items.first;

    // A real watermark-sized JPEG, as the camera pipeline produces it.
    final rgba = Uint8List(640 * 480 * 4)..fillRange(0, 640 * 480 * 4, 180);
    final dir = await Directory.systemTemp.createTemp('e2e');
    addTearDown(() => dir.delete(recursive: true));
    final file = File('${dir.path}/evidence.jpg')
      ..writeAsBytesSync(encodeEvidenceJpeg((rgba: rgba, width: 640, height: 480)));

    final evidence = TaskEvidence(
      id: const Uuid().v7(),
      taskId: task.id,
      filePath: file.path,
      siteCode: task.siteCode ?? '',
      siteName: task.siteName ?? '',
      projectCode: task.projectCode ?? '',
      latitude: 27.7173,
      longitude: 85.3241,
      accuracy: 5,
      capturedBy: user.username,
      capturedAt: DateTime.now(),
      checklistItemId: photoItem.id,
    );
    container.read(taskEvidenceProvider.notifier).addEvidence(evidence);

    final notReady = await container.read(evidenceUploaderProvider).uploadAndWait(task.id, {evidence.id});
    expect(notReady, isEmpty, reason: notReady.map((e) => e.uploadError).join('; '));

    final submission = await container.read(taskRepositoryProvider).submitChecklist(
          checklist: checklist,
          responses: [
            ItemResponse(itemId: photoItem.id, result: 'PASS', photoMediaIds: [evidence.mediaId]),
            ItemResponse(itemId: checklist.items[1].id, result: 'NA'),
          ],
          idempotencyKey: const Uuid().v4(),
          deviceId: 'e2e-device',
          latitude: 27.7173,
          longitude: 85.3241,
        );
    expect(submission['status'], 'SUBMITTED');

    final after = await container.read(taskRepositoryProvider).getTaskById(task.id);
    expect(after.status, 'REVIEWING');
  }, skip: baseUrl == null ? 'Set IPMS_E2E_URL to run against a live stack' : false,
      timeout: const Timeout(Duration(minutes: 3)));
}

Future<Dio> _session(String baseUrl, String email, String password) async {
  final dio = Dio(BaseOptions(baseUrl: baseUrl));
  final tokens = (await dio.post<Map<String, dynamic>>('/api/v1/auth/login', data: {
    'email': email,
    'password': password,
  })).data!;
  dio.options.headers['Authorization'] = 'Bearer ${tokens['accessToken']}';
  return dio;
}
