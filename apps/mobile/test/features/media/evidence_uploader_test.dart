import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/network/api_exceptions.dart';
import 'package:mobile/core/security/token_storage.dart';
import 'package:mobile/features/media/data/media_repository.dart';
import 'package:mobile/features/media/providers/evidence_upload_provider.dart';
import 'package:mobile/features/tasks/domain/models/task_evidence.dart';
import 'package:mobile/features/tasks/providers/evidence_provider.dart';

/// Stands in for the media service and the bucket, recording what the phone sent.
class FakeMediaRepository extends MediaRepository {
  FakeMediaRepository() : super(apiClient: ApiClient(tokenStorage: TokenStorage()));

  final List<Map<String, dynamic>> registrations = [];
  final Map<String, Uint8List> bucket = {};
  final List<String> completed = [];
  String statusAfterVerify = 'READY';
  int preconditionFailures = 0;

  @override
  Future<UploadRegistration> register({
    required String id,
    required String workOrderId,
    required String checklistItemId,
    required int sizeBytes,
    required String contentHash,
    required DateTime capturedAt,
    required String deviceId,
    double? latitude,
    double? longitude,
  }) async {
    registrations.add({
      'id': id,
      'workOrderId': workOrderId,
      'checklistItemId': checklistItemId,
      'sizeBytes': sizeBytes,
      'contentHash': contentHash,
      'deviceId': deviceId,
      'latitude': latitude,
    });
    return UploadRegistration(
      id: id,
      status: 'PENDING',
      mode: 'single',
      signedUrl: 'https://bucket.test/$id',
      headers: const {'content-type': 'image/jpeg'},
    );
  }

  @override
  Future<void> putBytes(UploadRegistration registration, Uint8List bytes) async {
    bucket[registration.id] = bytes;
  }

  @override
  Future<String> complete(String id) async {
    if (preconditionFailures > 0) {
      preconditionFailures--;
      throw const ApiException(message: 'Bytes not there yet', statusCode: 412);
    }
    completed.add(id);
    return 'VERIFYING';
  }

  @override
  Future<List<UploadStatusItem>> status(List<String> ids) async => [
        for (final id in ids)
          UploadStatusItem(
            id: id,
            status: statusAfterVerify,
            rejectReason: statusAfterVerify == 'REJECTED' ? 'HASH_MISMATCH' : null,
          ),
      ];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory dir;
  late File photo;
  late FakeMediaRepository media;
  late ProviderContainer container;

  const taskId = '0192f000-0000-7000-8000-00000000aaaa';
  const itemId = '0192f000-0000-7000-8000-00000000bbbb';

  TaskEvidence evidence({String? checklistItemId = itemId, double accuracy = 4}) => TaskEvidence(
        id: '0192f000-0000-7000-8000-00000000cccc',
        taskId: taskId,
        filePath: photo.path,
        siteCode: 'KOS121',
        siteName: 'Hub',
        projectCode: 'PRJ-1',
        latitude: 27.7,
        longitude: 85.3,
        accuracy: accuracy,
        capturedBy: 'engineer',
        capturedAt: DateTime.utc(2026, 9, 29, 8),
        checklistItemId: checklistItemId,
      );

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    dir = await Directory.systemTemp.createTemp('evidence_test');
    photo = File('${dir.path}/photo.jpg')..writeAsBytesSync(List<int>.generate(2048, (i) => i % 256));
    media = FakeMediaRepository();
    container = ProviderContainer(overrides: [
      mediaRepositoryProvider.overrideWithValue(media),
    ]);
  });

  tearDown(() async {
    container.dispose();
    await dir.delete(recursive: true);
  });

  TaskEvidence current() => container.read(taskEvidenceProvider)[taskId]!.single;

  test('registers with the capture id and file hash, sends the bytes, and waits for READY', () async {
    container.read(taskEvidenceProvider.notifier).addEvidence(evidence());

    final notReady = await container
        .read(evidenceUploaderProvider)
        .uploadAndWait(taskId, {current().id});

    expect(notReady, isEmpty);
    expect(current().uploadStatus, EvidenceUploadStatus.ready);

    final registration = media.registrations.single;
    expect(registration['id'], current().mediaId);
    expect(registration['workOrderId'], taskId);
    expect(registration['checklistItemId'], itemId);
    expect(registration['sizeBytes'], 2048);
    expect(registration['contentHash'], sha256.convert(photo.readAsBytesSync()).toString());
    expect(registration['deviceId'], isNotEmpty);
    expect(media.bucket[current().mediaId], photo.readAsBytesSync());
    expect(media.completed, [current().mediaId]);
  });

  test('does not upload a photo still in the session tray', () async {
    container.read(taskEvidenceProvider.notifier).addEvidence(evidence(checklistItemId: null));
    await container.read(evidenceUploaderProvider).uploadPending(taskId);
    expect(media.registrations, isEmpty);
    expect(current().uploadStatus, EvidenceUploadStatus.local);
  });

  test('sends no coordinates when the phone had no GPS fix', () async {
    container.read(taskEvidenceProvider.notifier).addEvidence(evidence(accuracy: -1));
    await container.read(evidenceUploaderProvider).upload(taskId, current().id);
    expect(media.registrations.single['latitude'], isNull);
  });

  test('re-sends once when complete reports the bytes had not arrived (412)', () async {
    media.preconditionFailures = 1;
    container.read(taskEvidenceProvider.notifier).addEvidence(evidence());
    await container.read(evidenceUploaderProvider).upload(taskId, current().id);
    expect(media.registrations, hasLength(2));
    expect(current().uploadStatus, EvidenceUploadStatus.verifying);
  });

  test('a rejected photo is registered again under a new media id', () async {
    media.statusAfterVerify = 'REJECTED';
    container.read(taskEvidenceProvider.notifier).addEvidence(evidence());
    final uploader = container.read(evidenceUploaderProvider);

    final notReady = await uploader.uploadAndWait(taskId, {current().id});
    expect(notReady, hasLength(1));
    expect(current().uploadStatus, EvidenceUploadStatus.rejected);
    expect(current().uploadError, contains('HASH_MISMATCH'));
    final firstId = current().mediaId;

    media.statusAfterVerify = 'READY';
    await uploader.upload(taskId, current().id);
    expect(current().mediaId, isNot(firstId));
    expect(media.registrations.last['id'], current().mediaId);
  });
}
