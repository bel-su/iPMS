import '../../../core/network/api_client.dart';
import '../domain/models/task_item.dart';

class TaskRepository {
  TaskRepository({required this.apiClient});

  final ApiClient apiClient;

  Future<List<TaskItem>> getAssignedTasks({
    String? status,
    String? query,
    String? siteCode,
    String? siteId,
  }) async {
    return _getDemoTasks(
      status: status,
      query: query,
      siteCode: siteCode,
      siteId: siteId,
    );
  }

  Future<TaskItem> getTaskById(String taskId) async {
    final demoTasks = _getDemoTasks();
    return demoTasks.firstWhere(
      (t) => t.id == taskId,
      orElse: () => _generateFallbackTask(taskId),
    );
  }

  TaskItem _generateFallbackTask(String taskId) {
    return TaskItem(
      id: taskId,
      siteId: 'site-kos121',
      taskTypeId: 'tt-general-inspection',
      title: 'Site Quality & Equipment Audit',
      status: 'ONGOING',
      priority: 'Medium',
      siteCode: 'KOS121',
      siteName: 'Kathmandu Central Hub',
      latitude: 27.7172,
      longitude: 85.3240,
      plannedCompletionAt: DateTime.now().add(const Duration(days: 3)),
      completedChecklistCount: 2,
      totalChecklistCount: 4,
      category: 'Quality Control',
      assigneeName: 'Alex Morgan',
    );
  }

