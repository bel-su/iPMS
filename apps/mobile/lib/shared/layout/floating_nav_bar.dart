import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';

/// Floating capsule bottom navigation bar inspired by modern mobile dashboard designs.
class FloatingNavBar extends StatelessWidget {
  const FloatingNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
    this.onQuickAction,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;
  final VoidCallback? onQuickAction;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 24, vertical: 18),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.darkSlate,
        borderRadius: BorderRadius.circular(36),
        boxShadow: [
          BoxShadow(
            color: AppColors.darkSlate.withValues(alpha: 0.35),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          _buildNavItem(
            index: 0,
            icon: Icons.space_dashboard_rounded,
            tooltip: 'Tasks',
          ),
          _buildNavItem(
            index: 1,
            icon: Icons.map_rounded,
            tooltip: 'Site Map',
          ),
          _buildNavItem(
            index: 2,
            icon: Icons.search_rounded,
            tooltip: 'Search',
          ),
          _buildNavItem(
            index: 3,
            icon: Icons.person_rounded,
            tooltip: 'Profile',
          ),
          // Quick Action Action Button
          Container(
            height: 44,
            width: 44,
            decoration: BoxDecoration(
              color: AppColors.primaryLavender,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryLavenderDark.withValues(alpha: 0.4),
                  blurRadius: 8,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: IconButton(
              icon: const Icon(
                Icons.add_rounded,
                color: AppColors.darkSlate,
                size: 22,
              ),
              onPressed: onQuickAction ?? () => onTap(0),
              tooltip: 'Quick Action',
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNavItem({
    required int index,
    required IconData icon,
    required String tooltip,
  }) {
    final isSelected = currentIndex == index;

    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: () => onTap(index),
        borderRadius: BorderRadius.circular(24),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: isSelected
                ? AppColors.darkSlateSecondary
                : Colors.transparent,
            borderRadius: BorderRadius.circular(24),
          ),
          child: Icon(
            icon,
            size: 22,
            color: isSelected ? Colors.white : AppColors.textTertiary,
          ),
        ),
      ),
    );
  }
}
