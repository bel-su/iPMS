import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../auth/providers/auth_provider.dart';
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
          'Are you sure you want to log out? All active in-memory session data will be purged.',
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authStateProvider).value;
    final prefs = ref.watch(appPreferencesProvider);

    final notificationsEnabled = prefs['notifications'] ?? true;
    final darkModeEnabled = prefs['darkMode'] ?? false;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      body: SingleChildScrollView(
        padding: const EdgeInsets.only(bottom: 110),
        child: Column(
          children: [
            // Curved Hero Header (matching Image 2)
            Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.center,
              children: [
                Container(
                  height: 180,
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
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SizedBox(width: 40),
                          Text(
                            'Profile',
                            style: AppTypography.headingSmall.copyWith(
                              color: Colors.white,
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.more_vert, color: Colors.white),
                            onPressed: () {},
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                // Elevated Circular Avatar with Camera Badge
                Positioned(
                  bottom: -45,
                  child: Stack(
                    children: [
                      Container(
                        width: 96,
                        height: 96,
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
                              fontSize: 38,
                              fontWeight: FontWeight.w700,
                              color: AppColors.darkSlate,
                            ),
                          ),
                        ),
                      ),
                      // Camera Icon Badge
                      Positioned(
                        right: 0,
                        bottom: 0,
                        child: Container(
                          padding: const EdgeInsets.all(6),
                          decoration: BoxDecoration(
                            color: AppColors.darkSlate,
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 2),
                          ),
                          child: const Icon(
                            Icons.camera_alt_rounded,
                            size: 14,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 55),

            // User Identity & Role
            Text(
              user?.displayName ?? user?.username ?? 'Field Staff',
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

            // Settings Container
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
                        onTap: () {},
                      ),
                      const Divider(height: 1, color: AppColors.subtleDivider),
                      _buildSettingsTile(
                        icon: Icons.shield_outlined,
                        title: 'Privacy & Security',
                        onTap: () {},
                      ),
                      const Divider(height: 1, color: AppColors.subtleDivider),
                      _buildSettingsTile(
                        icon: Icons.language_rounded,
                        title: 'Language',
                        trailingText: 'English',
                        onTap: () {},
                      ),
                      const Divider(height: 1, color: AppColors.subtleDivider),
                      _buildSettingsTile(
                        icon: Icons.settings_outlined,
                        title: 'Settings',
                        onTap: () {},
                      ),
                    ],
                  ),
                ),
              ),
            ),

            const SizedBox(height: 16),

            // Preferences & Toggles
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    children: [
                      // Notification Toggle
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

                      // Dark Mode Toggle
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
                    ],
                  ),
                ),
              ),
            ),

            const SizedBox(height: 16),

            // Help & Logout
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    children: [
                      _buildSettingsTile(
                        icon: Icons.help_outline_rounded,
                        title: 'Help & Support',
                        onTap: () {},
                      ),
                      const Divider(height: 1, color: AppColors.subtleDivider),
                      _buildSettingsTile(
                        icon: Icons.logout_rounded,
                        iconColor: AppColors.statusBlockedText,
                        title: 'Log Out',
                        titleColor: AppColors.statusBlockedText,
                        onTap: () => _showLogoutDialog(context, ref),
                      ),
                    ],
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
