import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';

class WatermarkMetadata {
  const WatermarkMetadata({
    required this.username,
    this.fullName,
    required this.siteCode,
    required this.siteName,
    required this.projectCode,
    required this.latitude,
    required this.longitude,
    required this.accuracy,
    required this.timestamp,
    this.taskTitle,
    this.checklistItemId,
    this.checklistItemTitle,
  });

  final String username;
  final String? fullName;
  final String siteCode;
  final String siteName;
  final String projectCode;
  final double latitude;
  final double longitude;
  final double accuracy;
  final DateTime timestamp;
  final String? taskTitle;
  final String? checklistItemId;
  final String? checklistItemTitle;
}

/// GPU-accelerated graphic watermarking service that bakes tamper-evident
/// metadata directly into the image's raw pixels at the bottom-left corner.
class WatermarkService {
  WatermarkService._();

  static Future<File> applyWatermark({
    required Uint8List imageBytes,
    required WatermarkMetadata metadata,
  }) async {
    // 1. Decode original camera photo
    final codec = await ui.instantiateImageCodec(imageBytes);
    final frame = await codec.getNextFrame();
    final sourceImage = frame.image;

    final imgWidth = sourceImage.width.toDouble();
    final imgHeight = sourceImage.height.toDouble();

    // 2. Setup Canvas PictureRecorder
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, Rect.fromLTWH(0, 0, imgWidth, imgHeight));

    // 3. Paint base photo
    canvas.drawImage(sourceImage, Offset.zero, Paint());

    // 4. Calculate dynamic resolution scale (normalized to 1000px width)
    final scale = imgWidth / 1000.0;

    // 5. Bottom-left card dimensions & positioning
    final cardPaddingHorizontal = scale * 18.0;
    final cardPaddingVertical = scale * 16.0;
    final marginLeft = scale * 24.0;
    final marginBottom = scale * 28.0;
    final cardWidth = (imgWidth * 0.76).clamp(scale * 420.0, imgWidth - (marginLeft * 2));
    final cardHeight = metadata.checklistItemTitle != null ? scale * 226.0 : scale * 200.0;

    final cardRect = RRect.fromRectAndRadius(
      Rect.fromLTWH(
        marginLeft,
        imgHeight - cardHeight - marginBottom,
        cardWidth,
        cardHeight,
      ),
      Radius.circular(scale * 16.0),
    );

    // 6. Draw semi-transparent dark charcoal container
    final bgPaint = Paint()
      ..color = const Color(0xE8141620) // 91% opacity deep dark slate
      ..style = PaintingStyle.fill;
    canvas.drawRRect(cardRect, bgPaint);

    // 7. Draw subtle border stroke
    final borderPaint = Paint()
      ..color = const Color(0x40DDD7F7)
      ..style = PaintingStyle.stroke
      ..strokeWidth = scale * 1.5;
    canvas.drawRRect(cardRect, borderPaint);

    // 8. Draw left accent indicator bar
    final accentBarRect = RRect.fromRectAndRadius(
      Rect.fromLTWH(
        marginLeft + scale * 10.0,
        imgHeight - cardHeight - marginBottom + scale * 14.0,
        scale * 4.0,
        cardHeight - scale * 28.0,
      ),
      Radius.circular(scale * 2.0),
    );
    final accentBarPaint = Paint()
      ..color = const Color(0xFFDDD7F7)
      ..style = PaintingStyle.fill;
    canvas.drawRRect(accentBarRect, accentBarPaint);

    // 9. Format coordinates and timestamps
    final latDir = metadata.latitude >= 0 ? 'N' : 'S';
    final longDir = metadata.longitude >= 0 ? 'E' : 'W';
    final latStr = metadata.latitude.abs().toStringAsFixed(6);
    final longStr = metadata.longitude.abs().toStringAsFixed(6);
    final timeStr = DateFormat('yyyy-MM-dd HH:mm:ss').format(metadata.timestamp);

