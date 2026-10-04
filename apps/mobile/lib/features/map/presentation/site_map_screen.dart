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
    this.geofenceRadiusMeters,
  });

  final double? initialLatitude;
  final double? initialLongitude;
  final String? siteCode;
  final String? siteName;
  /// Null when the site runs no geofence check.
  final double? geofenceRadiusMeters;

  @override
  ConsumerState<SiteMapScreen> createState() => _SiteMapScreenState();
}

class _SiteMapScreenState extends ConsumerState<SiteMapScreen> {
  late final MapController _mapController;

  /// Null when the site has no coordinates recorded yet.
  late final LatLng? _siteLocation;

  @override
  void initState() {
    super.initState();
    _mapController = MapController();
    _siteLocation =
        widget.initialLatitude != null && widget.initialLongitude != null
        ? LatLng(widget.initialLatitude!, widget.initialLongitude!)
        : null;
  }

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  void _recenterToSite() {
    final site = _siteLocation;
    if (site != null) _mapController.move(site, 16.0);
  }

  @override
  Widget build(BuildContext context) {
    final userPositionAsync = ref.watch(userLocationProvider);
    final userPosition = userPositionAsync.value;
    final site = _siteLocation;

    double? distanceMeters;
    if (userPosition != null && site != null) {
      distanceMeters = calculateDistanceMeters(
        siteLocation: site,
        userPosition: userPosition,
      );
    }
    final String distanceText;
    if (site == null) {
      distanceText = 'No coordinates recorded for this site';
    } else if (distanceMeters != null) {
      distanceText = distanceMeters < 1000
          ? '${distanceMeters.toStringAsFixed(0)} m away'
          : '${(distanceMeters / 1000).toStringAsFixed(2)} km away';
    } else if (userPositionAsync.hasError) {
      distanceText = userPositionAsync.error.toString();
    } else {
      distanceText = 'Acquiring GPS...';
    }

    final radius = widget.geofenceRadiusMeters;
    final isWithinGeofence =
        distanceMeters != null && radius != null && distanceMeters <= radius;

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
              site != null
                  ? '${site.latitude.toStringAsFixed(4)}, ${site.longitude.toStringAsFixed(4)}'
                  : 'Location not set',
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
          if (site != null)
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
              // Without site coordinates, start on the phone (or a country view).
              initialCenter:
                  site ??
                  (userPosition != null
                      ? LatLng(userPosition.latitude, userPosition.longitude)
                      : const LatLng(28.3949, 84.1240)),
              initialZoom: site != null || userPosition != null ? 15.0 : 6.0,
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
              if (site != null && radius != null)
                CircleLayer(
                  circles: [
                    CircleMarker(
                      point: site,
                      radius: radius,
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
                  if (site != null)
                    Marker(
                      point: site,
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
                                widget.siteCode ?? 'Site',
                                style: AppTypography.titleLarge,
                              ),
                              Text(
                                widget.siteName ?? '',
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
                            color: distanceMeters == null || radius == null
                                ? AppColors.searchFieldBackground
                                : isWithinGeofence
                                ? AppColors.statusCompletedBg
                                : AppColors.statusBlockedBg,
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Text(
                            distanceMeters == null
                                ? 'Unknown'
                                : radius == null
                                ? 'No geofence'
                                : isWithinGeofence
                                ? 'On Site'
                                : 'Off Site',
                            style: AppTypography.badge.copyWith(
                              color: distanceMeters == null || radius == null
                                  ? AppColors.textSecondary
                                  : isWithinGeofence
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
                        Expanded(
                          child: Row(
                            children: [
                              const Icon(
                                Icons.navigation_rounded,
                                size: 16,
                                color: AppColors.textSecondary,
                              ),
                              const SizedBox(width: 6),
                              Flexible(
                                child: Text(
                                  distanceText,
                                  style: AppTypography.bodyMedium.copyWith(
                                    fontWeight: FontWeight.w600,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        if (site != null && radius != null)
                          Text(
                            'Radius: ${radius.toInt()}m',
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
