import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/storage/na_store.dart';

void main() {
  test('N/A marks survive a new store instance, per account and work order', () async {
    final dir = await Directory.systemTemp.createTemp('na_store');
    addTearDown(() => dir.delete(recursive: true));
    Future<Directory> where() async => dir;

    await NaStore(directory: where).save('u-1', 'w-1', {'i-1', 'i-2'});
    await NaStore(directory: where).save('u-1', 'w-2', {'i-9'});

    final reopened = NaStore(directory: where);
    expect(await reopened.load('u-1', 'w-1'), {'i-1', 'i-2'});
    expect(await reopened.load('u-1', 'w-2'), {'i-9'});
    expect(await reopened.load('u-2', 'w-1'), isEmpty);

    await reopened.save('u-1', 'w-1', {});
    expect(await reopened.load('u-1', 'w-1'), isEmpty);
    expect(await reopened.load('u-1', 'w-2'), {'i-9'});
  });
}
