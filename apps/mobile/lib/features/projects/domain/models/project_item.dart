/// Model representing a project in the iPMS system.
class ProjectItem {
  const ProjectItem({
    required this.id,
    required this.code,
    required this.name,
    this.clientName,
    this.phase,
    required this.status,
    this.defaultGeofenceRadiusM = 500,
    this.startDate,
    this.targetDate,
    this.siteCount = 0,
    this.taskCount = 0,
    this.sites = const [],
  });

  final String id;
  final String code;
  final String name;
  final String? clientName;
  final String? phase;
  final String status;
  final int defaultGeofenceRadiusM;
  final DateTime? startDate;
  final DateTime? targetDate;
  final int siteCount;
  final int taskCount;
  final List<ProjectSite> sites;

  ProjectItem copyWith({
    String? id,
    String? code,
    String? name,
    String? clientName,
    String? phase,
    String? status,
    int? defaultGeofenceRadiusM,
    DateTime? startDate,
    DateTime? targetDate,
    int? siteCount,
    int? taskCount,
    List<ProjectSite>? sites,
  }) {
    return ProjectItem(
      id: id ?? this.id,
      code: code ?? this.code,
      name: name ?? this.name,
      clientName: clientName ?? this.clientName,
      phase: phase ?? this.phase,
      status: status ?? this.status,
      defaultGeofenceRadiusM: defaultGeofenceRadiusM ?? this.defaultGeofenceRadiusM,
      startDate: startDate ?? this.startDate,
      targetDate: targetDate ?? this.targetDate,
      siteCount: siteCount ?? this.siteCount,
      taskCount: taskCount ?? this.taskCount,
      sites: sites ?? this.sites,
    );
  }

  factory ProjectItem.fromJson(Map<String, dynamic> json) {
    final count = json['_count'] as Map<String, dynamic>?;
    final rawSites = json['sites'] as List<dynamic>? ?? [];

    return ProjectItem(
      id: json['id'] as String? ?? '',
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      clientName: json['clientName'] as String?,
      phase: json['phase'] as String?,
      status: json['status'] as String? ?? 'ACTIVE',
      defaultGeofenceRadiusM: (json['defaultGeofenceRadiusM'] as num?)?.toInt() ?? 500,
      startDate: json['startDate'] != null ? DateTime.tryParse(json['startDate'].toString()) : null,
      targetDate: json['targetDate'] != null ? DateTime.tryParse(json['targetDate'].toString()) : null,
      siteCount: (count?['sites'] as num?)?.toInt() ?? rawSites.length,
      taskCount: (count?['tasks'] as num?)?.toInt() ?? 0,
      sites: rawSites.map((s) => ProjectSite.fromJson(s as Map<String, dynamic>)).toList(),
    );
  }
}

/// Site belonging to a project.
class ProjectSite {
  const ProjectSite({
    required this.id,
    required this.siteCode,
    required this.name,
    this.latitude,
    this.longitude,
    this.geofenceRadiusM,
    this.address,
    this.city,
    this.status = 'ACTIVE',
  });

  final String id;
  final String siteCode;
  final String name;
  final double? latitude;
  final double? longitude;
  final int? geofenceRadiusM;
  final String? address;
  final String? city;
  final String status;

  factory ProjectSite.fromJson(Map<String, dynamic> json) {
    return ProjectSite(
      id: json['id'] as String? ?? '',
      siteCode: json['siteCode'] as String? ?? '',
      name: json['name'] as String? ?? '',
      latitude: json['latitude'] != null ? (json['latitude'] as num).toDouble() : null,
      longitude: json['longitude'] != null ? (json['longitude'] as num).toDouble() : null,
      geofenceRadiusM: (json['geofenceRadiusM'] as num?)?.toInt(),
      address: json['address'] as String?,
      city: json['city'] as String?,
      status: json['status'] as String? ?? 'ACTIVE',
    );
  }
}
