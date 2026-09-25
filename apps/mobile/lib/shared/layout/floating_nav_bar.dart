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
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _buildNavItem(
            index: 0,
            icon: Icons.assignment_outlined,
            selectedIcon: Icons.assignment_rounded,
            label: 'Tasks',
          ),
          _buildNavItem(
            index: 1,
            icon: Icons.business_outlined,
            selectedIcon: Icons.business_rounded,
            label: 'Projects',
          ),
          _buildNavItem(
            index: 2,
            icon: Icons.map_outlined,
            selectedIcon: Icons.map_rounded,
            label: 'Map',
          ),
          _buildNavItem(
            index: 3,
            icon: Icons.person_outline_rounded,
            selectedIcon: Icons.person_rounded,
            label: 'Profile',
          ),
        ],
      ),
    );
  }

  Widget _buildNavItem({
    required int index,
    required IconData icon,
    required IconData selectedIcon,
    required String label,
  }) {
    final isSelected = currentIndex == index;

    return Tooltip(
      message: label,
      child: InkWell(
        onTap: () => onTap(index),
        borderRadius: BorderRadius.circular(20),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            color: isSelected
                ? AppColors.darkSlateSecondary
                : Colors.transparent,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                isSelected ? selectedIcon : icon,
                size: 20,
                color: isSelected ? Colors.white : AppColors.textTertiary,
              ),
              if (isSelected) ...[
                const SizedBox(width: 6),
                Text(
                  label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
