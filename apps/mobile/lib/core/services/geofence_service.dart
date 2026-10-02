import 'package:geolocator/geolocator.dart';

enum GeofenceState {
  /// The site has no coordinates or runs no geofence check.
  notApplicable,
  inside,
  outside,

  /// The site is checked but the phone has no position to check with.
  noFix,
}

/// How a phone's position compares with its site's geofence.
class GeofenceCheck {
  const GeofenceCheck(this.state, {this.distanceM, this.radiusM});

  final GeofenceState state;
  final double? distanceM;
  final int? radiusM;

  /// Work may go ahead: inside the fence, or there is no fence to be in.
  bool get allowed =>
      state == GeofenceState.inside || state == GeofenceState.notApplicable;

  /// Why work is blocked, in words for the engineer; null when [allowed].
  String? get blockedReason => switch (state) {
    GeofenceState.outside =>
      'You are ${_distance(distanceM!)} from the site. Photos and submission are only allowed within ${radiusM}m of it.',
    GeofenceState.noFix =>
      'Waiting for GPS. This site needs your location to confirm you are on site.',
    _ => null,
  };

  static String _distance(double metres) => metres < 1000
      ? '${metres.round()}m'
      : '${(metres / 1000).toStringAsFixed(1)}km';
}

/// Checks the phone's position against a site's geofence, and reads that
/// position. The server records the same check on every submission; doing it
/// here too stops the work being done from the wrong place in the first place.
class GeofenceService {
  GeofenceService._();

  /// A fix reports how far off it may be. Giving the engineer that much
  /// benefit of the doubt keeps a standing-at-the-gate worker from being
  /// refused over GPS noise, but the allowance is capped so a very poor fix
  /// cannot excuse being far away.
  static const double maxAccuracyAllowanceM = 50;

  static GeofenceCheck evaluate({
    required double? siteLatitude,
    required double? siteLongitude,
    required int? radiusM,
    required Position? position,
  }) {
    if (siteLatitude == null || siteLongitude == null || radiusM == null) {
      return const GeofenceCheck(GeofenceState.notApplicable);
    }
    if (position == null) {
      return GeofenceCheck(GeofenceState.noFix, radiusM: radiusM);
    }
    final distance = Geolocator.distanceBetween(
      position.latitude,
      position.longitude,
      siteLatitude,
      siteLongitude,
    );
    final allowance = position.accuracy
        .clamp(0, maxAccuracyAllowanceM)
        .toDouble();
    return GeofenceCheck(
      distance - allowance <= radiusM
          ? GeofenceState.inside
          : GeofenceState.outside,
      distanceM: distance,
      radiusM: radiusM,
    );
  }

  /// The phone's current position, or null when location is off, refused, or
  /// has no fix. Asks for permission if it has not been decided yet.
  static Future<Position?> currentPosition({
    Duration timeout = const Duration(seconds: 8),
  }) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return null;
      }
      try {
        return await Geolocator.getCurrentPosition(
          locationSettings: LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: timeout,
          ),
        );
      } catch (_) {
        return await Geolocator.getLastKnownPosition();
      }
    } catch (_) {
      return null;
    }
  }
}
