import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:mobile/features/map/presentation/site_map_screen.dart';
import 'package:mobile/features/map/providers/map_providers.dart';

void main() {
  group('OpenStreetMap & Geolocation', () {
    test('calculateDistanceMeters computes accurate distance between coordinates', () {
      final site = const LatLng(27.7172, 85.3240); // Kathmandu Hub
      final userPos = Position(
        latitude: 27.7182,
        longitude: 85.3240,
        timestamp: DateTime.now(),
        accuracy: 5.0,
        altitude: 1400.0,
        altitudeAccuracy: 5.0,
        heading: 0.0,
        headingAccuracy: 0.0,
        speed: 0.0,
        speedAccuracy: 0.0,
      );

      final distance = calculateDistanceMeters(
        siteLocation: site,
        userPosition: userPos,
      );

      // 0.001 degree of latitude is roughly 111 meters
      expect(distance, greaterThan(100));
      expect(distance, lessThan(125));
    });

    testWidgets('SiteMapScreen renders OpenStreetMap header and site code',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: SiteMapScreen(
              initialLatitude: 27.7172,
              initialLongitude: 85.3240,
              siteCode: 'KOS121',
              siteName: 'Kathmandu Central Hub',
            ),
          ),
        ),
      );

      await tester.pump();

      expect(find.text('Site Location • KOS121'), findsOneWidget);
      expect(find.text('KOS121'), findsNWidgets(2));
      expect(find.text('Radius: 100m'), findsOneWidget);
    });
  });
}
