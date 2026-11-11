/* 城市资本家 City Tycoon — 轻量级 WebSocket 实现
 * 无需外部依赖，使用 Node.js 原生 crypto 模块
 */

const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WebSocket {
  constructor(socket, req) {
    this.socket = socket;
    this.readyState = 1; // OPEN
    this._buffer = Buffer.alloc(0);
    this._listeners = { message: [], close: [], error: [] };

    socket.on('data', (data) => this._onData(data));
    socket.on('close', () => this._onClose());
    socket.on('error', (err) => this._onError(err));
  }

  _onData(data) {
    this._buffer = Buffer.concat([this._buffer, data]);
    while (this._parseFrame()) {}
  }

  _parseFrame() {
    if (this._buffer.length < 2) return false;

    const firstByte = this._buffer[0];
    const secondByte = this._buffer[1];

    const opcode = firstByte & 0x0f;
    const isMasked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (this._buffer.length < 4) return false;
      payloadLength = this._buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (this._buffer.length < 10) return false;
      payloadLength = this._buffer.readUInt32BE(2) * 0x100000000 + this._buffer.readUInt32BE(6);
      offset = 10;
    }

    let mask = null;
    if (isMasked) {
      if (this._buffer.length < offset + 4 + payloadLength) return false;
      mask = this._buffer.slice(offset, offset + 4);
      offset += 4;
    } else {
      if (this._buffer.length < offset + payloadLength) return false;
    }

    const payload = this._buffer.slice(offset, offset + payloadLength);

    if (isMasked) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }

    this._buffer = this._buffer.slice(offset + payloadLength);

    // 处理不同opcode
    if (opcode === 0x08) {
      // Close
      this.socket.end();
      return false;
    } else if (opcode === 0x09) {
      // Ping -> Pong
      this._sendFrame(0x0a, payload);
    } else if (opcode === 0x0a) {
      // Pong - ignore
    } else if (opcode === 0x01) {
      // Text
      const message = payload.toString('utf8');
      this._listeners.message.forEach(fn => fn(message));
    }

    return this._buffer.length > 0;
  }

  _sendFrame(opcode, data) {
    if (this.readyState !== 1) return;

    const length = data.length;
    let header;

    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(length, 6);
    }

    this.socket.write(Buffer.concat([header, data]));
  }

  send(data) {
    if (typeof data === 'string') {
      this._sendFrame(0x01, Buffer.from(data, 'utf8'));
    } else {
      this._sendFrame(0x02, data);
    }
  }

  close() {
    this.readyState = 2;
    this._sendFrame(0x08, Buffer.alloc(0));
    this.socket.end();
  }

  on(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event].push(fn);
    }
    return this;
  }

  _onClose() {
    this.readyState = 3;
    this._listeners.close.forEach(fn => fn());
  }

  _onError(err) {
    this._listeners.error.forEach(fn => fn(err));
  }
}

class Server {
  constructor(options) {
    this.options = options || {};
    this._listeners = { connection: [] };

    if (options.server) {
      options.server.on('upgrade', (req, socket, head) => this._handleUpgrade(req, socket, head));
    }
  }

  _handleUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(key + GUID)
      .digest('base64');

    const response = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      ''
    ].join('\r\n');

    socket.write(response);

    const ws = new WebSocket(socket, req);
    this._listeners.connection.forEach(fn => fn(ws, req));
  }

  on(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event].push(fn);
    }
    return this;
  }
}

module.exports = { WebSocket, Server };
