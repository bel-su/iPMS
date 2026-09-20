import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_colors.dart';
import 'floating_nav_bar.dart';

/// Navigation index notifier for active tab switching across screens.
class NavigationIndexNotifier extends Notifier<int> {
  @override
  int build() => 0;

  void setIndex(int index) => state = index;
}

final navigationIndexProvider =
    NotifierProvider<NavigationIndexNotifier, int>(NavigationIndexNotifier.new);

class MainScaffold extends ConsumerWidget {
  const MainScaffold({
    super.key,
    required this.pages,
  });

  final List<Widget> pages;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentIndex = ref.watch(navigationIndexProvider);

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      body: Stack(
        children: [
          // Current Tab Body
          IndexedStack(
            index: currentIndex < pages.length ? currentIndex : 0,
            children: pages,
          ),

          // Floating Navigation Bar
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: SafeArea(
              child: FloatingNavBar(
                currentIndex: currentIndex,
                onTap: (index) {
                  ref.read(navigationIndexProvider.notifier).setIndex(index);
                },
                onQuickAction: () {
                  // Switch to Task List
                  ref.read(navigationIndexProvider.notifier).setIndex(0);
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}
