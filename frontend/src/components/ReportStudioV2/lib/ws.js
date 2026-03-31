export class GatewaySocket {
  connect(url, onMessage) {
    this.disconnect();
    this.socket = new WebSocket(url);
    this.socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        onMessage(event.data);
      }
    };
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
  }
}
