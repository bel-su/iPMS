import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../domain/models/checklist_item.dart';
import '../../domain/models/task_evidence.dart';
import '../../domain/models/task_item.dart';
import '../../providers/evidence_provider.dart';
import 'photo_preview_modal.dart';

/// Modal bottom sheet allowing field engineers to browse and assign
/// recently captured camera photos from the active inspection session.
///
/// NOTE: Strictly queries in-app session photos. Never opens device external gallery.
class SessionPhotoBrowserModal extends ConsumerStatefulWidget {
  const SessionPhotoBrowserModal({
    super.key,
    required this.task,
    required this.item,
    required this.onPhotosAttached,
    this.onCaptureNewRequested,
  });

  final TaskItem task;
  final ChecklistItem item;
  final ValueChanged<List<TaskEvidence>> onPhotosAttached;
  final VoidCallback? onCaptureNewRequested;

  @override
  ConsumerState<SessionPhotoBrowserModal> createState() =>
      _SessionPhotoBrowserModalState();
}

class _SessionPhotoBrowserModalState
    extends ConsumerState<SessionPhotoBrowserModal> {
  final Set<String> _selectedEvidenceIds = {};

  @override
  Widget build(BuildContext context) {
    // Watch all session evidence for this task
    final allEvidence = ref.watch(taskEvidenceListProvider(widget.task.id));

    // Current item's already attached evidence
    final alreadyAttachedIds = allEvidence
        .where((e) => e.checklistItemId == widget.item.id)
        .map((e) => e.id)
        .toSet();

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.85,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag Handle
          const SizedBox(height: 12),
          Container(
            width: 44,
            height: 4,
            decoration: BoxDecoration(
              color: AppColors.subtleDivider,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 16),

          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.darkSlate,
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              widget.item.itemNumber,
                              style: const TextStyle(
                                fontSize: 10,
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Browse Session Photos',
                              style: AppTypography.headingSmall.copyWith(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Select photos clicked in this session to attach to "${widget.item.title}"',
                        style: AppTypography.caption.copyWith(
                          color: AppColors.textSecondary,
                          fontSize: 11.5,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      // Compliance security pill
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 1.5),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.lock_outline, size: 10, color: Color(0xFF475569)),
                            SizedBox(width: 4),
                            Text(
                              'In-App Session Gallery Only · No External Device Files',
                              style: TextStyle(
                                fontSize: 9.5,
                                fontWeight: FontWeight.w600,
                                color: Color(0xFF475569),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const Divider(height: 1),

          // Content: Photo Grid or Empty State
          Expanded(
            child: allEvidence.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: AppColors.searchFieldBackground,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.camera_alt_outlined,
                              size: 36,
                              color: AppColors.darkSlate,
                            ),
                          ),
                          const SizedBox(height: 14),
                          const Text(
                            'No Recently Clicked Photos',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                              color: AppColors.darkSlate,
                            ),
                          ),
                          const SizedBox(height: 6),
                          const Text(
                            'Take site photos with the camera first, then select them here to bind directly to this checklist item.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 12,
                              color: AppColors.textSecondary,
                            ),
                          ),
                          const SizedBox(height: 16),
                          ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.darkSlate,
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8),
                              ),
                            ),
                            icon: const Icon(Icons.camera_alt, size: 16),
                            label: const Text('Click New Photo'),
                            onPressed: () {
                              Navigator.pop(context);
                              widget.onCaptureNewRequested?.call();
                            },
                          ),
                        ],
                      ),
                    ),
                  )
                : GridView.builder(
                    padding: const EdgeInsets.all(16),
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 3,
                      crossAxisSpacing: 10,
                      mainAxisSpacing: 10,
                      childAspectRatio: 0.8,
                    ),
                    itemCount: allEvidence.length,
                    itemBuilder: (context, index) {
                      final ev = allEvidence[index];
                      final isSelected = _selectedEvidenceIds.contains(ev.id);
                      final isAttachedToThis = alreadyAttachedIds.contains(ev.id);
                      final isAttachedToOther =
                          ev.checklistItemId != null &&
                          ev.checklistItemId!.isNotEmpty &&
                          ev.checklistItemId != widget.item.id;

                      return GestureDetector(
                        onTap: () {
                          setState(() {
                            if (isSelected) {
                              _selectedEvidenceIds.remove(ev.id);
                            } else {
                              _selectedEvidenceIds.add(ev.id);
                            }
                          });
                        },
                        child: Container(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: isSelected
                                  ? const Color(0xFF2E7D32)
                                  : isAttachedToThis
                                      ? const Color(0xFF3B82F6)
                                      : AppColors.subtleDivider,
                              width: isSelected ? 2.5 : 1.2,
                            ),
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                // Thumbnail Image
                                Image.file(
                                  File(ev.filePath),
                                  fit: BoxFit.cover,
                                  errorBuilder: (context, error, stackTrace) =>
                                      Container(
                                    color: AppColors.searchFieldBackground,
                                    child: const Icon(
                                      Icons.broken_image_outlined,
                                      size: 24,
                                      color: AppColors.textTertiary,
                                    ),
                                  ),
                                ),

                                // Top Bar: Selection Checkbox & Delete Trash Icon
                                Positioned(
                                  top: 4,
                                  left: 4,
                                  right: 4,
                                  child: Row(
                                    mainAxisAlignment:
                                        MainAxisAlignment.spaceBetween,
                                    children: [
                                      // Checkbox
                                      Container(
                                        width: 22,
                                        height: 22,
                                        decoration: BoxDecoration(
                                          shape: BoxShape.circle,
                                          color: isSelected
                                              ? const Color(0xFF2E7D32)
                                              : Colors.black.withValues(alpha: 0.45),
                                        ),
                                        child: Icon(
                                          isSelected
                                              ? Icons.check
                                              : Icons.circle_outlined,
                                          size: 14,
                                          color: Colors.white,
                                        ),
                                      ),

                                      // Delete Action (Allows removing blurry/bad photos after clicking)
                                      GestureDetector(
                                        onTap: () => _confirmDeletePhoto(ev),
                                        child: Container(
                                          width: 24,
                                          height: 24,
                                          decoration: BoxDecoration(
                                            color: Colors.black.withValues(alpha: 0.6),
                                            shape: BoxShape.circle,
                                          ),
                                          child: const Icon(
                                            Icons.delete_outline,
                                            size: 13,
                                            color: Colors.white,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),

                                // Bottom Overlay: Preview button & Status
                                Positioned(
                                  bottom: 0,
                                  left: 0,
                                  right: 0,
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 4, vertical: 3),
                                    color: Colors.black.withValues(alpha: 0.65),
                                    child: Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
                                      children: [
                                        // Tap to preview full
                                        GestureDetector(
                                          onTap: () {
                                            Navigator.push(
                                              context,
                                              MaterialPageRoute<void>(
                                                builder: (_) => PhotoPreviewModal(
                                                    evidence: ev),
                                              ),
                                            );
                                          },
                                          child: const Icon(
                                            Icons.zoom_in,
                                            size: 13,
                                            color: Colors.white,
                                          ),
                                        ),
                                        Text(
                                          isAttachedToThis
                                              ? 'Attached'
                                              : isAttachedToOther
                                                  ? (ev.checklistItemId ?? 'Other')
                                                  : 'Unassigned',
                                          style: TextStyle(
                                            fontSize: 8.5,
                                            fontWeight: FontWeight.bold,
                                            color: isAttachedToThis
                                                ? const Color(0xFF93C5FD)
                                                : isAttachedToOther
                                                    ? const Color(0xFFFDBA74)
                                                    : const Color(0xFF8CEFC6),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),

          // Bottom Action Bar
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(
                top: BorderSide(color: AppColors.subtleDivider),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.darkSlate,
                      side: const BorderSide(color: AppColors.darkSlate),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    icon: const Icon(Icons.camera_alt_outlined, size: 16),
                    label: const Text(
                      'Click New',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                    ),
                    onPressed: () {
                      Navigator.pop(context);
                      widget.onCaptureNewRequested?.call();
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _selectedEvidenceIds.isNotEmpty
                          ? const Color(0xFF2E7D32)
                          : AppColors.darkSlate,
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: AppColors.subtleDivider,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    onPressed: _selectedEvidenceIds.isEmpty
                        ? null
                        : () {
                            final selectedList = allEvidence
                                .where((e) => _selectedEvidenceIds.contains(e.id))
                                .toList();

                            // Assign selected photos to this item in provider
                            for (final ev in selectedList) {
                              ref
                                  .read(taskEvidenceProvider.notifier)
                                  .assignToItem(
                                    taskId: widget.task.id,
                                    evidenceId: ev.id,
                                    checklistItemId: widget.item.id,
                                    checklistItemTitle:
                                        '${widget.item.itemNumber} ${widget.item.title}',
                                  );
                            }

                            widget.onPhotosAttached(selectedList);
                            Navigator.pop(context);
                          },
                    child: Text(
                      _selectedEvidenceIds.isEmpty
                          ? 'Select Photos'
                          : 'Attach Selected (${_selectedEvidenceIds.length})',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _confirmDeletePhoto(TaskEvidence ev) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Delete Session Photo?'),
        content: const Text(
          'This will permanently remove this image from the in-app session gallery. It cannot be recovered.',
          style: TextStyle(fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFDC2626),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            onPressed: () {
              Navigator.pop(ctx);
              ref.read(taskEvidenceProvider.notifier).removeEvidence(
                    widget.task.id,
                    ev.id,
                  );
              setState(() {
                _selectedEvidenceIds.remove(ev.id);
              });
            },
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}
