import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

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
