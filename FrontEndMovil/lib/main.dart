import 'dart:async';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import 'app.dart';
import 'core/auth/auth_session_manager.dart';
import 'core/auth/session_bootstrap.dart';
import 'core/bootstrap.dart';
import 'core/network/cookie_jar_provider.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // El CookieJar necesita un directorio resuelto de forma async (ver
  // docs/decisions/0003) — se hace una sola vez aquí, antes de runApp, para
  // que el resto de la app trabaje con providers síncronos.
  final supportDir = await getApplicationSupportDirectory();
  final cookieJar = PersistCookieJar(storage: FileStorage('${supportDir.path}/.cookies/'));

  final container = ProviderContainer(overrides: [
    cookieJarProvider.overrideWithValue(cookieJar),
  ]);

  // Arranque en frío: intenta restaurar sesión antes del primer frame útil
  // (la UI ya muestra el splash mientras esto corre, ver AuthSessionState).
  wireAuthCallbacks(container);
  unawaited(restoreSessionOnColdStart(container));
  AuthSessionManager(container).start();

  runApp(UncontrolledProviderScope(container: container, child: const BeemetryMovilApp()));
}
