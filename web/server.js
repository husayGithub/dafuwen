#!/usr/bin/env node
/* 城市资本家 City Tycoon — 多人联机服务器
 * 房主运行此服务器，其他玩家通过局域网连接。
 * 飞机上使用：一台手机开热点，其他手机连接后访问此服务器。
 * 
 * 使用方法：
 *   node server.js
 *   或
 *   node server.js --port 8080
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// 解析命令行参数
const args = process.argv.slice(2);
let port = 8080;
const portIdx = args.indexOf('--port');
if (portIdx !== -1 && args[portIdx + 1]) {
  port = parseInt(args[portIdx + 1]) || 8080;
}

// MIME 类型映射
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// WebSocket 相关
const WebSocket = require('./ws-mini');

// 游戏状态
const rooms = new Map();

// HTTP 服务器
const server = http.createServer(function (req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  // API 路由
  if (pathname === '/api/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rooms: Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      playerCount: r.players.length,
      maxPlayers: r.maxPlayers,
      status: r.status
    })) }));
    return;
  }

  // 静态文件服务
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(__dirname, pathname);

  // 安全检查
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// WebSocket 服务器
const wss = new WebSocket.Server({ server });

wss.on('connection', function (ws, req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get('room');
  const playerName = url.searchParams.get('name') || '玩家';

  if (!roomId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少房间号' }));
    ws.close();
    return;
  }

  // 获取或创建房间
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      name: playerName + ' 的房间',
      players: [],
      maxPlayers: 4,
      status: 'waiting',
      gameState: null,
      hostId: null
    };
    rooms.set(roomId, room);
  }

  // 检查房间是否已满
  if (room.players.length >= room.maxPlayers) {
    ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
    ws.close();
    return;
  }

  // 生成玩家ID
  const playerId = 'p' + (room.players.length + 1);

  // 添加玩家
  const player = {
    id: playerId,
    name: playerName,
    ws: ws,
    connected: true
  };
  room.players.push(player);

  // 第一个玩家是房主
  if (!room.hostId) {
    room.hostId = playerId;
  }

  console.log(`[房间 ${roomId}] ${playerName} (${playerId}) 加入，当前 ${room.players.length} 人`);

  // 发送欢迎消息
  ws.send(JSON.stringify({
    type: 'welcome',
    playerId: playerId,
    isHost: room.hostId === playerId,
    roomId: roomId,
    players: room.players.map(p => ({ id: p.id, name: p.name, connected: p.connected }))
  }));

  // 广播玩家列表更新
  broadcastToRoom(room, {
    type: 'players_update',
    players: room.players.map(p => ({ id: p.id, name: p.name, connected: p.connected }))
  }, playerId);

  // 如果游戏已开始，发送游戏状态
  if (room.gameState && room.status === 'playing') {
    ws.send(JSON.stringify({
      type: 'game_state',
      state: room.gameState
    }));
  }

  // 处理消息
  ws.on('message', function (data) {
    try {
      const msg = JSON.parse(data);
      handleMessage(room, player, msg);
    } catch (err) {
      console.error('消息解析错误:', err);
    }
  });

  // 处理断开连接
  ws.on('close', function () {
    player.connected = false;
    console.log(`[房间 ${roomId}] ${playerName} 断开连接`);

    broadcastToRoom(room, {
      type: 'player_disconnected',
      playerId: playerId
    });

    // 如果房主断开，尝试迁移
    if (room.hostId === playerId) {
      const newHost = room.players.find(p => p.connected);
      if (newHost) {
        room.hostId = newHost.id;
        broadcastToRoom(room, {
          type: 'host_migrated',
          newHostId: newHost.id
        });
        console.log(`[房间 ${roomId}] 房主迁移到 ${newHost.name}`);
      } else {
        // 所有人都断开，删除房间
        rooms.delete(roomId);
        console.log(`[房间 ${roomId}] 所有人断开，房间已删除`);
      }
    }
  });
});

function handleMessage(room, player, msg) {
  console.log(`[房间 ${room.id}] 收到 ${player.name} 的消息:`, msg.type);

  switch (msg.type) {
    case 'start_game': {
      // 只有房主可以开始游戏
      if (room.hostId !== player.id) {
        player.ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始游戏' }));
        return;
      }
      room.status = 'playing';
      room.gameState = msg.gameState;
      broadcastToRoom(room, {
        type: 'game_started',
        state: room.gameState
      });
      break;
    }

    case 'game_state': {
      // 房主同步游戏状态
      if (room.hostId !== player.id) return;
      room.gameState = msg.state;
      broadcastToRoom(room, {
        type: 'game_state',
        state: room.gameState
      }, player.id);
      break;
    }

    case 'player_action': {
      // 玩家操作转发给房主
      if (room.hostId === player.id) return;
      const host = room.players.find(p => p.id === room.hostId && p.connected);
      if (host) {
        host.ws.send(JSON.stringify({
          type: 'player_action',
          playerId: player.id,
          action: msg.action
        }));
      }
      break;
    }

    case 'chat': {
      broadcastToRoom(room, {
        type: 'chat',
        playerId: player.id,
        name: player.name,
        message: msg.message
      });
      break;
    }

    default:
      console.log('未知消息类型:', msg.type);
  }
}

function broadcastToRoom(room, msg, excludeId) {
  const data = JSON.stringify(msg);
  room.players.forEach(function (p) {
    if (p.connected && p.id !== excludeId) {
      try {
        p.ws.send(data);
      } catch (err) {
        console.error('广播失败:', err);
      }
    }
  });
}

// 启动服务器
server.listen(port, '0.0.0.0', function () {
  const interfaces = getLocalIPs();
  console.log('');
  console.log('🏙️  城市资本家 - 多人联机服务器');
  console.log('================================');
  console.log(`服务器地址: http://localhost:${port}`);
  console.log('');
  console.log('局域网地址（其他设备使用）:');
  interfaces.forEach(function (ip) {
    console.log(`  http://${ip}:${port}`);
  });
  console.log('');
  console.log('💡 飞机上使用提示:');
  console.log('  1. 一台手机开启热点');
  console.log('  2. 其他手机连接该热点');
  console.log('  3. 使用上面显示的局域网地址访问');
  console.log('');
  console.log('按 Ctrl+C 停止服务器');
  console.log('================================');
});

// 获取本地IP地址
function getLocalIPs() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const results = [];

  Object.keys(interfaces).forEach(function (name) {
    interfaces[name].forEach(function (iface) {
      if (iface.family === 'IPv4' && !iface.internal) {
        results.push(iface.address);
      }
    });
  });

  if (results.length === 0) {
    results.push('127.0.0.1');
  }
  return results;
}
