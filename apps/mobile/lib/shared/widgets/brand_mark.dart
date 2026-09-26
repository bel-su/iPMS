import 'package:flutter/material.dart';

/// The AXIOM "A" mark.
///
/// Used everywhere the brand appears inside the app; the full logo is kept
/// for the sign-in screen only.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 32});

  /// Width in logical pixels; height follows the mark's aspect ratio.
  final double size;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/brand/axiom_mark.png',
      width: size,
      fit: BoxFit.contain,
      semanticLabel: 'AXIOM',
    );
  }
}
