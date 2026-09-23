import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../auth/auth_session.dart';
import '../i18n/i18n_provider.dart';
import '../network/env.dart';
import '../theme/tokens.dart';

/// Puente WebView autenticado (ADR-0005): usado únicamente para edición de
/// Informes (ReportStudioV2) y el canvas legado de Fórmulas — los dos
/// módulos donde reimplementar el editor nativamente no es razonable (ver
/// ADR-0005 para el porqué). Inyecta el access token vigente como
/// parámetro de arranque; el usuario ve un indicador claro de que está en
/// "edición avanzada", nunca se disfraza de nativo.
class AuthenticatedWebView extends ConsumerStatefulWidget {
  const AuthenticatedWebView({super.key, required this.path, required this.title});

  /// Ruta relativa al origen del backend (ej. `/app?view=report&id=123`).
  final String path;
  final String title;

  @override
  ConsumerState<AuthenticatedWebView> createState() => _AuthenticatedWebViewState();
}

class _AuthenticatedWebViewState extends ConsumerState<AuthenticatedWebView> {
  late final WebViewController _controller;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    // NOTA (ADR-0005): `mobile_bridge_token` es el nombre propuesto para un
    // parámetro que el frontend web (`frontend/src/App.tsx` o su shell de
    // sesión) todavía NO sabe leer — hoy ese frontend solo establece sesión
    // vía su propio flujo de login o el refresh cookie-based (ADR-132 del
    // repo principal). Para que este puente funcione de verdad hace falta
    // un cambio pequeño y explícito del lado del frontend web (leer este
    // query param una vez al montar y llamar a `createSession`/guardar el
    // token en memoria, igual que hace tras un login normal) — se deja
    // aquí como el contrato esperado, pendiente de esa pieza en el repo
    // principal (fuera del alcance de este proyecto per ADR-0001, pero
    // necesaria para cerrar el flujo end-to-end).
    final token = ref.read(authSessionControllerProvider.notifier).currentToken;
    final uri = Uri.parse('${AppEnv.apiBaseUrl}${widget.path}').replace(queryParameters: {
      ...Uri.parse('${AppEnv.apiBaseUrl}${widget.path}').queryParameters,
      if (token != null) 'mobile_bridge_token': token,
    });

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onPageFinished: (_) => setState(() => _loading = false),
      ))
      ..loadRequest(uri);
  }

  @override
  Widget build(BuildContext context) {
    final t = ref.watch(translationsProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(28),
          child: Container(
            width: double.infinity,
            color: AppColors.semanticAdmin.withValues(alpha: 0.25),
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Text(t('common.openInBrowser'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 11, color: AppColors.textMain)),
          ),
        ),
      ),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loading) const LinearProgressIndicator(color: AppColors.primary),
        ],
      ),
    );
  }
}
