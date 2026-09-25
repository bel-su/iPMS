/// Model representing tamper-evident photo evidence captured on-site.
class TaskEvidence {
  const TaskEvidence({
    required this.id,
    required this.taskId,
    required this.filePath,
    required this.siteCode,
    required this.siteName,
    required this.projectCode,
    required this.latitude,
    required this.longitude,
    required this.accuracy,
    required this.capturedBy,
    required this.capturedAt,
    this.isSubmitted = false,
    this.notes,
  });

  final String id;
  final String taskId;
  final String filePath;
  final String siteCode;
  final String siteName;
  final String projectCode;
  final double latitude;
  final double longitude;
  final double accuracy;
  final String capturedBy;
  final DateTime capturedAt;
  final bool isSubmitted;
  final String? notes;

  TaskEvidence copyWith({
    bool? isSubmitted,
    String? notes,
  }) {
    return TaskEvidence(
      id: id,
      taskId: taskId,
      filePath: filePath,
      siteCode: siteCode,
      siteName: siteName,
      projectCode: projectCode,
      latitude: latitude,
      longitude: longitude,
      accuracy: accuracy,
      capturedBy: capturedBy,
      capturedAt: capturedAt,
      isSubmitted: isSubmitted ?? this.isSubmitted,
      notes: notes ?? this.notes,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'taskId': taskId,
        'filePath': filePath,
        'siteCode': siteCode,
        'siteName': siteName,
        'projectCode': projectCode,
        'latitude': latitude,
        'longitude': longitude,
        'accuracy': accuracy,
        'capturedBy': capturedBy,
        'capturedAt': capturedAt.toIso8601String(),
        'isSubmitted': isSubmitted,
        'notes': notes,
      };
}
