import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/config/env.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../auth/providers/auth_provider.dart';
import '../../auth/providers/biometric_provider.dart';
import '../../projects/providers/project_providers.dart';
import '../../tasks/providers/task_providers.dart';
import '../providers/profile_providers.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  void _showLogoutDialog(BuildContext context, WidgetRef ref) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Confirm Logout'),
        content: const Text(
          'Are you sure you want to log out? All active session tokens will be purged.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.statusBlockedText,
            ),
            onPressed: () {
              Navigator.pop(ctx);
              ref.read(authStateProvider.notifier).logout();
            },
            child: const Text('Log Out'),
          ),
        ],
      ),
    );
  }

  void _showAccountSettingsSheet(BuildContext context, dynamic user) {
    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Account Details', style: AppTypography.headingSmall),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, size: 20),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              _buildInfoRow('Full Name', user?.displayName ?? 'Field Engineer'),
              _buildInfoRow('Username', user?.username ?? 'engineer'),
              _buildInfoRow('Assigned Role', user?.role ?? 'Field Operations'),
              _buildInfoRow('User Identifier', user?.id ?? 'Local Session'),
              _buildInfoRow('Secure Enclave', 'Hardware Keystore / EncryptedPrefs'),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }

  void _showPrivacySecuritySheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Privacy & Security Policy', style: AppTypography.headingSmall),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, size: 20),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              _buildInfoRow('Authentication', 'JWT Bearer with Auto-Refresh'),
              _buildInfoRow('Camera Evidence', 'Pure Canvas In-Memory Watermarking'),
              _buildInfoRow('GPS Acquisition', 'High Accuracy Geolocator (Tamper Verified)'),
              _buildInfoRow('Storage State', 'Stateless Client (No SQLite cache leakage)'),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }

  static Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.darkSlate),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authStateProvider).value;
    final prefs = ref.watch(appPreferencesProvider);

    final notificationsEnabled = prefs['notifications'] ?? true;
    final darkModeEnabled = prefs['darkMode'] ?? false;
    final biometricState = ref.watch(biometricAuthStateProvider);

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      body: SingleChildScrollView(
        padding: const EdgeInsets.only(bottom: 110),
        child: Column(
          children: [
            // Curved Hero Header
            Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.center,
              children: [
                Container(
                  height: 160,
                  width: double.infinity,
                  decoration: const BoxDecoration(
                    color: AppColors.darkSlate,
                    borderRadius: BorderRadius.only(
                      bottomLeft: Radius.circular(36),
                      bottomRight: Radius.circular(36),
                    ),
                  ),
                  child: SafeArea(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Profile',
                            style: AppTypography.headingSmall.copyWith(
                              color: Colors.white,
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Text(
                              'Online',
                              style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                // Elevated Circular Avatar
                Positioned(
                  bottom: -45,
                  child: Container(
                    width: 90,
                    height: 90,
                    decoration: BoxDecoration(
                      color: AppColors.primaryLavender,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 4),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.12),
                          blurRadius: 16,
                          offset: const Offset(0, 6),
                        ),
                      ],
                    ),
                    child: Center(
                      child: Text(
                        user?.displayName?.isNotEmpty == true
                            ? user!.displayName![0].toUpperCase()
                            : 'U',
                        style: const TextStyle(
                          fontSize: 36,
                          fontWeight: FontWeight.w700,
                          color: AppColors.darkSlate,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 55),

            // User Identity & Role
            Text(
              user?.displayName ?? user?.email ?? 'Field Staff',
              style: AppTypography.headingMedium,
            ),
            const SizedBox(height: 4),
            Text(
              user?.role != null
                  ? '${user!.role} • Field Operations'
                  : 'Field Engineer • Telecom & Civil',
              style: AppTypography.bodySmall,
            ),
            const SizedBox(height: 24),

            // Functional Security & Account Settings Container
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    children: [
                      _buildSettingsTile(
                        icon: Icons.person_outline_rounded,
                        title: 'Account setting',
                        trailingText: 'View info',
                        onTap: () => _showAccountSettingsSheet(context, user),
                      ),
                      const Divider(height: 1, color: AppColors.subtleDivider),
                      _buildSettingsTile(
                        icon: Icons.shield_outlined,
                        title: 'Privacy & Security',
                        trailingText: 'Verified',
                        onTap: () => _showPrivacySecuritySheet(context),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            const SizedBox(height: 14),

            // Gateway & Sync Info Card
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.cloud_done_outlined, size: 18, color: Color(0xFF2E7D32)),
                              SizedBox(width: 8),
                              Text(
                                'API Gateway Connection',
                                style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppColors.darkSlate),
                              ),
                            ],
                          ),
                          TextButton(
                            style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(50, 30)),
                            onPressed: () {
                              ref.invalidate(assignedTasksProvider);
                              ref.invalidate(projectListProvider);
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('All tasks and projects synchronized.'),
                                  duration: Duration(seconds: 1),
                                ),
                              );
                            },
                            child: const Text('Sync Now', style: TextStyle(fontSize: 12)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Gateway: ${AppConfig.apiBaseUrl}',
                        style: AppTypography.caption,
                      ),
                    ],
                  ),
                ),
              ),
            ),

            const SizedBox(height: 14),

            // Preferences & Toggles
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(
                    children: [
                      SwitchListTile.adaptive(
                        secondary: const Icon(
                          Icons.notifications_none_rounded,
                          color: AppColors.darkSlate,
                        ),
                        title: Text(
                          'Notification',
                          style: AppTypography.titleMedium,
                        ),
                        value: notificationsEnabled,
                        activeThumbColor: AppColors.darkSlate,
                        onChanged: (val) {
                          ref
                              .read(appPreferencesProvider.notifier)
                              .toggleNotification(val);
                        },
                      ),
                      const Divider(height: 1, color: AppColors.subtleDivider),
                      SwitchListTile.adaptive(
                        secondary: const Icon(
                          Icons.dark_mode_outlined,
                          color: AppColors.darkSlate,
                        ),
                        title: Text(
                          'Dark mode',
                          style: AppTypography.titleMedium,
                        ),
                        value: darkModeEnabled,
                        activeThumbColor: AppColors.darkSlate,
                        onChanged: (val) {
                          ref
                              .read(appPreferencesProvider.notifier)
                              .toggleDarkMode(val);
                        },
                      ),
                      if (biometricState.isHardwareSupported) ...[
                        const Divider(height: 1, color: AppColors.subtleDivider),
                        SwitchListTile.adaptive(
                          secondary: const Icon(
                            Icons.fingerprint_rounded,
                            color: AppColors.darkSlate,
                          ),
                          title: Text(
                            'Fingerprint login',
                            style: AppTypography.titleMedium,
                          ),
                          subtitle: Text(
                            biometricState.isConfigured
                                ? 'Active for @${biometricState.enrolledUsername ?? user?.username}'
                                : 'Fast biometric access',
                            style: AppTypography.caption,
                          ),
                          value: biometricState.isConfigured,
                          activeThumbColor: AppColors.darkSlate,
                          onChanged: (val) async {
                            if (val) {
                              final success = await ref
                                  .read(biometricAuthStateProvider.notifier)
                                  .enrollBiometric(user?.username ?? 'engineer');
                              if (context.mounted && !success) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text(
                                        'Fingerprint enrollment was cancelled or failed.'),
                                  ),
                                );
                              }
                            } else {
                              await ref
                                  .read(biometricAuthStateProvider.notifier)
                                  .disableBiometric();
                            }
                          },
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),

            const SizedBox(height: 14),

            // Logout Action
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: _buildSettingsTile(
                    icon: Icons.logout_rounded,
                    iconColor: AppColors.statusBlockedText,
                    title: 'Log Out',
                    titleColor: AppColors.statusBlockedText,
                    onTap: () => _showLogoutDialog(context, ref),
                  ),
                ),
              ),
            ),

            const SizedBox(height: 20),
            Center(
              child: Text(
                'iPMS Mobile v1.0.0 • Pure Stateless Client',
                style: AppTypography.caption,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSettingsTile({
    required IconData icon,
    Color? iconColor,
    required String title,
    Color? titleColor,
    String? trailingText,
    required VoidCallback onTap,
  }) {
    return ListTile(
      leading: Icon(icon, color: iconColor ?? AppColors.darkSlate, size: 22),
      title: Text(
        title,
        style: AppTypography.titleMedium.copyWith(
          color: titleColor ?? AppColors.textPrimary,
        ),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (trailingText != null) ...[
            Text(trailingText, style: AppTypography.bodySmall),
            const SizedBox(width: 6),
          ],
          const Icon(
            Icons.chevron_right_rounded,
            size: 20,
            color: AppColors.textTertiary,
          ),
        ],
      ),
      onTap: onTap,
    );
  }
}
