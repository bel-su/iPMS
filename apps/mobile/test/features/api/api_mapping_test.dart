import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/api_exceptions.dart';
import 'package:mobile/features/auth/domain/models/auth_user.dart';
import 'package:mobile/features/projects/domain/models/project_item.dart';
import 'package:mobile/features/tasks/domain/models/checklist_item.dart';
import 'package:mobile/features/tasks/domain/models/task_item.dart';

void main() {
  group('TaskItem.fromWorkOrder', () {
    test('maps qc work order view with nested site and project', () {
      final task = TaskItem.fromWorkOrder({
        'id': '0192f000-0000-7000-8000-000000000001',
        'projectId': 'p-1',
        'siteId': 's-1',
        'templateId': 't-1',
        'templateName': 'Tower QC',
        'workOrderType': 'QUALITY_SELF_CHECK',
        'title': '[Quality Self-check]KOS121',
        'status': 'ONGOING',
        'assigneeId': 'u-1',
        'plannedCompletionAt': '2099-01-01T00:00:00.000Z',
        'site': {'id': 's-1', 'siteCode': 'KOS121', 'name': 'Central Hub', 'city': 'Kathmandu'},
        'project': {'id': 'p-1', 'code': 'PRJ-1', 'name': 'Metro'},
      });

      expect(task.title, '[Quality Self-check]KOS121');
      expect(task.siteCode, 'KOS121');
      expect(task.siteName, 'Central Hub');
      expect(task.projectCode, 'PRJ-1');
      expect(task.category, 'Quality Self-check');
      expect(task.priority, 'Medium');
      expect(task.isSubmittable, isTrue);
    });

    test('marks overdue open work as High priority', () {
      final task = TaskItem.fromWorkOrder({
        'id': 'w-2',
        'status': 'NOT_STARTED',
        'plannedCompletionAt': '2000-01-01T00:00:00.000Z',
      });
      expect(task.isOverdue, isTrue);
      expect(task.priority, 'High');
    });

    test('work under review cannot be submitted again', () {
      final task = TaskItem.fromWorkOrder({'id': 'w-3', 'status': 'REVIEWING'});
      expect(task.isSubmittable, isFalse);
    });
  });

  group('TaskChecklist.fromJson', () {
    test('flattens sections and items in their template order', () {
      final checklist = TaskChecklist.fromJson({
        'task': {'id': 'w-1', 'projectId': 'p-1', 'siteId': 's-1'},
        'template': {'id': 't-1', 'name': 'Tower QC'},
        'version': {
          'id': 'v-1',
          'version': 3,
          'sections': [
            {
              'number': '2',
              'title': 'Power',
              'order': 1,
              'items': [
                {'id': 'i-3', 'number': '2.1', 'requirementText': 'Earthing', 'order': 0, 'minPhotos': 0, 'maxPhotos': 0},
              ],
            },
            {
              'number': '1',
              'title': 'Civil',
              'order': 0,
              'items': [
                {'id': 'i-2', 'number': '1.2', 'requirementText': 'Fence', 'order': 1, 'minPhotos': 2, 'maxPhotos': 4, 'allowsNa': true},
                {'id': 'i-1', 'number': '1.1', 'requirementText': 'Foundation', 'order': 0, 'minPhotos': 1, 'maxPhotos': 3},
              ],
            },
          ],
        },
      });

      expect(checklist.versionId, 'v-1');
      expect(checklist.versionNumber, 3);
      expect(checklist.items.map((i) => i.id), ['i-1', 'i-2', 'i-3']);

      final fence = checklist.items[1];
      expect(fence.title, 'Fence');
      expect(fence.minPhotos, 2);
      expect(fence.maxPhotos, 4);
      expect(fence.allowsNa, isTrue);
      expect(fence.evidenceRequired, isTrue);
      expect(fence.sectionTitle, '1 Civil');

      final earthing = checklist.items[2];
      expect(earthing.evidenceRequired, isFalse);
      expect(earthing.acceptsPhotos, isFalse);
      expect(earthing.meetsEvidenceRequirements, isTrue);
    });
  });

  group('ProjectItem.fromJson', () {
    test('parses decimal coordinates sent as strings and inherits the project radius', () {
      final project = ProjectItem.fromJson({
        'id': 'p-1',
        'code': 'PRJ-1',
        'name': 'Metro',
        'status': 'ACTIVE',
        'defaultGeofenceRadiusM': 250,
        'sites': [
          {'id': 's-1', 'siteCode': 'KOS121', 'name': 'Hub', 'latitude': '27.7172000', 'longitude': '85.3240000', 'geofenceRadiusM': null},
          {'id': 's-2', 'siteCode': 'KOS122', 'name': 'Tower', 'latitude': null, 'longitude': null, 'geofenceRadiusM': 80},
        ],
      });

      expect(project.sites.first.latitude, closeTo(27.7172, 1e-9));
      expect(project.sites.first.longitude, closeTo(85.324, 1e-9));
      expect(project.sites.first.geofenceRadiusM, 250);
      expect(project.sites.last.latitude, isNull);
      expect(project.sites.last.geofenceRadiusM, 80);
    });

    test('resolves each site\'s geofence the way the server does', () {
      final project = ProjectItem.fromJson({
        'id': 'p-1',
        'code': 'PRJ-1',
        'name': 'Metro',
        'defaultGeofenceRadiusM': 250,
        'sites': [
          {'id': 'a', 'siteCode': 'A', 'name': 'A', 'geofenceMode': 'INHERIT', 'geofenceRadiusM': null},
          {'id': 'b', 'siteCode': 'B', 'name': 'B', 'geofenceMode': 'CUSTOM', 'geofenceRadiusM': 80},
          {'id': 'c', 'siteCode': 'C', 'name': 'C', 'geofenceMode': 'OFF', 'geofenceRadiusM': 80},
        ],
      });
      expect(project.sites.map((s) => s.geofenceRadiusM), [250, 80, null]);
    });

    test('a project with no default radius runs no check on inheriting sites', () {
      final project = ProjectItem.fromJson({
        'id': 'p-1',
        'code': 'PRJ-1',
        'name': 'Metro',
        'defaultGeofenceRadiusM': null,
        'sites': [
          {'id': 'a', 'siteCode': 'A', 'name': 'A', 'geofenceMode': 'INHERIT'},
        ],
      });
      expect(project.sites.single.geofenceRadiusM, isNull);
    });
  });

  group('AuthUser.fromJson', () {
    test('reads role codes from /users/me role objects', () {
      final user = AuthUser.fromJson({
        'id': 'u-1',
        'email': 'engineer@ipms.local',
        'fullName': 'Field Engineer',
        'roles': [
          {'code': 'FIELD_ENGINEER', 'name': 'Field Engineer'},
        ],
      });
      expect(user.role, 'FIELD_ENGINEER');
      expect(user.displayName, 'Field Engineer');
    });

    test('reads role codes and permissions from /auth/me', () {
      final user = AuthUser.fromJson({
        'id': 'u-1',
        'roles': ['FIELD_ENGINEER'],
        'permissions': ['qc_evidence.upload', 'task.view'],
      });
      expect(user.role, 'FIELD_ENGINEER');
      expect(user.can('qc_evidence.upload'), isTrue);
      expect(user.can('qc_review.approve'), isFalse);
    });
  });

  group('ApiException.fromDio', () {
    DioException withResponse(int status, dynamic data) {
      final options = RequestOptions(path: '/api/v1/x');
      return DioException(
        requestOptions: options,
        type: DioExceptionType.badResponse,
        response: Response(requestOptions: options, statusCode: status, data: data),
      );
    }

    test('reads the platform error envelope', () {
      final e = ApiException.fromDio(withResponse(409, {
        'error': {'code': 'CONFLICT', 'message': 'This task already has a submission awaiting review', 'correlationId': 'c'},
      }));
      expect(e.statusCode, 409);
      expect(e.errorCode, 'CONFLICT');
      expect(e.message, 'This task already has a submission awaiting review');
    });

    test('reports no response as a network problem', () {
      final e = ApiException.fromDio(DioException(
        requestOptions: RequestOptions(path: '/x'),
        type: DioExceptionType.connectionError,
      ));
      expect(e, isA<NetworkException>());
    });
  });
}
