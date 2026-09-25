import 'dart:io';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../domain/models/task_evidence.dart';
import 'photo_preview_modal.dart';

class EvidenceGalleryCard extends StatelessWidget {
  const EvidenceGalleryCard({
    super.key,
    required this.evidence,
    this.onDelete,
  });

  final TaskEvidence evidence;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final timeStr = DateFormat('d MMM, HH:mm').format(evidence.capturedAt);

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.subtleDivider),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute<void>(
              builder: (_) => PhotoPreviewModal(evidence: evidence),
            ),
          );
        },
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Thumbnail Stack
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Image.file(
                    File(evidence.filePath),
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) => Container(
                      color: AppColors.searchFieldBackground,
                      child: const Center(
                        child: Icon(Icons.image_not_supported_outlined, color: AppColors.textSecondary),
                      ),
                    ),
                  ),

                  // Bottom Gradient on Thumbnail
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 48,
                    child: Container(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Colors.transparent,
                            Colors.black.withValues(alpha: 0.75),
                          ],
                        ),
                      ),
                    ),
                  ),

                  // Site Code Chip on Image
                  Positioned(
                    bottom: 6,
                    left: 8,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.location_on_outlined, size: 12, color: Colors.white),
                        const SizedBox(width: 4),
                        Text(
                          evidence.siteCode,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ),

                  // Watermark Indicator Tag
                  Positioned(
                    top: 8,
                    left: 8,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.7),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.verified_outlined, size: 10, color: Color(0xFFDDD7F7)),
                          SizedBox(width: 4),
                          Text(
                            'GPS WATERMARKED',
                            style: TextStyle(
                              color: Color(0xFFDDD7F7),
                              fontSize: 9,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                  if (onDelete != null && !evidence.isSubmitted)
                    Positioned(
                      top: 4,
                      right: 4,
                      child: InkWell(
                        onTap: onDelete,
                        child: Container(
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.6),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.delete_outline, size: 14, color: Colors.white),
                        ),
                      ),
                    ),
                ],
              ),
            ),

            // Card Bottom Info
            Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    timeStr,
                    style: AppTypography.caption.copyWith(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(
                        evidence.isSubmitted ? Icons.check_circle_outline : Icons.schedule_outlined,
                        size: 12,
                        color: evidence.isSubmitted ? const Color(0xFF2E7D32) : AppColors.textSecondary,
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          evidence.isSubmitted ? 'Submitted to QC' : 'Ready to submit',
                          style: TextStyle(
                            fontSize: 11,
                            color: evidence.isSubmitted ? const Color(0xFF2E7D32) : AppColors.textSecondary,
                            fontWeight: evidence.isSubmitted ? FontWeight.bold : FontWeight.normal,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
