/// Domain model for tasks fetched live via API Gateway.
class TaskItem {
  const TaskItem({
    required this.id,
    required this.siteId,
    required this.taskTypeId,
    required this.title,
    required this.status,
    this.priority = 'Medium',
    this.siteCode,
    this.siteName,
    this.latitude,
    this.longitude,
    this.plannedCompletionAt,
    this.completedChecklistCount = 0,
    this.totalChecklistCount = 0,
    this.assigneeName,
    this.category = 'Telecom / Civil',
    this.projectId,
    this.projectCode,
    this.projectName,
    this.assigneeId,
    this.workOrderType,
    this.templateName,
    this.siteCity,
    this.geofenceRadiusM,
    this.currentSubmissionId,
  });

  final String id;
  final String siteId;
  final String taskTypeId;
  final String title;
  final String status;
  final String priority;
  final String? siteCode;
  final String? siteName;
  final double? latitude;
  final double? longitude;
  final DateTime? plannedCompletionAt;
  final int completedChecklistCount;
  final int totalChecklistCount;
  final String? assigneeName;
  final String category;
  final String? projectId;
  final String? projectCode;
  final String? projectName;
  final String? assigneeId;
  final String? workOrderType;
  final String? templateName;
  final String? siteCity;
  final int? geofenceRadiusM;

  /// The latest submission, whose review explains a rework (RECTIFYING).
  final String? currentSubmissionId;

  /// Open work whose planned completion has passed.
  bool get isOverdue =>
      plannedCompletionAt != null &&
      plannedCompletionAt!.isBefore(DateTime.now()) &&
      _openStatuses.contains(status);

  static const Set<String> _openStatuses = {'NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING'};

  /// A work order can be worked on and submitted from the field only while
  /// it is waiting on the assignee.
  bool get isSubmittable => status == 'NOT_STARTED' || status == 'ONGOING' || status == 'RECTIFYING';

  TaskItem copyWith({
    double? latitude,
    double? longitude,
    int? geofenceRadiusM,
    String? assigneeName,
  }) {
    return TaskItem(
      id: id,
      siteId: siteId,
      taskTypeId: taskTypeId,
      title: title,
      status: status,
      priority: priority,
      siteCode: siteCode,
      siteName: siteName,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      plannedCompletionAt: plannedCompletionAt,
      completedChecklistCount: completedChecklistCount,
      totalChecklistCount: totalChecklistCount,
      assigneeName: assigneeName ?? this.assigneeName,
      category: category,
      projectId: projectId,
      projectCode: projectCode,
      projectName: projectName,
      assigneeId: assigneeId,
      workOrderType: workOrderType,
      templateName: templateName,
      siteCity: siteCity,
      geofenceRadiusM: geofenceRadiusM ?? this.geofenceRadiusM,
      currentSubmissionId: currentSubmissionId,
    );
  }

  static const Map<String, String> workOrderTypeLabels = {
    'QUALITY_SELF_CHECK': 'Quality Self-check',
    'QUALITY_SPOT_CHECK': 'Quality Spot Check',
    'EHS_SELF_CHECK': 'EHS Self-check',
    'EHS_SPOT_CHECK': 'EHS Spot Check',
  };

  /// A work order from qc's `/work-orders` API. Work orders carry no
  /// priority, so overdue work is shown as High. Site coordinates are not on
  /// the work order; the repository adds them from the project's sites.
  factory TaskItem.fromWorkOrder(Map<String, dynamic> json) {
    final site = json['site'] as Map<String, dynamic>? ?? const {};
    final project = json['project'] as Map<String, dynamic>? ?? const {};
    final type = json['workOrderType'] as String?;
    final status = json['status'] as String? ?? 'NOT_STARTED';
    final planned = json['plannedCompletionAt'] != null
        ? DateTime.tryParse(json['plannedCompletionAt'].toString())?.toLocal()
        : null;
    final overdue = planned != null &&
        planned.isBefore(DateTime.now()) &&
        _openStatuses.contains(status);
    return TaskItem(
      id: json['id'] as String? ?? '',
      siteId: json['siteId'] as String? ?? site['id'] as String? ?? '',
      taskTypeId: json['templateId'] as String? ?? '',
      title: json['title'] as String? ?? 'Untitled work order',
      status: status,
      priority: overdue ? 'High' : 'Medium',
      siteCode: site['siteCode'] as String?,
      siteName: site['name'] as String?,
      siteCity: site['city'] as String?,
      plannedCompletionAt: planned,
      category: workOrderTypeLabels[type] ?? json['templateName'] as String? ?? 'Work order',
      projectId: json['projectId'] as String? ?? project['id'] as String?,
      projectCode: project['code'] as String?,
      projectName: project['name'] as String?,
      assigneeId: json['assigneeId'] as String?,
      workOrderType: type,
      templateName: json['templateName'] as String?,
      currentSubmissionId: json['currentSubmissionId'] as String?,
    );
  }

  /// Checklist progress when the counts are known; otherwise how far the
  /// work order is through its lifecycle (the work order list carries no
  /// per-item counts).
  double get progressPercentage {
    if (totalChecklistCount > 0) {
      return (completedChecklistCount / totalChecklistCount).clamp(0.0, 1.0);
    }
    return switch (status) {
      'NOT_STARTED' => 0.0,
      'ONGOING' => 0.35,
      'RECTIFYING' => 0.5,
      'REVIEWING' => 0.8,
      'COMPLETED' => 1.0,
      _ => 0.0,
    };
  }

  bool get hasChecklistCounts => totalChecklistCount > 0;

  factory TaskItem.fromJson(Map<String, dynamic> json) {
    DateTime? plannedDate;
    if (json['plannedCompletionAt'] != null) {
      plannedDate = DateTime.tryParse(json['plannedCompletionAt'].toString());
    }

    final site = json['site'] as Map<String, dynamic>?;

    return TaskItem(
      id: json['id'] as String? ?? '',
      siteId: json['siteId'] as String? ?? '',
      taskTypeId: json['taskTypeId'] as String? ?? '',
      title: json['title'] as String? ?? 'Untitled Task',
      status: json['status'] as String? ?? 'NOT_STARTED',
      priority: json['priority'] as String? ?? 'Medium',
      siteCode: site?['siteCode'] as String? ?? json['siteCode'] as String?,
      siteName: site?['name'] as String? ?? json['siteName'] as String?,
      latitude: (site?['latitude'] as num?)?.toDouble() ??
          (json['latitude'] as num?)?.toDouble(),
      longitude: (site?['longitude'] as num?)?.toDouble() ??
          (json['longitude'] as num?)?.toDouble(),
      plannedCompletionAt: plannedDate,
      completedChecklistCount:
          (json['completedChecklistCount'] as num?)?.toInt() ?? 0,
      totalChecklistCount: (json['totalChecklistCount'] as num?)?.toInt() ?? 0,
      assigneeName: json['assignee']?['displayName'] as String? ??
          json['assigneeName'] as String?,
      category: json['taskType']?['category'] as String? ??
          json['category'] as String? ??
          'Field Work',
    );
  }
}
