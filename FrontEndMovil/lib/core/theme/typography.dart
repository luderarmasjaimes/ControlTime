import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'tokens.dart';

/// Cuatro familias tipográficas en uso real en el frontend web (ver
/// docs/decisions/0006): Inter (cuerpo), Outfit (marca/títulos), Barlow
/// Semi Condensed (títulos técnicos), Rajdhani (UI condensada de nav).
abstract final class AppTypography {
  static TextStyle body({Color? color, double size = 14, FontWeight? weight}) =>
      GoogleFonts.inter(color: color ?? AppColors.textMain, fontSize: size, fontWeight: weight);

  static TextStyle display({Color? color, double size = 22, FontWeight weight = FontWeight.w700}) =>
      GoogleFonts.outfit(color: color ?? AppColors.textMain, fontSize: size, fontWeight: weight);

  static TextStyle miningDisplay({Color? color, double size = 18, FontWeight weight = FontWeight.w600}) =>
      GoogleFonts.barlowSemiCondensed(color: color ?? AppColors.textMain, fontSize: size, fontWeight: weight);

  static TextStyle miningUi({Color? color, double size = 13, FontWeight weight = FontWeight.w600}) =>
      GoogleFonts.rajdhani(color: color ?? AppColors.textMain, fontSize: size, fontWeight: weight, letterSpacing: 0.4);

  static TextTheme textTheme() => TextTheme(
        displayLarge: display(size: 32),
        displayMedium: display(size: 26),
        displaySmall: display(size: 22),
        titleLarge: miningDisplay(size: 20),
        titleMedium: miningDisplay(size: 17),
        titleSmall: miningDisplay(size: 15),
        bodyLarge: body(size: 16),
        bodyMedium: body(size: 14),
        bodySmall: body(size: 12, color: AppColors.textDim),
        labelLarge: miningUi(size: 14),
        labelMedium: miningUi(size: 13),
        labelSmall: miningUi(size: 11),
      );
}
