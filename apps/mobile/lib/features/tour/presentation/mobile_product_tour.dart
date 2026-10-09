import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/security/token_storage.dart';

/// Central registry of target keys used to anchor interactive tour spotlight cutouts.
class TourTargetRegistry {
  static final GlobalKey profileHeaderKey = GlobalKey(debugLabel: 'tour_profile_header');
  static final GlobalKey searchButtonKey = GlobalKey(debugLabel: 'tour_search_button');
  static final GlobalKey statusFilterKey = GlobalKey(debugLabel: 'tour_status_filter');
  static final GlobalKey firstTaskCardKey = GlobalKey(debugLabel: 'tour_first_task_card');
  static final GlobalKey navigationDockKey = GlobalKey(debugLabel: 'tour_navigation_dock');
}

/// A single step in the mobile interactive walkthrough.
class TourStep {
  final GlobalKey targetKey;
  final String title;
  final String badge;
  final String description;
  final IconData icon;

  const TourStep({
    required this.targetKey,
    required this.title,
    required this.badge,
    required this.description,
    required this.icon,
  });
}

/// Interactive spotlight coach marks for the field mobile application.
class MobileProductTour {
  static final List<TourStep> steps = [
    TourStep(
      targetKey: TourTargetRegistry.profileHeaderKey,
      title: 'Engineer Identity & Profile',
      badge: 'Step 1 of 5 • Profile',
      description:
          'View your authenticated field engineer status, telecom province deployment, and access account settings.',
      icon: Icons.badge_outlined,
    ),
    TourStep(
      targetKey: TourTargetRegistry.searchButtonKey,
      title: 'Site & Tower Omni-Search',
      badge: 'Step 2 of 5 • Search',
      description:
          'Instantly search cell towers by site code (e.g. KTM-T01), tower height, or work order title across Nepal.',
      icon: Icons.search_rounded,
    ),
    TourStep(
      targetKey: TourTargetRegistry.statusFilterKey,
      title: 'Workflow Status Pipeline',
      badge: 'Step 3 of 5 • Filters',
      description:
          'Filter work orders across Pending dispatches, In-Progress audits, Submissions awaiting QC, and Completed logs.',
      icon: Icons.filter_list_rounded,
    ),
    TourStep(
      targetKey: TourTargetRegistry.firstTaskCardKey,
      title: 'Cell Tower Work Orders',
      badge: 'Step 4 of 5 • Work Order',
      description:
          'Open active tasks to complete digital checklists, verify GPS coordinates, and capture watermarked camera evidence.',
      icon: Icons.cell_tower_rounded,
    ),
    TourStep(
      targetKey: TourTargetRegistry.navigationDockKey,
      title: 'Floating Navigation Dock',
      badge: 'Step 5 of 5 • Navigation',
      description:
          'Quickly navigate between your assigned Tasks, Project cell sites, Finance travel claims, and Profile.',
      icon: Icons.navigation_outlined,
    ),
  ];

  /// Checks if the user has already seen the tour; if not, marks as seen and launches it.
  static Future<void> checkAndStart(BuildContext context) async {
    final storage = TokenStorage();
    final hasSeen = await storage.hasSeenProductTour();
    if (hasSeen || !context.mounted) return;

    await storage.markProductTourAsSeen();
    if (context.mounted) {
      await show(context);
    }
  }

  /// Explicitly opens the interactive product tour overlay.
  static Future<void> show(BuildContext context) {
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: false,
      barrierColor: Colors.transparent,
      pageBuilder: (dialogContext, animation, secondaryAnimation) {
        return const _TourOverlay();
      },
    );
  }
}

class _TourOverlay extends StatefulWidget {
  const _TourOverlay();

  @override
  State<_TourOverlay> createState() => _TourOverlayState();
}

