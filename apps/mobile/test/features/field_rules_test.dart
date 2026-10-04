import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/security/token_storage.dart';
import 'package:mobile/core/services/geofence_service.dart';
import 'package:mobile/features/tasks/data/task_repository.dart';
import 'package:mobile/features/tasks/domain/models/task_item.dart';

class _Server implements HttpClientAdapter {
  _Server(this.body);
  final Map<String, dynamic> body;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final path = options.path;
    final json = path.endsWith('/work-orders') ? body : <String, dynamic>{};
    return ResponseBody.fromString(jsonEncode(json), path.endsWith('/work-orders') ? 200 : 404,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
  }

  @override
  void close({bool force = false}) {}
}

Position at(double lat, double lon, {double accuracy = 5}) => Position(
      latitude: lat,
      longitude: lon,
      timestamp: DateTime.now(),
      accuracy: accuracy,
      altitude: 0,
      altitudeAccuracy: 0,
      heading: 0,
      headingAccuracy: 0,
      speed: 0,
      speedAccuracy: 0,
    );

Map<String, dynamic> order(String id, String status) => {
      'id': id,
      'status': status,
      'title': '[Quality Self-check]KOS001',
      'siteId': 's',
      'site': {'id': 's', 'siteCode': 'KOS001', 'name': 'Hub'},
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('work order notes', () {
    test('the note is split off the title', () {
      final t = TaskItem.fromWorkOrder({
        'id': 'w',
        'title': '[EHS Spot Check]KOS102X sector 2 only',
        'site': {'siteCode': 'KOS102X'},
      });
      expect(t.title, '[EHS Spot Check]KOS102X');
      expect(t.note, 'sector 2 only');
    });

    test('a title with no note has none', () {
      final t = TaskItem.fromWorkOrder({'id': 'w', 'title': '[Quality Self-check]KOS001', 'site': {'siteCode': 'KOS001'}});
      expect(t.title, '[Quality Self-check]KOS001');
      expect(t.note, isNull);
    });

    test('without a site code the note starts after the first word', () {
      final split = TaskItem.splitTitle('[Quality Self-check]KOS001 bring ladder', null);
      expect(split.title, '[Quality Self-check]KOS001');
      expect(split.note, 'bring ladder');
    });

    test('a title that is not in the bracket form is kept whole', () {
      final split = TaskItem.splitTitle('Inspect the mast', 'KOS001');
      expect(split.title, 'Inspect the mast');
      expect(split.note, isNull);
    });
  });

  group('cancelled work orders', () {
    test('are not returned to the field', () async {
      final api = ApiClient(
        tokenStorage: TokenStorage(),
        dio: Dio(BaseOptions(baseUrl: 'http://x'))
          ..httpClientAdapter = _Server({
            'items': [order('a', 'ONGOING'), order('b', 'CANCELLED'), order('c', 'REVIEWING')],
          }),
      );
      final tasks = await TaskRepository(apiClient: api).getAssignedTasks(assignedToMe: false);
      expect(tasks.map((t) => t.id), ['a', 'c']);
    });
  });

  group('GeofenceService.evaluate', () {
    GeofenceCheck check(Position? p, {int? radius = 100, double? lat = 27.7172}) => GeofenceService.evaluate(
          siteLatitude: lat,
          siteLongitude: lat == null ? null : 85.324,
          radiusM: radius,
          position: p,
        );

    test('inside the radius is allowed', () {
      final c = check(at(27.7172, 85.324));
      expect(c.state, GeofenceState.inside);
      expect(c.allowed, isTrue);
    });

    test('about 500 m away is blocked, with a reason', () {
      final c = check(at(27.7217, 85.324));
      expect(c.state, GeofenceState.outside);
      expect(c.allowed, isFalse);
      expect(c.blockedReason, contains('100m'));
    });

    test('GPS accuracy gives a little benefit of the doubt, but only up to 50 m', () {
      // ~120 m north: 20 m outside a 100 m fence.
      final near = at(27.7172 + 120 / 111195, 85.324);
      expect(check(near.copy(accuracy: 30)).state, GeofenceState.inside);
      // A 500 m "accuracy" cannot excuse being 120 m away from a 50 m fence.
      expect(check(near.copy(accuracy: 500), radius: 50).state, GeofenceState.outside);
    });

    test('no fix is blocked when the site is checked', () {
      final c = check(null);
      expect(c.state, GeofenceState.noFix);
      expect(c.allowed, isFalse);
    });

    test('a site with no radius or no coordinates is never blocked', () {
      expect(check(null, radius: null).allowed, isTrue);
      expect(check(null, lat: null).allowed, isTrue);
      expect(check(at(0, 0), radius: null).state, GeofenceState.notApplicable);
    });
  });
}

extension on Position {
  Position copy({required double accuracy}) => Position(
        latitude: latitude,
        longitude: longitude,
        timestamp: timestamp,
        accuracy: accuracy,
        altitude: altitude,
        altitudeAccuracy: altitudeAccuracy,
        heading: heading,
        headingAccuracy: headingAccuracy,
        speed: speed,
        speedAccuracy: speedAccuracy,
      );
}
