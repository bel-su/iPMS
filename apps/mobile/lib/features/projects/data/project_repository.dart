import 'package:dio/dio.dart';
import '../../../core/config/api_endpoints.dart';
import '../../../core/config/env.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../domain/models/project_item.dart';

class ProjectRepository {
  ProjectRepository({required this.apiClient});

  final ApiClient apiClient;

  /// Projects the caller can see. The list endpoint returns counts but not
  /// sites; [getProjectById] loads a project's (scoped) sites.
  Future<List<ProjectItem>> getProjects() async {
    try {
      final response = await apiClient.dio.get<List<dynamic>>(ApiEndpoints.projects);
      final projects = (response.data ?? const [])
          .map((item) => ProjectItem.fromJson(item as Map<String, dynamic>))
          .toList();
      // The project's own task count predates work orders, which are what
      // the field works on; count those instead.
      return await Future.wait(projects.map((p) async {
        final count = await _workOrderCount(p.id);
        return count == null ? p : p.copyWith(taskCount: count);
      }));
    } on DioException catch (e) {
      if (AppConfig.demoMode) return _getDemoProjects();
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load projects.');
    }
  }

  Future<int?> _workOrderCount(String projectId) async {
    try {
      final response = await apiClient.dio.get<Map<String, dynamic>>(
        ApiEndpoints.workOrders,
        queryParameters: {'projectId': projectId, 'limit': 1},
      );
      final total = (response.data?['total'] as num?)?.toInt();
      if (total == null) return null;
      // Cancelled work orders are not shown to the field, so not counted.
      final counts = response.data?['counts'];
      final cancelled = counts is Map ? (counts['CANCELLED'] as num?)?.toInt() ?? 0 : 0;
      return total - cancelled;
    } catch (_) {
      return null;
    }
  }

  Future<ProjectItem> getProjectById(String id) async {
    try {
      final response =
          await apiClient.dio.get<Map<String, dynamic>>(ApiEndpoints.project(id));
      final data = response.data;
      if (data == null) {
        throw const ApiException(message: 'Project not found.');
      }
      return ProjectItem.fromJson(data);
    } on DioException catch (e) {
      if (AppConfig.demoMode) {
        final demoList = _getDemoProjects();
        return demoList.firstWhere((p) => p.id == id, orElse: () => demoList.first);
      }
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load project.');
    }
  }

