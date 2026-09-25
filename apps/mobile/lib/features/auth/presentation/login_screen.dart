import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../providers/auth_provider.dart';
import '../providers/biometric_provider.dart';
import 'widgets/biometric_enrollment_sheet.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  bool _showPasswordForm = false;

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_formKey.currentState?.validate() ?? false) {
      final username = _usernameController.text.trim();
      await ref.read(authStateProvider.notifier).login(
            username,
            _passwordController.text,
          );

      // Check if login succeeded
      final authUser = ref.read(authStateProvider).value;
      if (authUser != null && mounted) {
        final biometricState = ref.read(biometricAuthStateProvider);
        if (biometricState.isHardwareSupported && !biometricState.isConfigured) {
          await BiometricEnrollmentSheet.show(context, username);
        }
      }
    }
  }

  Future<void> _loginWithBiometrics() async {
    final success = await ref
        .read(biometricAuthStateProvider.notifier)
        .authenticateAndLogin();

    if (!success && mounted) {
      // If biometric failed or was cancelled, reveal password form for immediate fallback
      setState(() => _showPasswordForm = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authStateProvider);
    final biometricState = ref.watch(biometricAuthStateProvider);
    final isLoading = authState.isLoading || biometricState.isAuthenticating;

    final hasEnrolledBiometric =
        biometricState.isConfigured && biometricState.enrolledUsername != null;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Brand Header with Enhanced App Icon
                  Center(
                    child: Container(
                      width: 80,
                      height: 80,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(22),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.08),
                            blurRadius: 18,
                            offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(22),
                        child: Image.asset(
                          'assets/icons/app_icon.png',
                          width: 80,
                          height: 80,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => Container(
                            color: AppColors.primaryLavender,
                            child: const Icon(
                              Icons.engineering_outlined,
                              size: 40,
                              color: AppColors.darkSlate,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'iPMS Field App',
                    textAlign: TextAlign.center,
                    style: AppTypography.headingLarge,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Sign in to access your assigned tasks and sites',
                    textAlign: TextAlign.center,
                    style: AppTypography.bodyMedium,
                  ),
                  const SizedBox(height: 32),

                  // Quick Biometric Sign In Card (If Enrolled)
                  if (hasEnrolledBiometric && !_showPasswordForm) ...[
                    Card(
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(20),
                        side: const BorderSide(color: Color(0xFFDDD7F7), width: 1.5),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          children: [
                            Container(
                              width: 64,
                              height: 64,
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
                                size: 36,
                                color: AppColors.darkSlate,
                              ),
                            ),
                            const SizedBox(height: 14),
                            Text(
                              'Fingerprint Unlock',
                              style: AppTypography.titleLarge,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Enrolled for @${biometricState.enrolledUsername}',
                              style: AppTypography.caption.copyWith(
                                color: AppColors.textSecondary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 20),

                            SizedBox(
                              width: double.infinity,
                              height: 50,
                              child: ElevatedButton.icon(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: AppColors.darkSlate,
                                  foregroundColor: Colors.white,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(14),
                                  ),
                                ),
                                icon: biometricState.isAuthenticating
                                    ? const SizedBox(
                                        width: 18,
                                        height: 18,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: Colors.white,
                                        ),
                                      )
                                    : const Icon(Icons.fingerprint_rounded, size: 22),
                                label: Text(
                                  biometricState.isAuthenticating
                                      ? 'Scanning Fingerprint...'
                                      : 'Sign in with Fingerprint',
                                  style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                onPressed: isLoading ? null : _loginWithBiometrics,
                              ),
                            ),
                            const SizedBox(height: 12),

                            if (biometricState.statusMessage != null) ...[
                              Text(
                                biometricState.statusMessage!,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppColors.statusBlockedText,
                                ),
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: 8),
                            ],

                            TextButton.icon(
                              icon: const Icon(Icons.lock_outline, size: 16),
                              label: const Text('Sign in with Password instead'),
                              onPressed: () => setState(() => _showPasswordForm = true),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ] else ...[
                    // Standard Credentials Card
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            if (authState.hasError) ...[
                              Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: AppColors.statusBlockedBg,
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: const Row(
                                  children: [
                                    Icon(
                                      Icons.error_outline,
                                      size: 18,
                                      color: AppColors.statusBlockedText,
                                    ),
                                    SizedBox(width: 10),
                                    Expanded(
                                      child: Text(
                                        'Invalid username or password. Please verify your credentials.',
                                        style: TextStyle(
                                          color: AppColors.statusBlockedText,
                                          fontSize: 12,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 16),
                            ],

                            // Username Field
                            Text(
                              'Username',
                              style: AppTypography.titleMedium,
                            ),
                            const SizedBox(height: 8),
                            TextFormField(
                              controller: _usernameController,
                              decoration: const InputDecoration(
                                hintText: 'Enter your username',
                                prefixIcon: Icon(Icons.person_outline, size: 20),
                              ),
                              validator: (val) {
                                if (val == null || val.trim().isEmpty) {
                                  return 'Please enter your username';
                                }
                                return null;
                              },
                            ),
                            const SizedBox(height: 20),

                            // Password Field
                            Text(
                              'Password',
                              style: AppTypography.titleMedium,
                            ),
                            const SizedBox(height: 8),
                            TextFormField(
                              controller: _passwordController,
                              obscureText: _obscurePassword,
                              decoration: InputDecoration(
                                hintText: 'Enter your password',
                                prefixIcon: const Icon(Icons.lock_outline, size: 20),
                                suffixIcon: IconButton(
                                  icon: Icon(
                                    _obscurePassword
                                        ? Icons.visibility_outlined
                                        : Icons.visibility_off_outlined,
                                    size: 20,
                                  ),
                                  onPressed: () {
                                    setState(
                                        () => _obscurePassword = !_obscurePassword);
                                  },
                                ),
                              ),
                              validator: (val) {
                                if (val == null || val.isEmpty) {
                                  return 'Please enter your password';
                                }
                                return null;
                              },
                            ),
                            const SizedBox(height: 24),

                            // Submit Button
                            SizedBox(
                              height: 52,
                              child: ElevatedButton(
                                onPressed: isLoading ? null : _submit,
                                child: isLoading
                                    ? const SizedBox(
                                        width: 22,
                                        height: 22,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2.5,
                                          color: Colors.white,
                                        ),
                                      )
                                    : const Text('Sign In'),
                              ),
                            ),

                            // Back to Fingerprint Login (If Enrolled)
                            if (hasEnrolledBiometric) ...[
                              const SizedBox(height: 12),
                              TextButton.icon(
                                icon: const Icon(Icons.fingerprint_rounded, size: 18),
                                label: const Text('Unlock with Fingerprint'),
                                onPressed: () =>
                                    setState(() => _showPasswordForm = false),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
