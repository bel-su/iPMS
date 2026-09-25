import 'dart:io';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_typography.dart';
import '../../domain/models/task_evidence.dart';

class PhotoPreviewModal extends StatelessWidget {
  const PhotoPreviewModal({
    super.key,
    required this.evidence,
  });

  final TaskEvidence evidence;

  @override
  Widget build(BuildContext context) {
    final timeStr = DateFormat('yyyy-MM-dd HH:mm:ss').format(evidence.capturedAt);
    final latStr = evidence.latitude.toStringAsFixed(6);
    final longStr = evidence.longitude.toStringAsFixed(6);

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black.withValues(alpha: 0.7),
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.close_rounded, color: Colors.white, size: 24),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'Evidence: ${evidence.siteCode}',
          style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600),
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 16),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: evidence.isSubmitted
                  ? const Color(0xFF1B5E20)
                  : const Color(0xFF263238),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.white.withValues(alpha: 0.2)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  evidence.isSubmitted ? Icons.check_circle_outline : Icons.pending_outlined,
                  size: 14,
                  color: Colors.white,
                ),
                const SizedBox(width: 6),
                Text(
                  evidence.isSubmitted ? 'SUBMITTED' : 'READY TO SUBMIT',
                  style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                ),
              ],
            ),
          ),
        ],
      ),
      body: Stack(
        children: [
          // Pinch to Zoom Image Viewer
          Center(
            child: InteractiveViewer(
              minScale: 0.8,
              maxScale: 4.5,
              child: Image.file(
                File(evidence.filePath),
                fit: BoxFit.contain,
                errorBuilder: (context, error, stackTrace) => const Center(
                  child: Text(
                    'Unable to load evidence image',
                    style: TextStyle(color: Colors.white70),
                  ),
                ),
              ),
            ),
          ),

          // Bottom Metadata Drawer
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    Colors.black.withValues(alpha: 0.85),
                    Colors.black,
                  ],
                ),
              ),
              child: SafeArea(
                top: false,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.verified_outlined, size: 16, color: Color(0xFFDDD7F7)),
                        const SizedBox(width: 8),
                        Text(
                          'iPMS VERIFIED FIELD EVIDENCE',
                          style: AppTypography.caption.copyWith(
                            color: const Color(0xFFDDD7F7),
                            fontWeight: FontWeight.bold,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Site: [${evidence.siteCode}] ${evidence.siteName}',
                      style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'GPS: $latStr N, $longStr E (+/-${evidence.accuracy.toStringAsFixed(1)}m)',
                      style: const TextStyle(color: Color(0xFF8CEFC6), fontSize: 13),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Captured: $timeStr • By: ${evidence.capturedBy}',
                      style: const TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
