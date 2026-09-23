import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Cliente SSE manual (Dart no tiene `EventSource`, ver docs/decisions/0003)
/// — a diferencia del navegador, puede mandar `Authorization: Bearer`, así
/// que no depende de cookies. Reconecta con backoff exponencial salvo que
/// el servidor responda 401 (sesión inválida — no tiene sentido reintentar
/// sin un token nuevo, igual criterio que `useLiveKpi.ts` del frontend web).
class SseClient {
  SseClient({required this.url, required this.getToken});

  final String url;
  final String? Function() getToken;

  StreamSubscription<String>? _sub;
  http.Client? _client;
  bool _stopped = false;
  int _backoffSeconds = 1;

  final _controller = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get events => _controller.stream;

  void start() {
    _stopped = false;
    _connect();
  }

  void stop() {
    _stopped = true;
    _sub?.cancel();
    _client?.close();
  }

  Future<void> _connect() async {
    if (_stopped) return;
    final client = http.Client();
    _client = client;
    try {
      final token = getToken();
      final request = http.Request('GET', Uri.parse(url));
      request.headers['Accept'] = 'text/event-stream';
      if (token != null) request.headers['Authorization'] = 'Bearer $token';

      final response = await client.send(request);
      if (response.statusCode == 401) {
        _stopped = true; // no reintentar sin sesión válida
        return;
      }
      if (response.statusCode != 200) {
        _scheduleReconnect();
        return;
      }

      _backoffSeconds = 1;
      var buffer = '';
      _sub = response.stream.transform(utf8.decoder).listen(
        (chunk) {
          buffer += chunk;
          while (buffer.contains('\n\n')) {
            final index = buffer.indexOf('\n\n');
            final rawEvent = buffer.substring(0, index);
            buffer = buffer.substring(index + 2);
            _emitEvent(rawEvent);
          }
        },
        onError: (_) => _scheduleReconnect(),
        onDone: () => _scheduleReconnect(),
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _emitEvent(String rawEvent) {
    for (final line in rawEvent.split('\n')) {
      if (!line.startsWith('data:')) continue;
      final payload = line.substring(5).trim();
      try {
        _controller.add(jsonDecode(payload) as Map<String, dynamic>);
      } catch (_) {
        // Evento no-JSON — se ignora silenciosamente (best-effort).
      }
    }
  }

  void _scheduleReconnect() {
    if (_stopped) return;
    Future.delayed(Duration(seconds: _backoffSeconds), () {
      if (_stopped) return;
      _backoffSeconds = (_backoffSeconds * 2).clamp(1, 30);
      _connect();
    });
  }

  void dispose() {
    stop();
    _controller.close();
  }
}
