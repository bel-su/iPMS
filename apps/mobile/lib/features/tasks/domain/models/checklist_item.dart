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
    this.maxPhotos,
    this.allowsNa = true,
    this.responseType = 'RESULT_ONLY',
    this.severity,
    this.sectionTitle,
  });

  /// One item of a published template version, as `/qc/tasks/:id/checklist`
  /// returns it. A template's `minPhotos` of 0 means photos are optional.
  factory ChecklistItem.fromTemplate(Map<String, dynamic> json, {String? sectionTitle}) {
    final minPhotos = (json['minPhotos'] as num?)?.toInt() ?? 0;
    return ChecklistItem(
      id: json['id'] as String? ?? '',
      itemNumber: json['number'] as String? ?? '',
      title: json['requirementText'] as String? ?? '',
      guidanceText: json['guidanceText'] as String?,
      isRequired: json['isRequired'] as bool? ?? true,
      evidenceRequired: minPhotos > 0,
      minPhotos: minPhotos,
      maxPhotos: (json['maxPhotos'] as num?)?.toInt() ?? 0,
      allowsNa: json['allowsNa'] as bool? ?? false,
      responseType: json['responseType'] as String? ?? 'RESULT_ONLY',
      severity: json['severity'] as String?,
      sectionTitle: sectionTitle,
    );
  }

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

  /// Most photos the server accepts for this item; null means no limit known
  /// (demo checklists). Zero means the item takes no photos.
  final int? maxPhotos;
  final bool allowsNa;
  final String responseType;
  final String? severity;
  final String? sectionTitle;

  bool get acceptsPhotos => maxPhotos == null || maxPhotos! > 0;

  bool get hasEvidence => evidenceList.isNotEmpty;

  bool get meetsEvidenceRequirements =>
      verdict == 'NA' || !evidenceRequired || evidenceList.length >= minPhotos;

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
      maxPhotos: maxPhotos,
      allowsNa: allowsNa,
      responseType: responseType,
      severity: severity,
      sectionTitle: sectionTitle,
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

/// The checklist a work order is filled in against: the current published
/// version of its template. [versionId] is what a submission must quote.
class TaskChecklist {
  const TaskChecklist({
    required this.workOrderId,
    required this.projectId,
    required this.siteId,
    required this.templateName,
    required this.versionId,
    required this.versionNumber,
    required this.items,
  });

  final String workOrderId;
  final String projectId;
  final String siteId;
  final String templateName;
  final String versionId;
  final int versionNumber;
  final List<ChecklistItem> items;

  factory TaskChecklist.fromJson(Map<String, dynamic> json) {
    final task = json['task'] as Map<String, dynamic>? ?? const {};
    final template = json['template'] as Map<String, dynamic>? ?? const {};
    final version = json['version'] as Map<String, dynamic>? ?? const {};
    int byOrder(dynamic a, dynamic b) =>
        ((a as Map)['order'] as num? ?? 0).compareTo((b as Map)['order'] as num? ?? 0);
    final sections = List<dynamic>.from(version['sections'] as List<dynamic>? ?? const [])
      ..sort(byOrder);
    final items = <ChecklistItem>[];
    for (final raw in sections) {
      final section = raw as Map<String, dynamic>;
      final sectionItems = List<dynamic>.from(section['items'] as List<dynamic>? ?? const [])
        ..sort(byOrder);
      final sectionTitle = '${section['number'] ?? ''} ${section['title'] ?? ''}'.trim();
      for (final item in sectionItems) {
        items.add(ChecklistItem.fromTemplate(item as Map<String, dynamic>, sectionTitle: sectionTitle));
      }
    }
    return TaskChecklist(
      workOrderId: task['id'] as String? ?? '',
      projectId: task['projectId'] as String? ?? '',
      siteId: task['siteId'] as String? ?? '',
      templateName: template['name'] as String? ?? '',
      versionId: version['id'] as String? ?? '',
      versionNumber: (version['version'] as num?)?.toInt() ?? 0,
      items: items,
    );
  }
}

/// What the QC reviewer said about the latest submission: the overall
/// comment and, per checklist item, the result and note.
/// What the engineer answered on one item of a submission.
class SubmittedAnswer {
  const SubmittedAnswer({required this.result, this.remark});

  /// PASS, FAIL or NA.
  final String result;
  final String? remark;

  bool get isNa => result == 'NA';
}

class ReviewFeedback {
  const ReviewFeedback({
    this.decision,
    this.comment,
    this.items = const {},
    this.answers = const {},
    this.submittedAt,
  });

  factory ReviewFeedback.fromSubmission(Map<String, dynamic> json) {
    final decisions = List<Map<String, dynamic>>.from(
        (json['decisions'] as List<dynamic>? ?? const []).whereType<Map<String, dynamic>>())
      ..sort((a, b) => (a['decidedAt']?.toString() ?? '').compareTo(b['decidedAt']?.toString() ?? ''));
    final latest = decisions.isEmpty ? null : decisions.last;
    return ReviewFeedback(
      submittedAt: DateTime.tryParse(json['submittedAt']?.toString() ?? ''),
      decision: latest?['decision'] as String?,
      comment: latest?['comment'] as String?,
      answers: {
        for (final r in (json['responses'] as List<dynamic>? ?? const []).whereType<Map<String, dynamic>>())
          if (r['itemId'] != null)
            r['itemId'] as String: SubmittedAnswer(
              result: r['selfCheckResult'] as String? ?? 'PASS',
              remark: r['selfCheckDescription'] as String?,
            ),
      },
      items: {
        for (final r in (json['responses'] as List<dynamic>? ?? const []).whereType<Map<String, dynamic>>())
          if (r['itemId'] != null)
            r['itemId'] as String: ItemReview(
              result: r['reviewResult'] as String? ?? 'PENDING',
              note: r['reviewDescription'] as String?,
            ),
      },
    );
  }

  final DateTime? submittedAt;
  final String? decision;
  final String? comment;
  final Map<String, ItemReview> items;

  /// The engineer's own answers in the submission, by item id.
  final Map<String, SubmittedAnswer> answers;

  int get rejectedCount => items.values.where((r) => r.isRejected).length;
}

class ItemReview {
  const ItemReview({required this.result, this.note});

  /// APPROVED, REJECTED, NA or PENDING.
  final String result;
  final String? note;

  bool get isRejected => result == 'REJECTED';
}
