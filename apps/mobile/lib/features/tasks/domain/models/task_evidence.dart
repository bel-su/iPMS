/// Where a photo is in its trip to the media bucket.
class EvidenceUploadStatus {
  EvidenceUploadStatus._();

  /// Only on the phone; not yet sent.
  static const String local = 'LOCAL';
  static const String uploading = 'UPLOADING';

  /// Bytes are in the bucket; the server is checking the hash and type.
  static const String verifying = 'VERIFYING';
  static const String ready = 'READY';
  static const String attached = 'ATTACHED';

  /// The server refused the bytes; they must be sent again under a new id.
  static const String rejected = 'REJECTED';

  /// The last attempt did not finish (offline, server down); safe to retry.
  static const String failed = 'FAILED';
}

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
    String? mediaId,
    this.contentHash,
    this.uploadStatus = EvidenceUploadStatus.local,
    this.uploadError,
  }) : mediaId = mediaId ?? id;

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

  /// The id the media service knows this file by. Fixed at capture so every
  /// retry names the same object; replaced only when the server rejected the
  /// bytes and they must be registered again.
  final String mediaId;

  /// SHA-256 (hex) of the file, taken when it was first registered.
  final String? contentHash;
  final String uploadStatus;
  final String? uploadError;

  /// False when the phone had no GPS fix at capture ([accuracy] < 0); the
  /// coordinates are then placeholders and are not sent to the server.
  bool get hasLocationFix => accuracy >= 0;

  bool get isUploaded =>
      uploadStatus == EvidenceUploadStatus.ready || uploadStatus == EvidenceUploadStatus.attached;

  bool get isUploading =>
      uploadStatus == EvidenceUploadStatus.uploading || uploadStatus == EvidenceUploadStatus.verifying;

  TaskEvidence copyWith({
    String? filePath,
    String? checklistItemId,
    String? checklistItemTitle,
    bool? isSubmitted,
    String? notes,
    String? mediaId,
    String? contentHash,
    String? uploadStatus,
    String? uploadError,
    bool clearUploadError = false,
    bool clearContentHash = false,
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
      mediaId: mediaId ?? this.mediaId,
      contentHash: clearContentHash ? null : (contentHash ?? this.contentHash),
      uploadStatus: uploadStatus ?? this.uploadStatus,
      uploadError: clearUploadError ? null : (uploadError ?? this.uploadError),
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
        'mediaId': mediaId,
        'contentHash': contentHash,
        'uploadStatus': uploadStatus,
        'uploadError': uploadError,
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
      mediaId: json['mediaId'] as String?,
      contentHash: json['contentHash'] as String?,
      uploadStatus: json['uploadStatus'] as String? ?? EvidenceUploadStatus.local,
      uploadError: json['uploadError'] as String?,
    );
  }
}
