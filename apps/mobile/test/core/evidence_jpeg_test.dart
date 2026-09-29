import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:mobile/core/services/watermark_service.dart';

void main() {
  test('encodes watermarked pixels as a JPEG the media service accepts', () {
    const width = 64, height = 48;
    final rgba = Uint8List(width * height * 4);
    for (var i = 0; i < rgba.length; i += 4) {
      rgba[i] = 200;
      rgba[i + 3] = 255;
    }

    final jpeg = encodeEvidenceJpeg((rgba: rgba, width: width, height: height));

    expect(jpeg.sublist(0, 3), [0xFF, 0xD8, 0xFF]); // JPEG magic bytes
    expect(jpeg.length, lessThan(maxEvidencePhotoBytes));
    final decoded = img.decodeJpg(jpeg)!;
    expect(decoded.width, width);
    expect(decoded.height, height);
  });
}
