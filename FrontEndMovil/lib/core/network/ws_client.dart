import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

/// Wrapper reconectable sobre `/ws` (canal de alarmas + diffs de mapa, ver
/// docs/decisions — informe de investigación de la API, §5.1). Un cliente
/// nativo puede pasar el token por `Authorization` en vez del query param
/// `?auth_token=` que el navegador necesita (no puede setear headers en
/// `new WebSocket()`) — pero igual se soporta el query param como fallback,
/// ya que es la única vía que el propio backend documenta para el handshake
/// de upgrade.
class WsClient {
  WsClient({required this.url});

  final String url;

  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  bool _stopped = false;
  int _backoffSeconds = 1;

  final _controller = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get messages => _controller.stream;

  void start({required String? Function() getToken}) {
    _stopped = false;
    _connect(getToken);
  }

  void _connect(String? Function() getToken) {
    if (_stopped) return;
    try {
      final token = getToken();
      final uri = Uri.parse(url).replace(queryParameters: token != null ? {'auth_token': token} : null);
      final channel = WebSocketChannel.connect(uri);
      _channel = channel;
      _backoffSeconds = 1;

      _sub = channel.stream.listen(
        (raw) {
          try {
            _controller.add(jsonDecode(raw as String) as Map<String, dynamic>);
          } catch (_) {
            // Mensaje no-JSON (ping/pong de infraestructura) — se ignora.
          }
        },
        onError: (_) => _scheduleReconnect(getToken),
        onDone: () => _scheduleReconnect(getToken),
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect(getToken);
    }
  }

  void _scheduleReconnect(String? Function() getToken) {
    if (_stopped) return;
    Future.delayed(Duration(seconds: _backoffSeconds), () {
      if (_stopped) return;
      _backoffSeconds = (_backoffSeconds * 2).clamp(1, 30);
      _connect(getToken);
    });
  }

  void stop() {
    _stopped = true;
    _sub?.cancel();
    _channel?.sink.close();
  }

  void dispose() {
    stop();
    _controller.close();
  }
}
