import { io } from 'socket.io-client';

class SocketManager {
  constructor() {
    this.socket = null;
    this.listeners = {};
    this.playerName = null;
  }

  connect(url = 'http://localhost:3001') {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.socket = io(url);

    // Register all stored listeners NOW (after socket is created, before connection completes)
    for (const [event, callback] of Object.entries(this.listeners)) {
      this.socket.on(event, callback);
    }

    // If socket already connected by the time we registered listeners, log it
    if (this.socket.connected) {
      console.log('SocketManager: already connected, id:', this.socket.id);
    }

    return this.socket;
  }

  on(event, callback) {
    // Store the callback
    this.listeners[event] = callback;

    // If socket exists, register immediately
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
    this.listeners = {};
  }

  get id() {
    return this.socket ? this.socket.id : null;
  }

  get connected() {
    return this.socket ? this.socket.connected : false;
  }
}

export default new SocketManager();