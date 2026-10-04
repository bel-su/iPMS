import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../projects/domain/models/project_item.dart';
import '../../tasks/presentation/site_tasks_screen.dart';
import '../providers/map_providers.dart';
import 'site_map_screen.dart';

/// The Map tab: every site where the signed-in user has work orders, pinned
/// at its recorded coordinates, with the phone's own position.
class MySitesMapScreen extends ConsumerStatefulWidget {
  const MySitesMapScreen({super.key});

  @override
  ConsumerState<MySitesMapScreen> createState() => _MySitesMapScreenState();
}

class _MySitesMapScreenState extends ConsumerState<MySitesMapScreen> {
  final _mapController = MapController();
  MapSite? _selected;

  /// Shown when there is nothing to fit the camera to.
  static const LatLng _countryCenter = LatLng(28.3949, 84.1240);

  /// Nepal geographical bounding box: restricts viewing and panning strictly to Nepal territory.
  static final LatLngBounds nepalBounds = LatLngBounds(
    const LatLng(26.347, 80.058), // South-West (Kanchanpur / Dhangadhi)
    const LatLng(30.447, 88.201), // North-East (Humla / Taplejung)
  );

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sitesAsync = ref.watch(mySitesProvider);
    final userPosition = ref.watch(userLocationProvider).value;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('My sites', style: AppTypography.headingSmall),
            Text(
              sitesAsync.maybeWhen(
                data: (sites) => '${sites.length} site${sites.length == 1 ? '' : 's'} with your work orders',
                orElse: () => 'Loading your sites…',
              ),
              style: AppTypography.caption,
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.my_location_rounded),
            tooltip: 'My location',
            onPressed: () {
              if (userPosition != null) {
                _mapController.move(LatLng(userPosition.latitude, userPosition.longitude), 15);
              } else {
                ref.invalidate(userLocationProvider);
              }
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
            onPressed: () => ref.invalidate(mySitesProvider),
          ),
        ],
      ),
      body: sitesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _Message(
          icon: Icons.cloud_off_outlined,
          title: 'Could not load your sites',
          detail: error.toString(),
          onRetry: () => ref.invalidate(mySitesProvider),
        ),
        data: (sites) {
          final located = sites.where((s) => s.hasLocation && nepalBounds.contains(s.point!)).toList();
          final unlocated = sites.length - located.length;
          final points = located.map((s) => s.point!).toList();

          return Stack(
            children: [
              FlutterMap(
                mapController: _mapController,
                options: MapOptions(
                  cameraConstraint: CameraConstraint.containCenter(
                    bounds: nepalBounds,
                  ),
                  initialCenter: points.isEmpty
                      ? (userPosition != null &&
                              nepalBounds.contains(LatLng(
                                  userPosition.latitude, userPosition.longitude))
                          ? LatLng(userPosition.latitude, userPosition.longitude)
                          : _countryCenter)
                      : points.first,
                  initialZoom: points.isEmpty && userPosition == null ? 7 : 13,
                  initialCameraFit: points.length > 1
                      ? CameraFit.coordinates(
                          coordinates: points,
                          padding: const EdgeInsets.fromLTRB(48, 48, 48, 220),
                          maxZoom: 15,
                        )
                      : null,
                  minZoom: 6.5,
                  maxZoom: 18,
                  onTap: (_, _) => setState(() => _selected = null),
                ),
                children: [
                  TileLayer(
                    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    userAgentPackageName: 'com.ipms.mobile',
                  ),
                  MarkerLayer(
                    markers: [
                      for (final site in located)
                        Marker(
                          point: site.point!,
                          width: 90,
                          height: 70,
                          child: GestureDetector(
                            onTap: () => setState(() => _selected = site),
                            child: _SitePin(site: site, selected: _selected?.siteId == site.siteId),
                          ),
                        ),
                      if (userPosition != null)
                        Marker(
                          point: LatLng(userPosition.latitude, userPosition.longitude),
                          width: 22,
                          height: 22,
                          child: Container(
                            decoration: BoxDecoration(
                              color: Colors.blue.shade600,
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.white, width: 3),
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
              if (sites.isEmpty)
                const Positioned(
                  left: 20,
                  right: 20,
                  top: 16,
                  child: _Banner(text: 'No work orders are assigned to you yet.'),
                )
              else if (unlocated > 0)
                Positioned(
                  left: 20,
                  right: 20,
                  top: 16,
                  child: _Banner(
                    text: '$unlocated site${unlocated == 1 ? ' has' : 's have'} no coordinates yet and '
                        '${unlocated == 1 ? 'is' : 'are'} not on the map.',
                  ),
                ),
              if (_selected != null)
                Positioned(
                  left: 20,
                  right: 20,
                  bottom: 100, // above the floating navigation bar
                  child: _SiteCard(site: _selected!),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _SitePin extends StatelessWidget {
  const _SitePin({required this.site, required this.selected});

  final MapSite site;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
          decoration: BoxDecoration(
            color: selected ? AppColors.primaryLavenderDark : AppColors.darkSlate,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            site.openCount > 0 ? '${site.siteCode} · ${site.openCount}' : site.siteCode,
            style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        Icon(
          Icons.location_on_rounded,
          size: 34,
          color: site.openCount > 0 ? AppColors.priorityHighText : AppColors.statusCompletedText,
        ),
      ],
    );
  }
}

class _SiteCard extends StatelessWidget {
  const _SiteCard({required this.site});

  final MapSite site;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(site.siteCode, style: AppTypography.titleLarge),
            if (site.siteName.isNotEmpty)
              Text(site.siteName, style: AppTypography.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 6),
            Text(
              '${site.openCount} open of ${site.tasks.length} work order${site.tasks.length == 1 ? '' : 's'}'
              '${site.projectCode != null ? ' • ${site.projectCode}' : ''}',
              style: AppTypography.caption,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.map_outlined, size: 16),
                    label: const Text('Site map'),
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute<void>(
                        builder: (_) => SiteMapScreen(
                          initialLatitude: site.latitude,
                          initialLongitude: site.longitude,
                          siteCode: site.siteCode,
                          siteName: site.siteName,
                          geofenceRadiusMeters: site.geofenceRadiusM?.toDouble(),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ElevatedButton.icon(
                    icon: const Icon(Icons.assignment_outlined, size: 16),
                    label: const Text('Work orders'),
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute<void>(
                        builder: (_) => SiteTasksScreen(
                          project: ProjectItem(
                            id: site.projectId,
                            code: site.projectCode ?? '',
                            name: site.projectName ?? '',
                            status: 'ACTIVE',
                          ),
                          site: ProjectSite(
                            id: site.siteId,
                            siteCode: site.siteCode,
                            name: site.siteName,
                            latitude: site.latitude,
                            longitude: site.longitude,
                            geofenceRadiusM: site.geofenceRadiusM,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.subtleDivider),
      ),
      child: Text(text, style: AppTypography.bodySmall),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.title, required this.detail, required this.onRetry});

  final IconData icon;
  final String title;
  final String detail;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: AppColors.textSecondary),
            const SizedBox(height: 10),
            Text(title, style: AppTypography.titleMedium),
            const SizedBox(height: 4),
            Text(detail, style: AppTypography.bodySmall, textAlign: TextAlign.center),
            TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
