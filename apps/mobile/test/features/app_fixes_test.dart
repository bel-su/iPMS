import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/network/api_exceptions.dart';
import 'package:mobile/core/security/token_storage.dart';
import 'package:mobile/core/storage/evidence_store.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/domain/models/auth_user.dart';
import 'package:mobile/features/auth/providers/auth_provider.dart';
import 'package:mobile/features/map/presentation/site_map_screen.dart';
import 'package:mobile/features/tasks/domain/models/checklist_item.dart';
import 'package:mobile/features/tasks/domain/models/task_evidence.dart';
import 'package:mobile/features/tasks/domain/models/task_item.dart';
import 'package:mobile/features/tasks/providers/evidence_provider.dart';

/// Answers each path with a queue of (status, body) replies.
class ScriptedServer implements HttpClientAdapter {
  final Map<String, List<(int, Object)>> replies = {};
  final List<String> calls = [];

  void on(String path, int status, Object body) => replies.putIfAbsent(path, () => []).add((status, body));

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    calls.add('${options.method} ${options.path} ${options.headers['Authorization'] ?? ''}'.trim());
    final queue = replies[options.path];
    final (status, body) = (queue == null || queue.isEmpty) ? (404, <String, dynamic>{}) : queue.removeAt(0);
    return ResponseBody.fromString(jsonEncode(body), status,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
  }

  @override
  void close({bool force = false}) {}
}

