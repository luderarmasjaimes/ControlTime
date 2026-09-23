import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/i18n/i18n_provider.dart';
import '../../../core/widgets/authenticated_webview.dart';

/// Puente WebView hacia la app legada de fórmulas (ADR-0005) —
/// `frontend/public/formula/index.html`, no-React, servida por el
/// microservicio `formula_engine`.
class FormulaCanvasScreen extends ConsumerWidget {
  const FormulaCanvasScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(translationsProvider);
    return AuthenticatedWebView(path: '/formula/index.html', title: t('nav.formulaCanvas'));
  }
}
