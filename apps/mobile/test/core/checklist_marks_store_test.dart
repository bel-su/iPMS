import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/storage/checklist_marks_store.dart';

void main() {
  test('marks survive a new store instance, per account and work order', () async {
    final dir = await Directory.systemTemp.createTemp('marks_store');
    addTearDown(() => dir.delete(recursive: true));
    Future<Directory> where() async => dir;

    await ChecklistMarksStore(directory: where)
        .save('u-1', 'w-1', ChecklistMarks(na: {'i-1'}, remarks: {'i-2': 'ladder was short'}));
    await ChecklistMarksStore(directory: where).save('u-1', 'w-2', ChecklistMarks(na: {'i-9'}));

    final reopened = ChecklistMarksStore(directory: where);
    final one = await reopened.load('u-1', 'w-1');
    expect(one!.na, {'i-1'});
    expect(one.remarks, {'i-2': 'ladder was short'});
    expect((await reopened.load('u-1', 'w-2'))!.na, {'i-9'});
    expect(await reopened.load('u-2', 'w-1'), isNull);
  });

  test('an empty entry is remembered, forgetting removes it', () async {
    final dir = await Directory.systemTemp.createTemp('marks_store');
    addTearDown(() => dir.delete(recursive: true));
    final store = ChecklistMarksStore(directory: () async => dir);

    await store.save('u-1', 'w-1', ChecklistMarks());
    expect(await store.load('u-1', 'w-1'), isNotNull);

    await store.save('u-1', 'w-1', null);
    expect(await store.load('u-1', 'w-1'), isNull);
  });
}
