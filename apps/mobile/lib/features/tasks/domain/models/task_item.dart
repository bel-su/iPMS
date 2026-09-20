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

  double get progressPercentage {
    if (totalChecklistCount == 0) return status == 'COMPLETED' ? 1.0 : 0.25;
    return (completedChecklistCount / totalChecklistCount).clamp(0.0, 1.0);
  }

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