  List<TaskItem> _getDemoTasks({
    String? status,
    String? query,
    String? siteCode,
    String? siteId,
  }) {
    final list = [
      // -------------------------------------------------------------
      // PROJECT: PRJ-5G-METRO
      // SITE: KOS121 (Kathmandu Central Hub - Sundhara / Ratna Park)
      // -------------------------------------------------------------
      TaskItem(
        id: 'task-101',
        siteId: 'site-kos121',
        taskTypeId: 'tt-civil-foundation',
        title: 'Civil Works & Tower Foundation',
        status: 'ONGOING',
        priority: 'High',
        siteCode: 'KOS121',
        siteName: 'Kathmandu Central Hub',
        latitude: 27.7172,
        longitude: 85.3240,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 2)),
        completedChecklistCount: 3,
        totalChecklistCount: 5,
        category: 'Civil Infrastructure',
        assigneeName: 'Alex Morgan',
      ),
      TaskItem(
        id: 'task-102',
        siteId: 'site-kos121',
        taskTypeId: 'tt-mimo-alignment',
        title: '4G/5G Massive MIMO Antenna Alignment',
        status: 'REVIEWING',
        priority: 'High',
        siteCode: 'KOS121',
        siteName: 'Kathmandu Central Hub',
        latitude: 27.7172,
        longitude: 85.3240,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 4)),
        completedChecklistCount: 4,
        totalChecklistCount: 4,
        category: 'RF / Telecom',
        assigneeName: 'Devon Lane',
      ),
      TaskItem(
        id: 'task-103',
        siteId: 'site-kos121',
        taskTypeId: 'tt-optical-patch',
        title: 'Fiber Optical Patch & Splicing Check',
        status: 'NOT_STARTED',
        priority: 'Medium',
        siteCode: 'KOS121',
        siteName: 'Kathmandu Central Hub',
        latitude: 27.7172,
        longitude: 85.3240,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 7)),
        completedChecklistCount: 0,
        totalChecklistCount: 4,
        category: 'Optical Fiber',
        assigneeName: 'Courtney Henry',
      ),
      TaskItem(
        id: 'task-104',
        siteId: 'site-kos121',
        taskTypeId: 'tt-power-ats',
        title: 'Main Substation & ATS Switchgear Integration',
        status: 'ONGOING',
        priority: 'High',
        siteCode: 'KOS121',
        siteName: 'Kathmandu Central Hub',
        latitude: 27.7172,
        longitude: 85.3240,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 3)),
        completedChecklistCount: 2,
        totalChecklistCount: 5,
        category: 'Power Systems',
        assigneeName: 'Cameron Williamson',
      ),

      // -------------------------------------------------------------
      // SITE: KOS232 (Lalitpur Telecom Tower - Jawalakhel Chowk)
      // -------------------------------------------------------------
      TaskItem(
        id: 'task-201',
        siteId: 'site-kos232',
        taskTypeId: 'tt-telecom-antenna',
        title: '5G Antenna & RF Cable Installation',
        status: 'REVIEWING',
        priority: 'High',
        siteCode: 'KOS232',
        siteName: 'Lalitpur Telecom Tower',
        latitude: 27.6644,
        longitude: 85.3188,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 5)),
        completedChecklistCount: 4,
        totalChecklistCount: 4,
        category: 'RF / Telecom',
        assigneeName: 'Devon Lane',
      ),
      TaskItem(
        id: 'task-202',
        siteId: 'site-kos232',
        taskTypeId: 'tt-aviation-light',
        title: 'Aviation Warning Light & Lightning Rod',
        status: 'ONGOING',
        priority: 'Medium',
        siteCode: 'KOS232',
        siteName: 'Lalitpur Telecom Tower',
        latitude: 27.6644,
        longitude: 85.3188,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 6)),
        completedChecklistCount: 2,
        totalChecklistCount: 4,
        category: 'Electrical & Safety',
        assigneeName: 'Alex Morgan',
      ),
      TaskItem(
        id: 'task-203',
        siteId: 'site-kos232',
        taskTypeId: 'tt-battery-rectifier',
        title: 'Battery Backup & Rectifier Cabinet Setup',
        status: 'NOT_STARTED',
        priority: 'Low',
        siteCode: 'KOS232',
        siteName: 'Lalitpur Telecom Tower',
        latitude: 27.6644,
        longitude: 85.3188,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 10)),
        completedChecklistCount: 0,
        totalChecklistCount: 3,
        category: 'Power Systems',
        assigneeName: 'Courtney Henry',
      ),
      TaskItem(
        id: 'task-204',
        siteId: 'site-kos232',
        taskTypeId: 'tt-los-calibration',
        title: 'Microwave Dish Azimuth Calibration & LoS Alignment',
        status: 'NOT_STARTED',
        priority: 'High',
        siteCode: 'KOS232',
        siteName: 'Lalitpur Telecom Tower',
        latitude: 27.6644,
        longitude: 85.3188,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 8)),
        completedChecklistCount: 0,
        totalChecklistCount: 4,
        category: 'Transmission',
        assigneeName: 'Devon Lane',
      ),

      // -------------------------------------------------------------
      // SITE: BKT105 (Bhaktapur Industrial Site - Byasi Bypass Road)
      // -------------------------------------------------------------
      TaskItem(
        id: 'task-301',
        siteId: 'site-bkt105',
        taskTypeId: 'tt-power-backup',
        title: 'DG Set & Power Backup Inspection',
        status: 'NOT_STARTED',
        priority: 'Medium',
        siteCode: 'BKT105',
        siteName: 'Bhaktapur Industrial Site',
        latitude: 27.6710,
        longitude: 85.4298,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 8)),
        completedChecklistCount: 0,
        totalChecklistCount: 6,
        category: 'Electrical',
        assigneeName: 'Courtney Henry',
      ),
      TaskItem(
        id: 'task-302',
        siteId: 'site-bkt105',
        taskTypeId: 'tt-fencing-security',
        title: 'Boundary Fencing & Security Sensor Check',
        status: 'ONGOING',
        priority: 'Low',
        siteCode: 'BKT105',
        siteName: 'Bhaktapur Industrial Site',
        latitude: 27.6710,
        longitude: 85.4298,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 3)),
        completedChecklistCount: 1,
        totalChecklistCount: 3,
        category: 'Civil & Security',
        assigneeName: 'Alex Morgan',
      ),
      TaskItem(
        id: 'task-303',
        siteId: 'site-bkt105',
        taskTypeId: 'tt-earthing-pit',
        title: 'Earthing Pit Resistance Certification',
        status: 'COMPLETED',
        priority: 'High',
        siteCode: 'BKT105',
        siteName: 'Bhaktapur Industrial Site',
        latitude: 27.6710,
        longitude: 85.4298,
        plannedCompletionAt: DateTime.now().subtract(const Duration(days: 2)),
        completedChecklistCount: 5,
        totalChecklistCount: 5,
        category: 'Electrical Audit',
        assigneeName: 'Cameron Williamson',
      ),
      TaskItem(
        id: 'task-304',
        siteId: 'site-bkt105',
        taskTypeId: 'tt-weather-gland',
        title: 'Secondary Shelter Cable Gland Weatherproofing',
        status: 'NOT_STARTED',
        priority: 'Medium',
        siteCode: 'BKT105',
        siteName: 'Bhaktapur Industrial Site',
        latitude: 27.6710,
        longitude: 85.4298,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 9)),
        completedChecklistCount: 0,
        totalChecklistCount: 3,
        category: 'Maintenance',
        assigneeName: 'Alex Morgan',
      ),

      // -------------------------------------------------------------
      // SITE: KOS108 (Thamel Metro Exchange - Chaksibari Marg)
      // -------------------------------------------------------------
      TaskItem(
        id: 'task-401',
        siteId: 'site-kos108',
        taskTypeId: 'tt-rooftop-mount',
        title: 'Rooftop Pole Mount Reinforcement',
        status: 'ONGOING',
        priority: 'High',
        siteCode: 'KOS108',
        siteName: 'Thamel Metro Exchange',
        latitude: 27.7154,
        longitude: 85.3123,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 3)),
        completedChecklistCount: 2,
        totalChecklistCount: 4,
        category: 'Civil Works',
        assigneeName: 'Alex Morgan',
      ),
      TaskItem(
        id: 'task-402',
        siteId: 'site-kos108',
        taskTypeId: 'tt-idf-wiring',
        title: 'Indoor Distribution Frame (IDF) Wiring',
        status: 'NOT_STARTED',
        priority: 'Medium',
        siteCode: 'KOS108',
        siteName: 'Thamel Metro Exchange',
        latitude: 27.7154,
        longitude: 85.3123,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 9)),
        completedChecklistCount: 0,
        totalChecklistCount: 4,
        category: 'Telecom Systems',
        assigneeName: 'Devon Lane',
      ),
      TaskItem(
        id: 'task-403',
        siteId: 'site-kos108',
        taskTypeId: 'tt-hvac-calibration',
        title: 'HVAC Shelter Climate Control Calibration',
        status: 'COMPLETED',
        priority: 'Low',
        siteCode: 'KOS108',
        siteName: 'Thamel Metro Exchange',
        latitude: 27.7154,
        longitude: 85.3123,
        plannedCompletionAt: DateTime.now().subtract(const Duration(days: 1)),
        completedChecklistCount: 3,
        totalChecklistCount: 3,
        category: 'Facility Systems',
        assigneeName: 'Cameron Williamson',
      ),

      // -------------------------------------------------------------
      // SITE: KOS310 (Patan Durbar Heritage Node - Mangal Bazaar)
      // -------------------------------------------------------------
      TaskItem(
        id: 'task-411',
        siteId: 'site-kos310',
        taskTypeId: 'tt-microcell-deploy',
        title: 'Camouflaged Micro-cell Deployment & Facade Match',
        status: 'ONGOING',
        priority: 'High',
        siteCode: 'KOS310',
        siteName: 'Patan Durbar Heritage Node',
        latitude: 27.6730,
        longitude: 85.3255,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 4)),
        completedChecklistCount: 2,
        totalChecklistCount: 4,
        category: 'RF / Telecom',
        assigneeName: 'Alex Morgan',
      ),
      TaskItem(
        id: 'task-412',
        siteId: 'site-kos310',
        taskTypeId: 'tt-low-impact-trench',
        title: 'Low-Impact Fiber Conduit Trenching',
        status: 'NOT_STARTED',
        priority: 'Medium',
        siteCode: 'KOS310',
        siteName: 'Patan Durbar Heritage Node',
        latitude: 27.6730,
        longitude: 85.3255,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 7)),
        completedChecklistCount: 0,
        totalChecklistCount: 3,
        category: 'Civil Infrastructure',
        assigneeName: 'Courtney Henry',
      ),

      // -------------------------------------------------------------
      // PROJECT: PRJ-FIBER-01
      // SITE: POK301 (Pokhara Lakeside Repeater)
      // -------------------------------------------------------------
      TaskItem(
        id: 'task-501',
        siteId: 'site-pok301',
        taskTypeId: 'tt-solar-setup',
        title: 'Solar Panel Array Integration',
        status: 'COMPLETED',
        priority: 'Low',
        siteCode: 'POK301',
        siteName: 'Pokhara Lakeside Repeater',
        latitude: 28.2096,
        longitude: 83.9856,
        plannedCompletionAt: DateTime.now().subtract(const Duration(days: 1)),
        completedChecklistCount: 5,
        totalChecklistCount: 5,
        category: 'Green Energy',
        assigneeName: 'Cameron Williamson',
      ),
      TaskItem(
        id: 'task-502',
        siteId: 'site-pok301',
        taskTypeId: 'tt-microwave-los',
        title: 'Microwave Line-of-Sight Alignment',
        status: 'ONGOING',
        priority: 'High',
        siteCode: 'POK301',
        siteName: 'Pokhara Lakeside Repeater',
        latitude: 28.2096,
        longitude: 83.9856,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 4)),
        completedChecklistCount: 2,
        totalChecklistCount: 3,
        category: 'Transmission',
        assigneeName: 'Alex Morgan',
      ),
      TaskItem(
        id: 'task-503',
        siteId: 'site-pok301',
        taskTypeId: 'tt-hi-cap-splicing',
        title: 'High-Capacity Optical Splicing & OTDR Testing',
        status: 'ONGOING',
        priority: 'High',
        siteCode: 'POK301',
        siteName: 'Pokhara Lakeside Repeater',
        latitude: 28.2096,
        longitude: 83.9856,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 5)),
        completedChecklistCount: 2,
        totalChecklistCount: 4,
        category: 'Optical Fiber',
        assigneeName: 'Courtney Henry',
      ),

      // -------------------------------------------------------------
      // SITE: CTR204 (Chitwan Distribution Node)
      // -------------------------------------------------------------
      TaskItem(
        id: 'task-601',
        siteId: 'site-ctr204',
        taskTypeId: 'tt-duct-trenching',
        title: 'Optical Duct Trenching & Depth Verification',
        status: 'ONGOING',
        priority: 'High',
        siteCode: 'CTR204',
        siteName: 'Chitwan Distribution Node',
        latitude: 27.6833,
        longitude: 84.4333,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 3)),
        completedChecklistCount: 3,
        totalChecklistCount: 6,
        category: 'Civil Infrastructure',
        assigneeName: 'Alex Morgan',
      ),
      TaskItem(
        id: 'task-602',
        siteId: 'site-ctr204',
        taskTypeId: 'tt-conduit-sealing',
        title: 'Underground Chamber Sealing & Waterproofing',
        status: 'NOT_STARTED',
        priority: 'Medium',
        siteCode: 'CTR204',
        siteName: 'Chitwan Distribution Node',
        latitude: 27.6833,
        longitude: 84.4333,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 8)),
        completedChecklistCount: 0,
        totalChecklistCount: 4,
        category: 'Quality Control',
        assigneeName: 'Courtney Henry',
      ),
      TaskItem(
        id: 'task-603',
        siteId: 'site-ctr204',
        taskTypeId: 'tt-dispersion-test',
        title: 'Fiber Loop Resistance & Dispersion Test',
        status: 'REVIEWING',
        priority: 'Medium',
        siteCode: 'CTR204',
        siteName: 'Chitwan Distribution Node',
        latitude: 27.6833,
        longitude: 84.4333,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 4)),
        completedChecklistCount: 3,
        totalChecklistCount: 3,
        category: 'Optical Testing',
        assigneeName: 'Devon Lane',
      ),

      // -------------------------------------------------------------
      // SITE: BUT505 (Butwal Transit Repeater)
      // -------------------------------------------------------------
      TaskItem(
        id: 'task-611',
        siteId: 'site-but505',
        taskTypeId: 'tt-surge-protector',
        title: 'High-Voltage Surge Protector Replacement',
        status: 'ONGOING',
        priority: 'High',
        siteCode: 'BUT505',
        siteName: 'Butwal Transit Repeater',
        latitude: 27.7006,
        longitude: 83.4484,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 3)),
        completedChecklistCount: 2,
        totalChecklistCount: 4,
        category: 'Electrical & Safety',
        assigneeName: 'Cameron Williamson',
      ),
      TaskItem(
        id: 'task-612',
        siteId: 'site-but505',
        taskTypeId: 'tt-rack-grounding',
        title: 'Distribution Rack Grounding & Labelling',
        status: 'NOT_STARTED',
        priority: 'Low',
        siteCode: 'BUT505',
        siteName: 'Butwal Transit Repeater',
        latitude: 27.7006,
        longitude: 83.4484,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 9)),
        completedChecklistCount: 0,
        totalChecklistCount: 3,
        category: 'Quality Control',
        assigneeName: 'Alex Morgan',
      ),

      // -------------------------------------------------------------
      // PROJECT: PRJ-SOLAR-03
      // SITE: NMK701 (Namche Alpine Repeater)
      // -------------------------------------------------------------
      TaskItem(
        id: 'task-701',
        siteId: 'site-nmk701',
        taskTypeId: 'tt-wind-turbine',
        title: 'High-Altitude Wind Turbine Blade Inspection',
        status: 'ONGOING',
        priority: 'High',
        siteCode: 'NMK701',
        siteName: 'Namche Alpine Repeater',
        latitude: 27.8069,
        longitude: 86.7140,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 2)),
        completedChecklistCount: 2,
        totalChecklistCount: 4,
        category: 'Renewable Energy',
        assigneeName: 'Alex Morgan',
      ),
      TaskItem(
        id: 'task-702',
        siteId: 'site-nmk701',
        taskTypeId: 'tt-battery-thermal',
        title: 'Lithium LiFePO4 Thermal Chamber Setup',
        status: 'NOT_STARTED',
        priority: 'High',
        siteCode: 'NMK701',
        siteName: 'Namche Alpine Repeater',
        latitude: 27.8069,
        longitude: 86.7140,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 6)),
        completedChecklistCount: 0,
        totalChecklistCount: 4,
        category: 'Energy Storage',
        assigneeName: 'Courtney Henry',
      ),
      TaskItem(
        id: 'task-703',
        siteId: 'site-nmk701',
        taskTypeId: 'tt-guy-wire',
        title: 'Snow-Load Structural Guy Wire Tensioning',
        status: 'REVIEWING',
        priority: 'Medium',
        siteCode: 'NMK701',
        siteName: 'Namche Alpine Repeater',
        latitude: 27.8069,
        longitude: 86.7140,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 4)),
        completedChecklistCount: 3,
        totalChecklistCount: 3,
        category: 'Structural Engineering',
        assigneeName: 'Devon Lane',
      ),

      // -------------------------------------------------------------
      // SITE: JML802 (Jumla Mountain Node)
      // -------------------------------------------------------------
      TaskItem(
        id: 'task-801',
        siteId: 'site-jml802',
        taskTypeId: 'tt-sun-tracker',
        title: 'Solar Array Dual-Axis Sun Tracker Calibration',
        status: 'NOT_STARTED',
        priority: 'Medium',
        siteCode: 'JML802',
        siteName: 'Jumla Mountain Node',
        latitude: 29.2748,
        longitude: 82.1838,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 7)),
        completedChecklistCount: 0,
        totalChecklistCount: 4,
        category: 'Solar Automation',
        assigneeName: 'Cameron Williamson',
      ),
      TaskItem(
        id: 'task-802',
        siteId: 'site-jml802',
        taskTypeId: 'tt-vsat-backup',
        title: 'Satellite VSAT Backup Transceiver Alignment',
        status: 'ONGOING',
        priority: 'High',
        siteCode: 'JML802',
        siteName: 'Jumla Mountain Node',
        latitude: 29.2748,
        longitude: 82.1838,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 3)),
        completedChecklistCount: 1,
        totalChecklistCount: 3,
        category: 'Satellite Comms',
        assigneeName: 'Alex Morgan',
      ),
    ];

    // Check if siteCode or siteId specifically requested
    final codeTarget = (siteCode ?? siteId)?.trim().toUpperCase();

    if (codeTarget != null && codeTarget.isNotEmpty) {
      final siteMatches = list.where((item) {
        final matchesCode = item.siteCode?.toUpperCase() == codeTarget;
        final matchesId = item.siteId.toUpperCase() == codeTarget;
        return matchesCode || matchesId;
      }).toList();

      if (siteMatches.isNotEmpty) {
        return siteMatches.where((item) {
          if (status != null && status != 'ALL' && item.status != status) {
            return false;
          }
          if (query != null && query.isNotEmpty && query.toUpperCase() != codeTarget) {
            final q = query.toLowerCase();
            return item.title.toLowerCase().contains(q) ||
                item.category.toLowerCase().contains(q);
          }
          return true;
        }).toList();
      }

      // If an arbitrary or dynamic site code was passed that has no hardcoded tasks,
      // dynamically generate 3 domain-accurate tasks for it
      return _generateDynamicTasksForSite(codeTarget, status: status);
    }

    // General tasks query
    return list.where((item) {
      if (status != null && status != 'ALL' && item.status != status) {
        return false;
      }
      if (query != null && query.isNotEmpty) {
        final q = query.toLowerCase();
        return item.title.toLowerCase().contains(q) ||
            (item.siteCode?.toLowerCase().contains(q) ?? false) ||
            (item.siteId.toLowerCase().contains(q)) ||
            (item.siteName?.toLowerCase().contains(q) ?? false) ||
            item.category.toLowerCase().contains(q);
      }
      return true;
    }).toList();
  }

  List<TaskItem> _generateDynamicTasksForSite(String code, {String? status}) {
    final tasks = [
      TaskItem(
        id: 'task-$code-101',
        siteId: 'site-${code.toLowerCase()}',
        taskTypeId: 'tt-site-survey',
        title: 'Initial Site Survey & Geofence Verification',
        status: 'ONGOING',
        priority: 'High',
        siteCode: code,
        siteName: 'Site $code',
        latitude: 27.7172,
        longitude: 85.3240,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 3)),
        completedChecklistCount: 2,
        totalChecklistCount: 4,
        category: 'Civil & Survey',
        assigneeName: 'Alex Morgan',
      ),
      TaskItem(
        id: 'task-$code-102',
        siteId: 'site-${code.toLowerCase()}',
        taskTypeId: 'tt-equipment-mount',
        title: 'Equipment Installation & Jumper Routing',
        status: 'NOT_STARTED',
        priority: 'Medium',
        siteCode: code,
        siteName: 'Site $code',
        latitude: 27.7172,
        longitude: 85.3240,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 6)),
        completedChecklistCount: 0,
        totalChecklistCount: 5,
        category: 'RF / Telecom',
        assigneeName: 'Devon Lane',
      ),
      TaskItem(
        id: 'task-$code-103',
        siteId: 'site-${code.toLowerCase()}',
        taskTypeId: 'tt-qc-audit',
        title: 'Quality Acceptance & Watermarked Photo Capture',
        status: 'NOT_STARTED',
        priority: 'High',
        siteCode: code,
        siteName: 'Site $code',
        latitude: 27.7172,
        longitude: 85.3240,
        plannedCompletionAt: DateTime.now().add(const Duration(days: 8)),
        completedChecklistCount: 0,
        totalChecklistCount: 4,
        category: 'Quality Control',
        assigneeName: 'Courtney Henry',
      ),
    ];

    if (status != null && status != 'ALL') {
      return tasks.where((t) => t.status == status).toList();
    }
    return tasks;
  }
}
