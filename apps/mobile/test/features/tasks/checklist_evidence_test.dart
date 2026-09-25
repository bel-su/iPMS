import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/services/watermark_service.dart';
import 'package:mobile/features/tasks/domain/models/checklist_item.dart';
import 'package:mobile/features/tasks/domain/models/task_evidence.dart';
import 'package:mobile/features/tasks/providers/evidence_provider.dart';

void main() {
  group('ChecklistItem Domain Model', () {
    test('instantiates with defaults and evaluates meetsEvidenceRequirements correctly', () {
      final item = ChecklistItem(
        id: 'item-101',
        itemNumber: 'CIV.01',
        title: 'Pre-work structural survey & boundary clearance',
        guidanceText: 'Verify 360-degree boundary clearance.',
        evidenceRequired: true,
        minPhotos: 1,
      );

      expect(item.id, 'item-101');
      expect(item.itemNumber, 'CIV.01');
      expect(item.hasEvidence, isFalse);
      expect(item.meetsEvidenceRequirements, isFalse);
      expect(item.isCompleted, isFalse);

      final dummyEvidence = TaskEvidence(
        id: 'ev-1',
        taskId: 'task-1',
        filePath: '/storage/ev-1.jpg',
        capturedAt: DateTime(2026, 9, 25, 14, 30),
        latitude: 27.7172,
        longitude: 85.3240,
        accuracy: 3.5,
        siteCode: 'KOS121',
        siteName: 'Kathmandu Central Tower',
        projectCode: 'PRJ-5G-METRO',
        capturedBy: 'Alex Morgan',
        checklistItemId: 'item-101',
        checklistItemTitle: 'CIV.01 Pre-work structural survey & boundary clearance',
      );

      final itemWithEvidence = item.copyWith(
        isCompleted: true,
        verdict: 'PASS',
        evidenceList: [dummyEvidence],
      );

      expect(itemWithEvidence.hasEvidence, isTrue);
      expect(itemWithEvidence.meetsEvidenceRequirements, isTrue);
      expect(itemWithEvidence.isCompleted, isTrue);
      expect(itemWithEvidence.verdict, 'PASS');
      expect(itemWithEvidence.evidenceList.first.checklistItemId, 'item-101');
    });

    test('serializes to JSON and deserializes accurately', () {
      final originalItem = ChecklistItem(
        id: 'item-202',
        itemNumber: 'RF.02',
        title: 'Massive MIMO / Sector bracket torque alignment',
        guidanceText: 'Tighten mechanical brackets to manufacturer torque specs.',
        isRequired: true,
        evidenceRequired: true,
        minPhotos: 2,
        isCompleted: true,
        verdict: 'PASS',
        remarks: 'Calibrated to 45 Nm torque.',
      );

      final json = originalItem.toJson();
      final parsedItem = ChecklistItem.fromJson(json);

      expect(parsedItem.id, originalItem.id);
      expect(parsedItem.itemNumber, originalItem.itemNumber);
      expect(parsedItem.title, originalItem.title);
      expect(parsedItem.guidanceText, originalItem.guidanceText);
      expect(parsedItem.evidenceRequired, isTrue);
      expect(parsedItem.minPhotos, 2);
      expect(parsedItem.isCompleted, isTrue);
      expect(parsedItem.verdict, 'PASS');
      expect(parsedItem.remarks, 'Calibrated to 45 Nm torque.');
    });
  });

  group('TaskEvidence Checklist Binding', () {
    test('preserves checklistItemId and checklistItemTitle through copyWith and JSON', () {
      final evidence = TaskEvidence(
        id: 'ev-test-1',
        taskId: 'task-99',
        filePath: '/data/user/0/com.bel_su.ipms/ev_test.jpg',
        capturedAt: DateTime(2026, 9, 25, 12, 0),
        latitude: 27.7123,
        longitude: 85.3123,
        accuracy: 2.1,
        siteCode: 'POK004',
        siteName: 'Pokhara Lakeside Hub',
        projectCode: 'PRJ-FTTH-EXP',
        capturedBy: 'Suman Shrestha',
        checklistItemId: 'item-fbr-01',
        checklistItemTitle: 'FBR.01 Precision optical fiber cleave',
      );

      expect(evidence.checklistItemId, 'item-fbr-01');
      expect(evidence.checklistItemTitle, 'FBR.01 Precision optical fiber cleave');

      final copied = evidence.copyWith(isSubmitted: true);
      expect(copied.isSubmitted, isTrue);
      expect(copied.checklistItemId, 'item-fbr-01');
      expect(copied.checklistItemTitle, 'FBR.01 Precision optical fiber cleave');

      final json = copied.toJson();
      final fromJson = TaskEvidence.fromJson(json);
      expect(fromJson.id, 'ev-test-1');
      expect(fromJson.checklistItemId, 'item-fbr-01');
      expect(fromJson.checklistItemTitle, 'FBR.01 Precision optical fiber cleave');
    });

    test('WatermarkMetadata captures checklist item metadata', () {
      final meta = WatermarkMetadata(
        siteCode: 'KOS121',
        siteName: 'Kathmandu Central Tower',
        projectCode: 'PRJ-5G-METRO',
        latitude: 27.7172,
        longitude: 85.3240,
        accuracy: 4.2,
        timestamp: DateTime(2026, 9, 25, 15, 0),
        username: 'field_tech',
        fullName: 'Field Engineer',
        taskTitle: '5G Antenna Installation',
        checklistItemId: 'item-rf-03',
        checklistItemTitle: 'RF.03 Azimuth & electrical down-tilt calibration',
      );

      expect(meta.checklistItemId, 'item-rf-03');
      expect(meta.checklistItemTitle, 'RF.03 Azimuth & electrical down-tilt calibration');
      expect(meta.siteCode, 'KOS121');
    });
  });

  group('Riverpod Evidence Providers with Checklist Item Filtering', () {
    test('adds evidence and filters accurately by (taskId, checklistItemId)', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final ev1 = TaskEvidence(
        id: 'ev-1',
        taskId: 'task-100',
        filePath: '/tmp/photo1.jpg',
        capturedAt: DateTime.now(),
        latitude: 27.7,
        longitude: 85.3,
        accuracy: 3.0,
        siteCode: 'KOS121',
        siteName: 'Site 1',
        projectCode: 'PRJ-1',
        capturedBy: 'Tech 1',
        checklistItemId: 'item-A',
        checklistItemTitle: 'Item A',
      );

      final ev2 = TaskEvidence(
        id: 'ev-2',
        taskId: 'task-100',
        filePath: '/tmp/photo2.jpg',
        capturedAt: DateTime.now(),
        latitude: 27.7,
        longitude: 85.3,
        accuracy: 3.0,
        siteCode: 'KOS121',
        siteName: 'Site 1',
        projectCode: 'PRJ-1',
        capturedBy: 'Tech 1',
        checklistItemId: 'item-B',
        checklistItemTitle: 'Item B',
      );

      final ev3 = TaskEvidence(
        id: 'ev-3',
        taskId: 'task-100',
        filePath: '/tmp/photo3.jpg',
        capturedAt: DateTime.now(),
        latitude: 27.7,
        longitude: 85.3,
        accuracy: 3.0,
        siteCode: 'KOS121',
        siteName: 'Site 1',
        projectCode: 'PRJ-1',
        capturedBy: 'Tech 1',
        checklistItemId: 'item-A',
        checklistItemTitle: 'Item A',
      );

      // Add evidence to notifier
      container.read(taskEvidenceProvider.notifier).addEvidence(ev1);
      container.read(taskEvidenceProvider.notifier).addEvidence(ev2);
      container.read(taskEvidenceProvider.notifier).addEvidence(ev3);

      // Verify all evidence for task-100
      final allTaskEvidence = container.read(taskEvidenceListProvider('task-100'));
      expect(allTaskEvidence.length, 3);

      // Verify item-A has 2 photos
      final itemAEvidence = container.read(
        checklistItemEvidenceProvider((taskId: 'task-100', itemId: 'item-A')),
      );
      expect(itemAEvidence.length, 2);
      expect(itemAEvidence.map((e) => e.id), containsAll(['ev-1', 'ev-3']));

      // Verify item-B has 1 photo
      final itemBEvidence = container.read(
        checklistItemEvidenceProvider((taskId: 'task-100', itemId: 'item-B')),
      );
      expect(itemBEvidence.length, 1);
      expect(itemBEvidence.first.id, 'ev-2');

      // Verify item-C has 0 photos
      final itemCEvidence = container.read(
        checklistItemEvidenceProvider((taskId: 'task-100', itemId: 'item-C')),
      );
      expect(itemCEvidence.isEmpty, isTrue);

      // Submit evidence to QC
      container.read(taskEvidenceProvider.notifier).submitEvidence('task-100');
      final submittedList = container.read(taskEvidenceListProvider('task-100'));
      expect(submittedList.every((e) => e.isSubmitted), isTrue);

      // Remove an evidence item
      container.read(taskEvidenceProvider.notifier).removeEvidence('task-100', 'ev-2');
      final remainingList = container.read(taskEvidenceListProvider('task-100'));
      expect(remainingList.length, 2);
      expect(remainingList.any((e) => e.id == 'ev-2'), isFalse);
    });
  });
}
