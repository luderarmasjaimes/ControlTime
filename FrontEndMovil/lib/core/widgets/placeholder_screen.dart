import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// Marcador para módulos aún no implementados en esta pasada — el destino
/// de navegación ya existe (ver ADR-0004: "todo el menú" debe ser
/// navegable desde el día uno) mientras se completa su integración real
/// con la API, módulo por módulo.
class PlaceholderScreen extends StatelessWidget {
  const PlaceholderScreen({super.key, required this.title});
  final String title;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.construction_outlined, color: AppColors.textDim, size: 40),
              const SizedBox(height: AppSpacing.md),
              Text(title, style: const TextStyle(color: AppColors.textDim), textAlign: TextAlign.center),
            ],
          ),
        ),
      );
}
