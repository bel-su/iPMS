import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import '../../tasks/domain/models/task_item.dart';
import '../../tasks/providers/task_providers.dart';

/// Why the phone's position could not be read, in words for the user.
class LocationUnavailable implements Exception {
  const LocationUnavailable(this.message);
  final String message;

  @override
  String toString() => message;
}

/// The phone's live GPS position. Fails with [LocationUnavailable] (rather
/// than returning nothing) so screens can say why there is no position
/// instead of waiting for one forever.
final userLocationProvider = FutureProvider<Position>((ref) async {
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw const LocationUnavailable('Location is turned off');
  }

  var permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied) {
    permission = await Geolocator.requestPermission();
  }
  if (permission == LocationPermission.denied) {
    throw const LocationUnavailable('Location permission denied');
  }
  if (permission == LocationPermission.deniedForever) {
    throw const LocationUnavailable('Location blocked in Settings');
  }

  try {
    return await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 15),
      ),
    );
  } catch (_) {
    final last = await Geolocator.getLastKnownPosition();
    if (last != null) return last;
    throw const LocationUnavailable('No GPS fix yet');
  }
});

/// Helper to calculate distance between user and site.
double calculateDistanceMeters({
  required LatLng siteLocation,
  required Position userPosition,
}) {
  return Geolocator.distanceBetween(
    userPosition.latitude,
    userPosition.longitude,
    siteLocation.latitude,
    siteLocation.longitude,
  );
}

/// One site on the "My sites" map, with the caller's work orders on it.
class MapSite {
  const MapSite({
    required this.siteId,
    required this.projectId,
    required this.siteCode,
    required this.siteName,
    required this.tasks,
    this.latitude,
    this.longitude,
    this.geofenceRadiusM,
    this.projectCode,
    this.projectName,
  });

  final String siteId;
  final String projectId;
  final String siteCode;
  final String siteName;
  final double? latitude;
  final double? longitude;
  final int? geofenceRadiusM;
  final String? projectCode;
  final String? projectName;
  final List<TaskItem> tasks;

  bool get hasLocation => latitude != null && longitude != null;
  int get openCount => tasks.where((t) => t.status != 'COMPLETED' && t.status != 'CANCELLED').length;
  LatLng? get point => hasLocation ? LatLng(latitude!, longitude!) : null;
}

/// The sites where the signed-in user has work orders, for the Map tab.
final mySitesProvider = FutureProvider<List<MapSite>>((ref) async {
  final tasks = await ref.watch(taskRepositoryProvider).getAssignedTasks();
  final bySite = <String, List<TaskItem>>{};
  for (final task in tasks) {
    bySite.putIfAbsent(task.siteId, () => []).add(task);
  }
  final sites = bySite.values.map((siteTasks) {
    final first = siteTasks.first;
    return MapSite(
      siteId: first.siteId,
      projectId: first.projectId ?? '',
      siteCode: first.siteCode ?? 'Site',
      siteName: first.siteName ?? '',
      latitude: first.latitude,
      longitude: first.longitude,
      geofenceRadiusM: first.geofenceRadiusM,
      projectCode: first.projectCode,
      projectName: first.projectName,
      tasks: siteTasks,
    );
  }).toList()
    ..sort((a, b) => b.openCount.compareTo(a.openCount));
  return sites;
});