  /// Demo mode only: sample sites tailored to the project code or type
  static List<ProjectSite> getDemoSitesForProjectCode(String projectCode) {
    final code = projectCode.toUpperCase();
    if (code.contains('FIBER') || code.contains('BACKBONE')) {
      return const [
        ProjectSite(
          id: 'site-pok301',
          siteCode: 'POK301',
          name: 'Pokhara Lakeside Repeater',
          latitude: 28.2096,
          longitude: 83.9856,
          geofenceRadiusM: 120,
          address: 'Lakeside Baidam Road',
          city: 'Pokhara',
        ),
        ProjectSite(
          id: 'site-ctr204',
          siteCode: 'CTR204',
          name: 'Chitwan Distribution Node',
          latitude: 27.6833,
          longitude: 84.4333,
          geofenceRadiusM: 150,
          address: 'Bharatpur Bypass Chowk',
          city: 'Chitwan',
        ),
        ProjectSite(
          id: 'site-but505',
          siteCode: 'BUT505',
          name: 'Butwal Transit Repeater',
          latitude: 27.7006,
          longitude: 83.4484,
          geofenceRadiusM: 110,
          address: 'Main Highway Traffic Chowk',
          city: 'Butwal',
        ),
      ];
    } else if (code.contains('SOLAR') || code.contains('OFF-GRID') || code.contains('MICROGRID')) {
      return const [
        ProjectSite(
          id: 'site-nmk701',
          siteCode: 'NMK701',
          name: 'Namche Alpine Repeater',
          latitude: 27.8069,
          longitude: 86.7140,
          geofenceRadiusM: 90,
          address: 'Namche Hill Summit',
          city: 'Solukhumbu',
        ),
        ProjectSite(
          id: 'site-jml802',
          siteCode: 'JML802',
          name: 'Jumla Mountain Node',
          latitude: 29.2748,
          longitude: 82.1838,
          geofenceRadiusM: 130,
          address: 'Airport Ridge, Khalanga',
          city: 'Jumla',
        ),
      ];
    }

    // Default to Kathmandu Valley 5G Metro sites
    return const [
      ProjectSite(
        id: 'site-kos121',
        siteCode: 'KOS121',
        name: 'Kathmandu Central Hub',
        latitude: 27.7172,
        longitude: 85.3240,
        geofenceRadiusM: 100,
        address: 'Sundhara / Ratna Park Area',
        city: 'Kathmandu',
      ),
      ProjectSite(
        id: 'site-kos232',
        siteCode: 'KOS232',
        name: 'Lalitpur Telecom Tower',
        latitude: 27.6644,
        longitude: 85.3188,
        geofenceRadiusM: 150,
        address: 'Jawalakhel Chowk',
        city: 'Lalitpur',
      ),
      ProjectSite(
        id: 'site-bkt105',
        siteCode: 'BKT105',
        name: 'Bhaktapur Industrial Site',
        latitude: 27.6710,
        longitude: 85.4298,
        geofenceRadiusM: 200,
        address: 'Byasi Bypass Road',
        city: 'Bhaktapur',
      ),
      ProjectSite(
        id: 'site-kos108',
        siteCode: 'KOS108',
        name: 'Thamel Metro Exchange',
        latitude: 27.7154,
        longitude: 85.3123,
        geofenceRadiusM: 80,
        address: 'Chaksibari Marg, Thamel',
        city: 'Kathmandu',
      ),
      ProjectSite(
        id: 'site-kos310',
        siteCode: 'KOS310',
        name: 'Patan Durbar Heritage Node',
        latitude: 27.6730,
        longitude: 85.3255,
        geofenceRadiusM: 60,
        address: 'Mangal Bazaar',
        city: 'Patan',
      ),
    ];
  }

  List<ProjectItem> _getDemoProjects() {
    return [
      ProjectItem(
        id: 'prj-5g-metro',
        code: 'PRJ-5G-METRO',
        name: 'Kathmandu Valley 5G Metro Expansion',
        clientName: 'Nepal Telecom Corp',
        phase: 'Phase 2 - Radio Access Network',
        status: 'ACTIVE',
        siteCount: 5,
        taskCount: 16,
        startDate: DateTime(2026, 1, 15),
        targetDate: DateTime(2026, 12, 31),
        sites: getDemoSitesForProjectCode('PRJ-5G-METRO'),
      ),
      ProjectItem(
        id: 'prj-fiber-01',
        code: 'PRJ-FIBER-01',
        name: 'Nationwide Optical Fiber Backbone',
        clientName: 'National Infrastructure Authority',
        phase: 'Phase 1 - Civil Ducts & Trenching',
        status: 'ACTIVE',
        siteCount: 3,
        taskCount: 8,
        startDate: DateTime(2026, 3, 1),
        targetDate: DateTime(2027, 6, 30),
        sites: getDemoSitesForProjectCode('PRJ-FIBER-01'),
      ),
      ProjectItem(
        id: 'prj-solar-03',
        code: 'PRJ-SOLAR-03',
        name: 'Off-Grid Remote Tower Microgrids',
        clientName: 'Rural Telecom Development Fund',
        phase: 'Phase 3 - Solar PV & Battery Storage',
        status: 'ACTIVE',
        siteCount: 2,
        taskCount: 5,
        startDate: DateTime(2026, 5, 10),
        targetDate: DateTime(2027, 2, 28),
        sites: getDemoSitesForProjectCode('PRJ-SOLAR-03'),
      ),
    ];
  }
}
