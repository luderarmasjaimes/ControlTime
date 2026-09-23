import 'package:flutter/material.dart';

/// Tokens de color replicados de `frontend/src/index.css` (ver
/// docs/decisions/0006-sistema-diseno-visual.md). Fuente de verdad: el
/// frontend web actual — NO `frontend/styles.css`, que es un sistema de
/// tokens no relacionado (herramienta interna de tilesets GIS).
abstract final class AppColors {
  static const primary = Color(0xFFF07E41);
  static const primaryGlow = Color(0x66F07E41);
  static const secondary = Color(0xFF476074);
  static const accent = Color(0xFFFF813D);

  static const bgMain = Color(0xFF020617);
  static const bgSidebar = Color(0xFF0F172A);
  static const bgCard = Color(0x801E293B);
  static const bgCardSolid = Color(0xFF1E293B);

  static const textMain = Color(0xFFF8FAFC);
  static const textDim = Color(0xFF94A3B8);
  static const border = Color(0x14FFFFFF);

  // Codificación semántica (ADR-040 del repo principal): badges/acciones.
  static const semanticLive = Color(0xFF10B981); // esmeralda
  static const semanticBeta = Color(0xFF06B6D4); // cian
  static const semanticPro = Color(0xFF8B5CF6); // violeta
  static const semanticNew = Color(0xFFF59E0B); // ámbar
  static const semanticAdmin = Color(0xFF6366F1); // índigo
  static const semanticDestructive = Color(0xFFEF4444); // rojo

  static const severityInfo = Color(0xFF38BDF8);
  static const severityWarning = Color(0xFFF59E0B);
  static const severityCritical = Color(0xFFEF4444);
}

/// Sombras en capas para el "relieve 3D sutil" de ADR-040 (repo principal):
/// sombra exterior + highlight interior superior, nunca un color plano.
abstract final class AppShadows {
  static const navResting = [
    BoxShadow(color: Color(0x47020617), offset: Offset(0, 8), blurRadius: 18),
  ];

  static List<BoxShadow> navActive(Color glow) => [
        BoxShadow(color: Color(0x47020617), offset: const Offset(0, 8), blurRadius: 18),
        BoxShadow(color: glow, blurRadius: 18, spreadRadius: 0),
      ];
}

abstract final class AppRadii {
  static const nav = 10.0;
  static const card = 14.0;
  static const sheet = 20.0;
}

abstract final class AppSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
}