TaskEvidence evidence(String id, String path, {String status = EvidenceUploadStatus.local, bool submitted = false, DateTime? at}) =>
    TaskEvidence(
      id: id,
      taskId: 'w-1',
      filePath: path,
      siteCode: 'S1',
      siteName: 'Site',
      projectCode: 'P1',
      latitude: 1,
      longitude: 2,
      accuracy: 3,
      capturedBy: 'engineer',
      capturedAt: at ?? DateTime.now(),
      checklistItemId: 'i-1',
      uploadStatus: status,
      isSubmitted: submitted,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('EvidenceStore', () {
    late Directory dir;
    late EvidenceStore store;

    setUp(() async {
      dir = await Directory.systemTemp.createTemp('evidence_store');
      store = EvidenceStore(directory: () async => dir);
    });
    tearDown(() => dir.delete(recursive: true));

    test('round-trips evidence, re-roots moved paths and drops missing files', () async {
      File('${dir.path}/a.jpg').writeAsBytesSync([1]);
      await store.save('u-1', {
        'w-1': [
          evidence('a', '/old/container/a.jpg', status: EvidenceUploadStatus.ready),
          evidence('gone', '/old/container/gone.jpg'),
        ],
      });

      final loaded = await store.load('u-1');

      expect(loaded['w-1']!.single.id, 'a');
      expect(loaded['w-1']!.single.filePath, '${dir.path}/a.jpg');
      expect(loaded['w-1']!.single.uploadStatus, EvidenceUploadStatus.ready);
      expect(await store.load('u-2'), isEmpty);
    });

    test('an upload cut off by the app closing is marked for retry', () async {
      File('${dir.path}/a.jpg').writeAsBytesSync([1]);
      await store.save('u-1', {'w-1': [evidence('a', '${dir.path}/a.jpg', status: EvidenceUploadStatus.uploading)]});
      final loaded = await store.load('u-1');
      expect(loaded['w-1']!.single.uploadStatus, EvidenceUploadStatus.failed);
    });

    test('the notifier restores saved photos for the signed-in account and drops old submitted ones', () async {
      File('${dir.path}/keep.jpg').writeAsBytesSync([1]);
      File('${dir.path}/old.jpg').writeAsBytesSync([1]);
      await store.save('u-1', {
        'w-1': [
          evidence('keep', '${dir.path}/keep.jpg'),
          evidence('old', '${dir.path}/old.jpg', submitted: true, at: DateTime.now().subtract(const Duration(days: 40))),
        ],
      });
      final container = ProviderContainer(overrides: [
        evidenceStoreProvider.overrideWithValue(store),
        sessionOwnerProvider.overrideWith(() => _FixedOwner('u-1')),
      ]);
      addTearDown(container.dispose);
      final notifier = container.read(taskEvidenceProvider.notifier);
      await notifier.restored;

      final restored = container.read(taskEvidenceProvider)['w-1']!;
      expect(restored.map((e) => e.id), ['keep']);
      expect(File('${dir.path}/old.jpg').existsSync(), isFalse);

      // Changes are written back for next time.
      notifier.updateEvidence('w-1', 'keep', (e) => e.copyWith(uploadStatus: EvidenceUploadStatus.ready));
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect((await store.load('u-1'))['w-1']!.single.uploadStatus, EvidenceUploadStatus.ready);
    });
  });

  group('AuthInterceptor', () {
    late ScriptedServer server;
    late TokenStorage storage;
    late Dio dio;
    var expired = 0;

    setUp(() async {
      server = ScriptedServer();
      storage = TokenStorage();
      await storage.saveTokens(accessToken: 'old', refreshToken: 'r-1', userId: 'u-1');
      dio = Dio(BaseOptions(baseUrl: 'http://gateway.test'))..httpClientAdapter = server;
      expired = 0;
      ApiClient(tokenStorage: storage, dio: dio, onSessionExpired: () => expired++);
    });

    test('refreshes once and reports the retried request\'s own failure', () async {
      server.on('/api/v1/work-orders', 401, {});
      server.on('/api/v1/auth/refresh', 200, {'accessToken': 'new', 'refreshToken': 'r-2'});
      server.on('/api/v1/work-orders', 403, {'error': {'code': 'FORBIDDEN', 'message': 'Not in scope', 'correlationId': 'c'}});

      await expectLater(
        dio.get<dynamic>('/api/v1/work-orders'),
        throwsA(isA<DioException>().having((e) => e.response?.statusCode, 'status', 403)),
      );
      expect(server.calls.last, 'GET /api/v1/work-orders Bearer new');
      expect(await storage.getAccessToken(), 'new');
      expect(expired, 0);
    });

    test('a refused refresh ends the session and tells the app', () async {
      server.on('/api/v1/work-orders', 401, {});
      server.on('/api/v1/auth/refresh', 401, {});

      await expectLater(dio.get<dynamic>('/api/v1/work-orders'), throwsA(isA<DioException>()));
      expect(expired, 1);
      expect(await storage.getAccessToken(), isNull);
    });

    test('an unreachable refresh keeps the session', () async {
      server.on('/api/v1/work-orders', 401, {});
      server.on('/api/v1/auth/refresh', 503, {});

      await expectLater(dio.get<dynamic>('/api/v1/work-orders'), throwsA(isA<DioException>()));
      expect(expired, 0);
      expect(await storage.getRefreshToken(), 'r-1');
    });
  });

  test('an account that must change its password is told so and not signed in', () async {
    final server = ScriptedServer()
      ..on('/api/v1/auth/login', 200, {'accessToken': 'a', 'refreshToken': 'r', 'expiresIn': 900, 'mustChangePassword': true});
    final storage = TokenStorage();
    final dio = Dio(BaseOptions(baseUrl: 'http://gateway.test'))..httpClientAdapter = server;
    final repo = AuthRepository(apiClient: ApiClient(tokenStorage: storage, dio: dio), tokenStorage: storage);

    await expectLater(
      repo.login(email: 'new@ipms.local', password: 'temporary-pass'),
      throwsA(isA<PasswordChangeRequiredException>()
          .having((e) => e.message, 'message', AuthRepository.mustChangePasswordMessage)
          .having((e) => e.accessToken, 'accessToken', 'a')),
    );
    expect(await storage.getAccessToken(), isNull);
  });

  test('ReviewFeedback reads the latest decision and rejected items', () {
    final review = ReviewFeedback.fromSubmission({
      'decisions': [
        {'decision': 'REJECT_REWORK', 'comment': 'old', 'decidedAt': '2026-09-01T00:00:00Z'},
        {'decision': 'REJECT_REWORK', 'comment': 'Retake the earthing photos', 'decidedAt': '2026-09-02T00:00:00Z'},
      ],
      'responses': [
        {'itemId': 'i-1', 'reviewResult': 'REJECTED', 'reviewDescription': 'Blurry'},
        {'itemId': 'i-2', 'reviewResult': 'APPROVED'},
      ],
    });
    expect(review.comment, 'Retake the earthing photos');
    expect(review.rejectedCount, 1);
    expect(review.items['i-1']!.note, 'Blurry');
    expect(review.items['i-2']!.isRejected, isFalse);
  });

  test('role codes read as words', () {
    expect(const AuthUser(id: '1', email: 'e', role: 'FIELD_ENGINEER').roleLabel, 'Field Engineer');
    expect(const AuthUser(id: '1', email: 'e', role: 'QC_MANAGER').roleLabel, 'QC Manager');
    expect(const AuthUser(id: '1', email: 'e', role: 'Field Engineer').roleLabel, 'Field Engineer');
  });

  test('work orders without checklist counts show lifecycle progress', () {
    expect(TaskItem.fromWorkOrder({'id': 'w', 'status': 'NOT_STARTED'}).progressPercentage, 0);
    expect(TaskItem.fromWorkOrder({'id': 'w', 'status': 'REVIEWING'}).progressPercentage, greaterThan(0.5));
    expect(TaskItem.fromWorkOrder({'id': 'w', 'status': 'COMPLETED'}).progressPercentage, 1);
    expect(TaskItem.fromWorkOrder({'id': 'w', 'status': 'ONGOING'}).hasChecklistCounts, isFalse);
  });

  testWidgets('a site without coordinates is not placed on the map', (tester) async {
    await tester.pumpWidget(const ProviderScope(
      child: MaterialApp(home: SiteMapScreen(siteCode: 'NEW01', siteName: 'Unsurveyed')),
    ));
    await tester.pump();

    expect(find.text('Location not set'), findsOneWidget);
    expect(find.text('No coordinates recorded for this site'), findsOneWidget);
    expect(find.byIcon(Icons.location_city_rounded), findsNothing);
  });
}

class _FixedOwner extends SessionOwnerNotifier {
  _FixedOwner(this.id);
  final String id;

  @override
  String? build() => id;
}
