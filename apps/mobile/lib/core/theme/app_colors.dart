import 'package:flutter/material.dart';

/// Central color palette matching the iPMS mobile design specifications.
class AppColors {
  AppColors._();

  // Primary Pastel & Brand Palette
  static const Color primaryLavender = Color(0xFFDDD7F7);
  static const Color primaryLavenderDark = Color(0xFFBCB3EE);
  static const Color primaryLavenderLight = Color(0xFFF1EEFC);

  // Dark slate for hero inset & floating navigation bar
  static const Color darkSlate = Color(0xFF1B1B2A);
  static const Color darkSlateSecondary = Color(0xFF28283E);

  // Soft mint / Teal for status and active items
  static const Color softMint = Color(0xFFD1F2EB);
  static const Color mintDark = Color(0xFF0E6251);
  static const Color mintText = Color(0xFF117A65);

  // Accent & Attention colors
  static const Color accentYellow = Color(0xFFFFB84C);
  static const Color accentPeach = Color(0xFFFFE3D8);
  static const Color accentOrange = Color(0xFFE67E22);

  // Background & Surfaces
  static const Color scaffoldBackground = Color(0xFFF8F9FE);
  static const Color cardSurface = Colors.white;
  static const Color subtleDivider = Color(0xFFEEEEF5);
  static const Color searchFieldBackground = Color(0xFFF1F2F8);

  // Text colors
  static const Color textPrimary = Color(0xFF1A1A24);
  static const Color textSecondary = Color(0xFF757589);
  static const Color textTertiary = Color(0xFFA5A5B8);
  static const Color textWhite = Colors.white;

  // Status Badge Colors (Background + Text)
  static const Color statusOngoingBg = Color(0xFFE8F8F5);
  static const Color statusOngoingText = Color(0xFF117A65);

  static const Color statusReviewingBg = Color(0xFFEBF5FB);
  static const Color statusReviewingText = Color(0xFF2471A3);

  static const Color statusCompletedBg = Color(0xFFEAFAF1);
  static const Color statusCompletedText = Color(0xFF1E8449);

  static const Color statusBlockedBg = Color(0xFFFDEDEC);
  static const Color statusBlockedText = Color(0xFFC0392B);

  static const Color statusCancelledBg = Color(0xFFF2F3F4);
  static const Color statusCancelledText = Color(0xFF5D6D7E);

  // Priority Colors
  static const Color priorityHighBg = Color(0xFFFFEAE6);
  static const Color priorityHighText = Color(0xFFD9381E);

  static const Color priorityMediumBg = Color(0xFFFFF7DF);
  static const Color priorityMediumText = Color(0xFFB7791F);

  static const Color priorityLowBg = Color(0xFFE8F8F5);
  static const Color priorityLowText = Color(0xFF117A65);
}
