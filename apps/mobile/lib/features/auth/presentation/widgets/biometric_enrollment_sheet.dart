import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../providers/biometric_provider.dart';

class BiometricEnrollmentSheet extends ConsumerStatefulWidget {
  const BiometricEnrollmentSheet({
    super.key,
    required this.username,
  });

  final String username;

  static Future<bool?> show(BuildContext context, String username) {
    return showModalBottomSheet<bool>(
      context: context,
      isDismissible: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => BiometricEnrollmentSheet(username: username),
    );
  }

  @override
  ConsumerState<BiometricEnrollmentSheet> createState() =>
      _BiometricEnrollmentSheetState();
}

class _BiometricEnrollmentSheetState
    extends ConsumerState<BiometricEnrollmentSheet> {
  bool _isProcessing = false;
  String? _error;

  Future<void> _handleEnroll() async {
    setState(() {
      _isProcessing = true;
      _error = null;
    });

    final success = await ref
        .read(biometricAuthStateProvider.notifier)
        .enrollBiometric(widget.username);

    if (mounted) {
      if (success) {
        Navigator.pop(context, true);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: const Color(0xFF1B5E20),
            behavior: SnackBarBehavior.floating,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            content: const Row(
              children: [
                Icon(Icons.check_circle_outline, color: Colors.white, size: 18),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Fingerprint login enabled for this device.',
                    style: TextStyle(fontSize: 12, color: Colors.white),
                  ),
                ),
              ],
            ),
          ),
        );
      } else {
        setState(() {
          _isProcessing = false;
          _error = 'Biometric scan was cancelled or not recognized. Try again.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            // Handle bar
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.subtleDivider,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 24),

            // Fingerprint Icon Container
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: AppColors.primaryLavenderLight,
                shape: BoxShape.circle,
                border: Border.all(
                  color: AppColors.primaryLavender,
                  width: 2,
                ),
              ),
              child: const Icon(
                Icons.fingerprint_rounded,
                size: 40,
                color: AppColors.darkSlate,
              ),
            ),
            const SizedBox(height: 16),

            Text(
              'Enable Fingerprint Sign In?',
              style: AppTypography.headingMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),

            Text(
              'Sign in instantly next time with your fingerprint sensor. Your tokens remain securely stored inside your device hardware enclave.',
              style: AppTypography.bodySmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),

            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.searchFieldBackground,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: AppColors.subtleDivider),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.person_outline,
                      size: 14, color: AppColors.darkSlate),
                  const SizedBox(width: 6),
                  Text(
                    'Enrolling for @${widget.username}',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: AppColors.darkSlate,
                    ),
                  ),
                ],
              ),
            ),

            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.statusBlockedText,
                  fontWeight: FontWeight.w500,
                ),
                textAlign: TextAlign.center,
              ),
            ],

            const SizedBox(height: 24),

            // Action Buttons
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.darkSlate,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                icon: _isProcessing
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.fingerprint_rounded, size: 20),
                label: Text(
                  _isProcessing ? 'Verifying Sensor...' : 'Enable Fingerprint',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                onPressed: _isProcessing ? null : _handleEnroll,
              ),
            ),
            const SizedBox(height: 10),

            SizedBox(
              width: double.infinity,
              child: TextButton(
                onPressed: _isProcessing ? null : () => Navigator.pop(context, false),
                child: const Text(
                  'Maybe Later',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 13,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
