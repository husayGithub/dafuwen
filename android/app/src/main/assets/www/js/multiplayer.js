/* 城市资本家 City Tycoon — 多人联机客户端 */
(function (global) {
  'use strict';

  const D = global.CityTycoonData;
  const E = global.CityTycoonEngine;

  // 联机状态
  const Multiplayer = {
    enabled: false,
    isHost: false,
    ws: null,
    roomId: null,
    playerId: null,
    players: [],
    onStateUpdate: null,
    onPlayersUpdate: null,
    onChat: null,
    onError: null
  };

  // 生成随机房间号
  function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // 获取WebSocket服务器地址
  function getServerUrl() {
    // 优先使用localStorage中保存的地址
    const saved = localStorage.getItem('ct_server_url');
    if (saved) return saved;

    // 默认使用当前主机
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.hostname}:8080`;
  }

  // 设置服务器地址
  function setServerUrl(url) {
    localStorage.setItem('ct_server_url', url);
  }

  // 连接到服务器
  function connect(options) {
    options = options || {};
    const serverUrl = options.serverUrl || getServerUrl();
    const roomId = options.roomId || generateRoomId();
    const playerName = options.playerName || '玩家';

    return new Promise(function (resolve, reject) {
      try {
        const wsUrl = `${serverUrl.replace('http', 'ws')}/ws?room=${roomId}&name=${encodeURIComponent(playerName)}`;
        Multiplayer.ws = new WebSocket(wsUrl);

        Multiplayer.ws.onopen = function () {
          console.log('[联机] 已连接到服务器');
          Multiplayer.roomId = roomId;
          resolve({ roomId: roomId });
        };

        Multiplayer.ws.onmessage = function (event) {
          try {
            const msg = JSON.parse(event.data);
            handleMessage(msg);
          } catch (err) {
            console.error('[联机] 消息解析错误:', err);
          }
        };

        Multiplayer.ws.onclose = function () {
          console.log('[联机] 连接已断开');
          Multiplayer.enabled = false;
          if (Multiplayer.onError) Multiplayer.onError('连接已断开');
        };

        Multiplayer.ws.onerror = function (err) {
          console.error('[联机] 连接错误:', err);
          reject(err);
          if (Multiplayer.onError) Multiplayer.onError('连接失败');
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  // 处理服务器消息
  function handleMessage(msg) {
    console.log('[联机] 收到消息:', msg.type);

    switch (msg.type) {
      case 'welcome':
        Multiplayer.enabled = true;
        Multiplayer.playerId = msg.playerId;
        Multiplayer.isHost = msg.isHost;
        Multiplayer.players = msg.players || [];
        if (Multiplayer.onPlayersUpdate) Multiplayer.onPlayersUpdate(Multiplayer.players);
        break;

      case 'players_update':
        Multiplayer.players = msg.players || [];
        if (Multiplayer.onPlayersUpdate) Multiplayer.onPlayersUpdate(Multiplayer.players);
        break;

      case 'game_started':
        if (Multiplayer.onStateUpdate) Multiplayer.onStateUpdate(msg.state);
        break;

      case 'game_state':
        if (Multiplayer.onStateUpdate) Multiplayer.onStateUpdate(msg.state);
        break;

      case 'player_disconnected':
        const idx = Multiplayer.players.findIndex(p => p.id === msg.playerId);
        if (idx !== -1) {
          Multiplayer.players[idx].connected = false;
          if (Multiplayer.onPlayersUpdate) Multiplayer.onPlayersUpdate(Multiplayer.players);
        }
        break;

      case 'host_migrated':
        Multiplayer.isHost = (msg.newHostId === Multiplayer.playerId);
        if (Multiplayer.onPlayersUpdate) Multiplayer.onPlayersUpdate(Multiplayer.players);
        break;

      case 'chat':
        if (Multiplayer.onChat) Multiplayer.onChat(msg);
        break;

      case 'error':
        if (Multiplayer.onError) Multiplayer.onError(msg.message);
        break;
    }
  }

  // 发送消息
  function send(msg) {
    if (!Multiplayer.ws || Multiplayer.ws.readyState !== WebSocket.OPEN) {
      console.warn('[联机] 未连接，无法发送消息');
      return false;
    }
    Multiplayer.ws.send(JSON.stringify(msg));
    return true;
  }

  // 房主：开始游戏
  function startGame(gameState) {
    send({
      type: 'start_game',
      gameState: gameState
    });
    Multiplayer.isHost = true;
  }

  // 房主：同步游戏状态
  function syncState(gameState) {
    if (!Multiplayer.isHost) return;
    send({
      type: 'game_state',
      state: gameState
    });
  }

  // 客户端：发送玩家操作
  function sendAction(action) {
    if (Multiplayer.isHost) return;
    send({
      type: 'player_action',
      action: action
    });
  }

  // 发送聊天消息
  function sendChat(message) {
    send({
      type: 'chat',
      message: message
    });
  }

  // 断开连接
  function disconnect() {
    if (Multiplayer.ws) {
      Multiplayer.ws.close();
      Multiplayer.ws = null;
    }
    Multiplayer.enabled = false;
    Multiplayer.isHost = false;
    Multiplayer.roomId = null;
    Multiplayer.playerId = null;
    Multiplayer.players = [];
  }

  // 导出
  global.CityTycoonMultiplayer = {
    state: Multiplayer,
    connect: connect,
    disconnect: disconnect,
    startGame: startGame,
    syncState: syncState,
    sendAction: sendAction,
    sendChat: sendChat,
    setServerUrl: setServerUrl,
    getServerUrl: getServerUrl,
    generateRoomId: generateRoomId
  };

})(typeof window !== 'undefined' ? window : globalThis);
