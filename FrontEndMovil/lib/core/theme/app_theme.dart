import 'package:flutter/material.dart';
import 'tokens.dart';
import 'typography.dart';

/// Tema oscuro único (ADR-0006) — la plataforma no ofrece modo claro hoy.
ThemeData buildAppTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: AppColors.bgMain,
    colorScheme: const ColorScheme.dark(
      primary: AppColors.primary,
      secondary: AppColors.secondary,
      surface: AppColors.bgCardSolid,
      error: AppColors.semanticDestructive,
      onPrimary: AppColors.bgMain,
      onSurface: AppColors.textMain,
    ),
    textTheme: AppTypography.textTheme(),
  );

  return base.copyWith(
    appBarTheme: AppBarTheme(
      backgroundColor: AppColors.bgSidebar,
      foregroundColor: AppColors.textMain,
      elevation: 0,
      titleTextStyle: AppTypography.display(size: 18),
      surfaceTintColor: Colors.transparent,
    ),
    drawerTheme: const DrawerThemeData(
      backgroundColor: AppColors.bgSidebar,
    ),
    cardTheme: CardThemeData(
      color: AppColors.bgCardSolid,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.card),
        side: const BorderSide(color: AppColors.border),
      ),
    ),
    tabBarTheme: TabBarThemeData(
      labelColor: AppColors.textMain,
      unselectedLabelColor: AppColors.textDim,
      labelStyle: AppTypography.miningUi(),
      indicatorColor: AppColors.primary,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.bgCardSolid,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.nav),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.nav),
        borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
      ),
      labelStyle: AppTypography.body(color: AppColors.textDim),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.bgMain,
        textStyle: AppTypography.miningUi(color: AppColors.bgMain),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadii.nav)),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
      ),
    ),
    dividerTheme: const DividerThemeData(color: AppColors.border, thickness: 1),
    listTileTheme: const ListTileThemeData(iconColor: AppColors.textDim, textColor: AppColors.textMain),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.bgCardSolid,
      contentTextStyle: AppTypography.body(),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadii.nav)),
    ),
  );
}
