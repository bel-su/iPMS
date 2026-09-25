import 'task_evidence.dart';

/// Domain model representing a QC checklist requirement item on-site.
class ChecklistItem {
  const ChecklistItem({
    required this.id,
    required this.itemNumber,
    required this.title,
    this.guidanceText,
    this.isRequired = true,
    this.evidenceRequired = true,
    this.minPhotos = 1,
    this.isCompleted = false,
    this.verdict = 'PENDING',
    this.evidenceList = const [],
    this.remarks,
  });

  final String id;
  final String itemNumber;
  final String title;
  final String? guidanceText;
  final bool isRequired;
  final bool evidenceRequired;
  final int minPhotos;
  final bool isCompleted;
  final String verdict; // 'PENDING', 'PASS', 'FAIL', 'NA'
  final List<TaskEvidence> evidenceList;
  final String? remarks;

  bool get hasEvidence => evidenceList.isNotEmpty;

  bool get meetsEvidenceRequirements =>
      !evidenceRequired || evidenceList.length >= minPhotos;

  ChecklistItem copyWith({
    String? id,
    String? itemNumber,
    String? title,
    String? guidanceText,
    bool? isRequired,
    bool? evidenceRequired,
    int? minPhotos,
    bool? isCompleted,
    String? verdict,
    List<TaskEvidence>? evidenceList,
    String? remarks,
  }) {
    return ChecklistItem(
      id: id ?? this.id,
      itemNumber: itemNumber ?? this.itemNumber,
      title: title ?? this.title,
      guidanceText: guidanceText ?? this.guidanceText,
      isRequired: isRequired ?? this.isRequired,
      evidenceRequired: evidenceRequired ?? this.evidenceRequired,
      minPhotos: minPhotos ?? this.minPhotos,
      isCompleted: isCompleted ?? this.isCompleted,
      verdict: verdict ?? this.verdict,
      evidenceList: evidenceList ?? this.evidenceList,
      remarks: remarks ?? this.remarks,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'itemNumber': itemNumber,
        'title': title,
        'guidanceText': guidanceText,
        'isRequired': isRequired,
        'evidenceRequired': evidenceRequired,
        'minPhotos': minPhotos,
        'isCompleted': isCompleted,
        'verdict': verdict,
        'evidenceList': evidenceList.map((e) => e.toJson()).toList(),
        'remarks': remarks,
      };

  factory ChecklistItem.fromJson(Map<String, dynamic> json) {
    final rawEvidence = json['evidenceList'] as List<dynamic>? ?? [];
    return ChecklistItem(
      id: json['id'] as String? ?? '',
      itemNumber: json['itemNumber'] as String? ?? '',
      title: json['title'] as String? ?? '',
      guidanceText: json['guidanceText'] as String?,
      isRequired: json['isRequired'] as bool? ?? true,
      evidenceRequired: json['evidenceRequired'] as bool? ?? true,
      minPhotos: (json['minPhotos'] as num?)?.toInt() ?? 1,
      isCompleted: json['isCompleted'] as bool? ?? false,
      verdict: json['verdict'] as String? ?? 'PENDING',
      evidenceList: rawEvidence
          .map((e) => TaskEvidence.fromJson(e as Map<String, dynamic>))
          .toList(),
      remarks: json['remarks'] as String?,
    );
  }
}
