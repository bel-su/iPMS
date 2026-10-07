import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../domain/finance_models.dart';

/// Status as a coloured pill.
class FinanceStatusChip extends StatelessWidget {
  const FinanceStatusChip({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (Color bg, Color fg) = switch (status) {
      'PAID' || 'SETTLED' => (AppColors.statusCompletedBg, AppColors.statusCompletedText),
      'RETURNED' || 'REJECTED' => (AppColors.statusBlockedBg, AppColors.statusBlockedText),
      'PENDING_PM' || 'PENDING_DIRECTOR' => (AppColors.statusReviewingBg, AppColors.statusReviewingText),
      'PENDING_FINANCE' => (AppColors.statusOngoingBg, AppColors.statusOngoingText),
      _ => (AppColors.statusCancelledBg, AppColors.statusCancelledText),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Text(
        RequestStatus.label(status),
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: fg),
      ),
    );
  }
}

/// A label and a value on one line.
class FinanceInfoRow extends StatelessWidget {
  const FinanceInfoRow(this.label, this.value, {super.key, this.bold = false});

  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
          const SizedBox(width: 16),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: TextStyle(
                fontSize: 13,
                fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
                color: AppColors.darkSlate,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
