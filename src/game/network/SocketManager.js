import { io } from 'socket.io-client';

class SocketManager {
  constructor() {
    this.socket = null;
    this.listeners = {};
    this.playerName = null;
  }

  connect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    // Connect directly to game server - CORS is already enabled
    this.socket = io('http://localhost:3001', {
      transports: ['websocket', 'polling']
    });

    for (const [event, callback] of Object.entries(this.listeners)) {
      this.socket.on(event, callback);
    }

    return this.socket;
  }

  on(event, callback) {
    this.listeners[event] = callback;
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  off(event) {
    delete this.listeners[event];
    if (this.socket) {
      this.socket.off(event);
    }
  }

  emit(event, data) {
    if (this.socket) {
      this.socket.emit(event, data);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    // DON'T clear this.listeners — preserve callbacks across reconnects
  }

  get id() {
    return this.socket ? this.socket.id : null;
  }

  get connected() {
    return this.socket ? this.socket.connected : false;
  }
}

export default new SocketManager();