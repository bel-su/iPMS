import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../providers/map_providers.dart';

class SiteMapScreen extends ConsumerStatefulWidget {
  const SiteMapScreen({
    super.key,
    this.initialLatitude,
    this.initialLongitude,
    this.siteCode,
    this.siteName,
    this.geofenceRadiusMeters = 100.0,
  });

  final double? initialLatitude;
  final double? initialLongitude;
  final String? siteCode;
  final String? siteName;
  final double geofenceRadiusMeters;

  @override
  ConsumerState<SiteMapScreen> createState() => _SiteMapScreenState();
}

class _SiteMapScreenState extends ConsumerState<SiteMapScreen> {
  late final MapController _mapController;
  late final LatLng _siteLocation;

  @override
  void initState() {
    super.initState();
    _mapController = MapController();
    // Default to Kathmandu / Nepal hub if no specific site passed
    _siteLocation = LatLng(
      widget.initialLatitude ?? 27.7172,
      widget.initialLongitude ?? 85.3240,
    );
  }

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  void _recenterToSite() {
    _mapController.move(_siteLocation, 16.0);
  }

  @override
  Widget build(BuildContext context) {
    final userPositionAsync = ref.watch(userLocationProvider);
    final userPosition = userPositionAsync.value;

    double? distanceMeters;
    if (userPosition != null) {
      distanceMeters = calculateDistanceMeters(
        siteLocation: _siteLocation,
        userPosition: userPosition,
      );
    }

    final isWithinGeofence =
        distanceMeters != null && distanceMeters <= widget.geofenceRadiusMeters;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.siteCode != null
                  ? 'Site Location • ${widget.siteCode}'
                  : 'OpenStreetMap Explorer',
              style: AppTypography.headingSmall,
            ),
            Text(
              '${_siteLocation.latitude.toStringAsFixed(4)}, ${_siteLocation.longitude.toStringAsFixed(4)}',
              style: AppTypography.caption,
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.my_location_rounded),
            tooltip: 'My Location',
            onPressed: () {
              if (userPosition != null) {
                _mapController.move(
                  LatLng(userPosition.latitude, userPosition.longitude),
                  16.0,
                );
              } else {
                ref.invalidate(userLocationProvider);
              }
            },
          ),
          IconButton(
            icon: const Icon(Icons.location_city_rounded),
            tooltip: 'Center Site',
            onPressed: _recenterToSite,
          ),
        ],
      ),
      body: Stack(
        children: [
          // OpenStreetMap Vector Engine
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: _siteLocation,
              initialZoom: 15.0,
              minZoom: 4.0,
              maxZoom: 18.0,
            ),
            children: [
              // OpenStreetMap Tile Layer
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.ipms.mobile',
              ),

              // Geofence Circle Overlay (around site coordinates)
              CircleLayer(
                circles: [
                  CircleMarker(
                    point: _siteLocation,
                    radius: widget.geofenceRadiusMeters,
                    useRadiusInMeter: true,
                    color: AppColors.primaryLavender.withValues(alpha: 0.35),
                    borderColor: AppColors.primaryLavenderDark,
                    borderStrokeWidth: 2,
                  ),
                ],
              ),

              // Marker Pins (Site Marker + User Location Marker)
              MarkerLayer(
                markers: [
                  // Site Marker Pin
                  Marker(
                    point: _siteLocation,
                    width: 80,
                    height: 80,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.darkSlate,
                            borderRadius: BorderRadius.circular(12),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.25),
                                blurRadius: 6,
                              ),
                            ],
                          ),
                          child: Text(
                            widget.siteCode ?? 'SITE',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        const Icon(
                          Icons.location_on_rounded,
                          color: AppColors.priorityHighText,
                          size: 38,
                        ),
                      ],
                    ),
                  ),

                  // User Current Location Pin (if GPS granted)
                  if (userPosition != null)
                    Marker(
                      point: LatLng(
                        userPosition.latitude,
                        userPosition.longitude,
                      ),
                      width: 40,
                      height: 40,
                      child: Container(
                        decoration: BoxDecoration(
                          color: Colors.blue.shade600,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 3),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.blue.withValues(alpha: 0.4),
                              blurRadius: 8,
                              spreadRadius: 2,
                            ),
                          ],
                        ),
                        child: const Icon(
                          Icons.person_pin_circle_rounded,
                          color: Colors.white,
                          size: 18,
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),

          // Floating Distance & Site Info Card
          Positioned(
            left: 20,
            right: 20,
            bottom: 90, // Above floating bottom nav bar
            child: Card(
              elevation: 4,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(24),
              ),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: AppColors.primaryLavenderLight,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Icon(
                            Icons.cell_tower_rounded,
                            color: AppColors.darkSlate,
                            size: 22,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                widget.siteCode ?? 'KOS121 Hub',
                                style: AppTypography.titleLarge,
                              ),
                              Text(
                                widget.siteName ?? 'Kathmandu Central Telecommunications',
                                style: AppTypography.bodySmall,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        // Geofence Status Pill
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 5,
                          ),
                          decoration: BoxDecoration(
                            color: isWithinGeofence
                                ? AppColors.statusCompletedBg
                                : AppColors.statusBlockedBg,
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Text(
                            isWithinGeofence ? 'On Site' : 'Off Site',
                            style: AppTypography.badge.copyWith(
                              color: isWithinGeofence
                                  ? AppColors.statusCompletedText
                                  : AppColors.statusBlockedText,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    const Divider(color: AppColors.subtleDivider),
                    const SizedBox(height: 8),

                    // Distance & Coordinates Row
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            const Icon(
                              Icons.navigation_rounded,
                              size: 16,
                              color: AppColors.textSecondary,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              distanceMeters != null
                                  ? distanceMeters < 1000
                                      ? '${distanceMeters.toStringAsFixed(0)} m away'
                                      : '${(distanceMeters / 1000).toStringAsFixed(2)} km away'
                                  : 'Acquiring GPS...',
                              style: AppTypography.bodyMedium.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                        Text(
                          'Radius: ${widget.geofenceRadiusMeters.toInt()}m',
                          style: AppTypography.caption,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