class _TourOverlayState extends State<_TourOverlay>
    with SingleTickerProviderStateMixin {
  int _currentStep = 0;
  late final AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  Rect? _getTargetRect(GlobalKey key) {
    final renderBox = key.currentContext?.findRenderObject() as RenderBox?;
    if (renderBox == null || !renderBox.attached) return null;
    final offset = renderBox.localToGlobal(Offset.zero);
    final size = renderBox.size;
    if (size.width <= 0 || size.height <= 0) return null;
    return offset & size;
  }

  void _next() {
    if (_currentStep < MobileProductTour.steps.length - 1) {
      setState(() => _currentStep++);
    } else {
      _dismiss();
    }
  }

  void _previous() {
    if (_currentStep > 0) {
      setState(() => _currentStep--);
    }
  }

  void _dismiss() {
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final step = MobileProductTour.steps[_currentStep];
    final screenSize = MediaQuery.of(context).size;
    final padding = MediaQuery.of(context).padding;
    final rawTargetRect = _getTargetRect(step.targetKey);

    // Padding inflation around target
    final targetRect = rawTargetRect?.inflate(6.0);

    // Determine tooltip positioning: above or below target
    final bool placeBelow;
    if (targetRect != null) {
      final spaceBelow = screenSize.height - targetRect.bottom;
      final spaceAbove = targetRect.top;
      placeBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
    } else {
      placeBelow = true;
    }

    return Material(
      color: Colors.transparent,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // 1. Darkened Spotlight Cutout Canvas
          AnimatedBuilder(
            animation: _pulseController,
            builder: (context, _) {
              return CustomPaint(
                size: screenSize,
                painter: _SpotlightPainter(
                  targetRect: targetRect,
                  pulseValue: _pulseController.value,
                ),
              );
            },
          ),

          // 2. Barrier tap to advance or dismiss
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: () {
                // Tapping outside does nothing or advances; keeping explicit buttons is safer
              },
            ),
          ),

          // 3. Floating Tooltip Popover Card
          _buildPopoverCard(
            context: context,
            step: step,
            screenSize: screenSize,
            safePadding: padding,
            targetRect: targetRect,
            placeBelow: placeBelow,
          ),
        ],
      ),
    );
  }

  Widget _buildPopoverCard({
    required BuildContext context,
    required TourStep step,
    required Size screenSize,
    required EdgeInsets safePadding,
    required Rect? targetRect,
    required bool placeBelow,
  }) {
    const cardHorizontalMargin = 20.0;
    final cardWidth = screenSize.width - (cardHorizontalMargin * 2);

    double? top;
    double? bottom;

    if (targetRect != null) {
      if (placeBelow) {
        top = math.min(
          targetRect.bottom + 12.0,
          screenSize.height - safePadding.bottom - 260.0,
        );
      } else {
        bottom = math.min(
          (screenSize.height - targetRect.top) + 12.0,
          screenSize.height - safePadding.top - 260.0,
        );
      }
    } else {
      // Centered fallback if target is not currently laid out
      top = (screenSize.height - 240.0) / 2.0;
    }

    return Positioned(
      left: cardHorizontalMargin,
      right: cardHorizontalMargin,
      top: top,
      bottom: bottom,
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 240),
        child: Container(
          key: ValueKey<int>(_currentStep),
          width: cardWidth,
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B), // Deep slate background
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: const Color(0xFF475569).withValues(alpha: 0.6),
              width: 1.2,
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.45),
                blurRadius: 28,
                offset: const Offset(0, 12),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header Row: Badge Pill + Icon + Skip Button
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: const Color(0xFF6366F1).withValues(alpha: 0.25),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: const Color(0xFF818CF8).withValues(alpha: 0.6),
                        width: 1,
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(step.icon, size: 14, color: const Color(0xFFA5B4FC)),
                        const SizedBox(width: 6),
                        Text(
                          step.badge,
                          style: const TextStyle(
                            color: Color(0xFFA5B4FC),
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.3,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Spacer(),
                  // Skip Text Button
                  InkWell(
                    onTap: _dismiss,
                    borderRadius: BorderRadius.circular(8),
                    child: const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                      child: Text(
                        'Skip Tour',
                        style: TextStyle(
                          color: Color(0xFF94A3B8),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Title
              Text(
                step.title,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  letterSpacing: -0.2,
                ),
              ),
              const SizedBox(height: 8),

              // Description
              Text(
                step.description,
                style: const TextStyle(
                  color: Color(0xFFCBD5E1),
                  fontSize: 13.5,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 18),

              // Footer: Progress Dots + Navigation Action Buttons
              Row(
                children: [
                  // Progress Dots
                  Row(
                    children: List.generate(
                      MobileProductTour.steps.length,
                      (index) => AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        margin: const EdgeInsets.only(right: 5),
                        width: index == _currentStep ? 20 : 6,
                        height: 6,
                        decoration: BoxDecoration(
                          color: index == _currentStep
                              ? const Color(0xFF6366F1)
                              : const Color(0xFF475569),
                          borderRadius: BorderRadius.circular(3),
                        ),
                      ),
                    ),
                  ),
                  const Spacer(),

                  // Back Button (if index > 0)
                  if (_currentStep > 0) ...[
                    OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFFE2E8F0),
                        side: const BorderSide(color: Color(0xFF475569)),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      onPressed: _previous,
                      child: const Text('Back', style: TextStyle(fontSize: 12.5)),
                    ),
                    const SizedBox(width: 8),
                  ],

                  // Next / Finish Button
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF6366F1),
                      foregroundColor: Colors.white,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    onPressed: _next,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _currentStep == MobileProductTour.steps.length - 1
                              ? 'Get Started'
                              : 'Next',
                          style: const TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(width: 4),
                        const Icon(Icons.arrow_forward_rounded, size: 14),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Custom painter rendering the darkened backdrop with rounded cutout and pulsing halo.
class _SpotlightPainter extends CustomPainter {
  final Rect? targetRect;
  final double pulseValue;

  _SpotlightPainter({
    required this.targetRect,
    required this.pulseValue,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // 1. Darkened Barrier Background
    final fullScreenPath = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height));

    if (targetRect == null) {
      // Just dark barrier without cutout
      canvas.drawPath(
        fullScreenPath,
        Paint()..color = const Color(0xDD0B132B), // ~87% opacity deep navy
      );
      return;
    }

    final cutoutRRect = RRect.fromRectAndRadius(
      targetRect!,
      const Radius.circular(16.0),
    );
    final cutoutPath = Path()..addRRect(cutoutRRect);

    // Compute inverted mask difference
    final barrierPath = Path.combine(
      PathOperation.difference,
      fullScreenPath,
      cutoutPath,
    );

    canvas.drawPath(
      barrierPath,
      Paint()..color = const Color(0xDD0B132B),
    );

    // 2. Animated Pulsing Halo Ring
    final haloInflation = 3.0 + (pulseValue * 7.0);
    final haloOpacity = (1.0 - pulseValue).clamp(0.0, 1.0) * 0.75;
    final haloRRect = RRect.fromRectAndRadius(
      targetRect!.inflate(haloInflation),
      Radius.circular(16.0 + haloInflation),
    );

    final haloPaint = Paint()
      ..color = const Color(0xFF6366F1).withValues(alpha: haloOpacity)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5;

    canvas.drawRRect(haloRRect, haloPaint);

    // 3. Crisp Inner Focus Border
    final borderPaint = Paint()
      ..color = const Color(0xFF818CF8)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0;

    canvas.drawRRect(cutoutRRect, borderPaint);
  }

  @override
  bool shouldRepaint(covariant _SpotlightPainter oldDelegate) {
    return oldDelegate.targetRect != targetRect ||
        oldDelegate.pulseValue != pulseValue;
  }
}
