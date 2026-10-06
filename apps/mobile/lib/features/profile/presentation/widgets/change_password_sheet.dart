import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../auth/providers/auth_provider.dart';

/// The rules the server holds a new password to (NewPasswordSchema). Checked
/// here as the user types so they see what is missing before sending.
class PasswordRule {
  const PasswordRule(this.label, this.test);

  final String label;
  final bool Function(String) test;

  static final List<PasswordRule> all = [
    PasswordRule('At least 8 characters', (p) => p.length >= 8),
    PasswordRule('An uppercase letter', (p) => RegExp('[A-Z]').hasMatch(p)),
    PasswordRule('A lowercase letter', (p) => RegExp('[a-z]').hasMatch(p)),
    PasswordRule('A digit', (p) => RegExp('[0-9]').hasMatch(p)),
    PasswordRule('A symbol', (p) => RegExp('[^A-Za-z0-9]').hasMatch(p)),
  ];
}

/// Bottom sheet for changing the signed-in user's own password. Pops with true
/// once it is changed, after which the caller signs the user out (the server
/// has ended every session).
class ChangePasswordSheet extends ConsumerStatefulWidget {
  const ChangePasswordSheet({super.key});

  @override
  ConsumerState<ChangePasswordSheet> createState() => _ChangePasswordSheetState();
}

class _ChangePasswordSheetState extends ConsumerState<ChangePasswordSheet> {
  final _current = TextEditingController();
  final _new = TextEditingController();
  final _confirm = TextEditingController();
  bool _showCurrent = false;
  bool _showNew = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _new.dispose();
    _confirm.dispose();
    super.dispose();
  }

  bool get _valid =>
      _current.text.isNotEmpty &&
      PasswordRule.all.every((r) => r.test(_new.text)) &&
      _new.text == _confirm.text &&
      _new.text != _current.text;

  Future<void> _submit() async {
    if (!_valid || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authRepositoryProvider).changePassword(
            currentPassword: _current.text,
            newPassword: _new.text,
          );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not change the password: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  InputDecoration _decoration(String label, bool visible, VoidCallback toggle) => InputDecoration(
        labelText: label,
        prefixIcon: const Icon(Icons.lock_outline_rounded),
        suffixIcon: IconButton(
          icon: Icon(visible ? Icons.visibility_off_outlined : Icons.visibility_outlined),
          onPressed: toggle,
        ),
      );

  @override
  Widget build(BuildContext context) {
    final mismatch = _confirm.text.isNotEmpty && _new.text != _confirm.text;
    final same = _new.text.isNotEmpty && _new.text == _current.text;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Change password', style: AppTypography.headingSmall),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, size: 20),
                    onPressed: _busy ? null : () => Navigator.pop(context),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _current,
                obscureText: !_showCurrent,
                autofillHints: const [AutofillHints.password],
                decoration: _decoration('Current password', _showCurrent, () => setState(() => _showCurrent = !_showCurrent)),
                onChanged: (_) => setState(() => _error = null),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _new,
                obscureText: !_showNew,
                autofillHints: const [AutofillHints.newPassword],
                decoration: _decoration('New password', _showNew, () => setState(() => _showNew = !_showNew)),
                onChanged: (_) => setState(() => _error = null),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 12,
                runSpacing: 2,
                children: [
                  for (final rule in PasswordRule.all)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          rule.test(_new.text) ? Icons.check_circle : Icons.circle_outlined,
                          size: 14,
                          color: rule.test(_new.text) ? const Color(0xFF2E7D32) : AppColors.textTertiary,
                        ),
                        const SizedBox(width: 4),
                        Text(rule.label, style: AppTypography.caption),
                      ],
                    ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _confirm,
                obscureText: !_showNew,
                decoration: InputDecoration(
                  labelText: 'Confirm new password',
                  prefixIcon: const Icon(Icons.lock_reset_rounded),
                  errorText: mismatch ? 'The passwords do not match' : (same ? 'Choose a password different from the current one' : null),
                ),
                onChanged: (_) => setState(() => _error = null),
                onSubmitted: (_) => _submit(),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.statusBlockedBg,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.statusBlockedText),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.darkSlate,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: _valid && !_busy ? _submit : null,
                  child: _busy
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Change password', style: TextStyle(fontWeight: FontWeight.w600)),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'You will be signed out on all devices and asked to sign in with the new password.',
                style: AppTypography.caption,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