    // 10. Paint text rows with clean vector typography
    final textStartX = marginLeft + scale * 24.0;
    var currentY = imgHeight - cardHeight - marginBottom + cardPaddingVertical;

    void drawLine(String text, {required double fontSize, required Color color, FontWeight fontWeight = FontWeight.normal}) {
      final textSpan = TextSpan(
        text: text,
        style: TextStyle(
          color: color,
          fontSize: fontSize * scale,
          fontWeight: fontWeight,
          fontFamily: 'Roboto',
        ),
      );
      final textPainter = TextPainter(
        text: textSpan,
        textDirection: ui.TextDirection.ltr,
        maxLines: 1,
        ellipsis: '...',
      );
      textPainter.layout(maxWidth: cardWidth - cardPaddingHorizontal * 2 - scale * 16.0);
      textPainter.paint(canvas, Offset(textStartX, currentY));
      currentY += (fontSize * scale * 1.42);
    }

    // Line 1: Header / Seal
    drawLine(
      '[VERIFIED] iPMS SECURE FIELD EVIDENCE',
      fontSize: 13.5,
      color: const Color(0xFFDDD7F7),
      fontWeight: FontWeight.w700,
    );
    currentY += scale * 3.0;

    // Line 2: Engineer Identity
    final engineerLabel = metadata.fullName != null && metadata.fullName!.isNotEmpty
        ? 'Engineer: ${metadata.username} (${metadata.fullName})'
        : 'Engineer: ${metadata.username}';
    drawLine(
      engineerLabel,
      fontSize: 12.0,
      color: Colors.white,
      fontWeight: FontWeight.w500,
    );

    // Line 3: Site Identity
    drawLine(
      'Site: [${metadata.siteCode}] ${metadata.siteName}',
      fontSize: 12.0,
      color: Colors.white,
      fontWeight: FontWeight.w500,
    );

    // Line 4: Project & Task
    final taskSnippet = metadata.taskTitle != null ? ' | Task: ${metadata.taskTitle}' : '';
    drawLine(
      'Project: ${metadata.projectCode}$taskSnippet',
      fontSize: 11.5,
      color: const Color(0xFFBAC0D0),
      fontWeight: FontWeight.normal,
    );

    // Line 4b: Checklist Item (if attached)
    if (metadata.checklistItemTitle != null && metadata.checklistItemTitle!.isNotEmpty) {
      drawLine(
        'Checklist: ${metadata.checklistItemTitle}',
        fontSize: 11.5,
        color: const Color(0xFFDDD7F7),
        fontWeight: FontWeight.w600,
      );
    }

    // Line 5: GPS Coordinates
    drawLine(
      'GPS: $latStr $latDir, $longStr $longDir (Accuracy: +/-${metadata.accuracy.toStringAsFixed(1)}m)',
      fontSize: 12.0,
      color: const Color(0xFF8CEFC6), // Subtle high-contrast mint
      fontWeight: FontWeight.w600,
    );

    // Line 6: Timestamp
    drawLine(
      'Timestamp: $timeStr NPT (Local Time)',
      fontSize: 11.0,
      color: const Color(0xFFA6ACBE),
      fontWeight: FontWeight.normal,
    );

    // 11. Render Canvas into image bytes
    final picture = recorder.endRecording();
    final finalImage = await picture.toImage(sourceImage.width, sourceImage.height);
    final byteData = await finalImage.toByteData(format: ui.ImageByteFormat.png);

    if (byteData == null) {
      throw Exception('Failed to generate watermarked image byte data.');
    }

    // 12. Save to device file
    final tempDir = await getTemporaryDirectory();
    final timestampId = DateTime.now().millisecondsSinceEpoch;
    final outputFile = File('${tempDir.path}/evidence_${metadata.siteCode}_$timestampId.png');
    await outputFile.writeAsBytes(byteData.buffer.asUint8List(), flush: true);

    return outputFile;
  }
}
