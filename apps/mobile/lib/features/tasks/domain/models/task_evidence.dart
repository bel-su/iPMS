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
    this.checklistItemId,
    this.checklistItemTitle,
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
  final String? checklistItemId;
  final String? checklistItemTitle;
  final bool isSubmitted;
  final String? notes;

  TaskEvidence copyWith({
    String? filePath,
    String? checklistItemId,
    String? checklistItemTitle,
    bool? isSubmitted,
    String? notes,
  }) {
    return TaskEvidence(
      id: id,
      taskId: taskId,
      filePath: filePath ?? this.filePath,
      siteCode: siteCode,
      siteName: siteName,
      projectCode: projectCode,
      latitude: latitude,
      longitude: longitude,
      accuracy: accuracy,
      capturedBy: capturedBy,
      capturedAt: capturedAt,
      checklistItemId: checklistItemId ?? this.checklistItemId,
      checklistItemTitle: checklistItemTitle ?? this.checklistItemTitle,
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
        'checklistItemId': checklistItemId,
        'checklistItemTitle': checklistItemTitle,
        'isSubmitted': isSubmitted,
        'notes': notes,
      };

  factory TaskEvidence.fromJson(Map<String, dynamic> json) {
    return TaskEvidence(
      id: json['id'] as String? ?? '',
      taskId: json['taskId'] as String? ?? '',
      filePath: json['filePath'] as String? ?? '',
      siteCode: json['siteCode'] as String? ?? '',
      siteName: json['siteName'] as String? ?? '',
      projectCode: json['projectCode'] as String? ?? '',
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0.0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0.0,
      accuracy: (json['accuracy'] as num?)?.toDouble() ?? 0.0,
      capturedBy: json['capturedBy'] as String? ?? '',
      capturedAt: json['capturedAt'] != null
          ? DateTime.tryParse(json['capturedAt'].toString()) ?? DateTime.now()
          : DateTime.now(),
      checklistItemId: json['checklistItemId'] as String?,
      checklistItemTitle: json['checklistItemTitle'] as String?,
      isSubmitted: json['isSubmitted'] as bool? ?? false,
      notes: json['notes'] as String?,
    );
  }
}
