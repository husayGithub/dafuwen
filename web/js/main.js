/* 城市资本家 City Tycoon — 主入口 */
(function (global) {
  'use strict';

  const D = global.CityTycoonData;
  const E = global.CityTycoonEngine;
  const AI = global.CityTycoonAI;
  const UI = global.CityTycoonUI;
  const MP = global.CityTycoonMultiplayer;

  /* ---------- 状态 ---------- */
  let gameState = null;
  let gameConfig = {
    mode: '40',
    playerCount: 4,
    players: [],
    playMode: 'local' // 'local' 或 'online'
  };
  let aiTimer = null;

  /* ---------- 大厅界面 ---------- */
  function initLobby() {
    // 游戏方式选择
    const playModeGrid = UI.$('#play-mode-grid');
    if (playModeGrid) {
      playModeGrid.querySelectorAll('.play-mode-card').forEach(function (card) {
        card.onclick = function () {
          playModeGrid.querySelectorAll('.play-mode-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          gameConfig.playMode = card.dataset.mode;
          togglePlayMode();
        };
      });
    }

    // 联机设置
    initOnlineSettings();

    // 模式选择
    const modeGrid = UI.$('#mode-grid');
    if (modeGrid) {
      modeGrid.innerHTML = '';
      Object.keys(D.MODES).forEach(function (id) {
        const mode = D.MODES[id];
        const card = UI.el('button', {
          class: 'mode-card' + (id === gameConfig.mode ? ' active' : ''),
          'data-mode': id
        });
        card.innerHTML = `
          <span class="mode-icon">${mode.icon}</span>
          <span class="mode-name">${mode.name}</span>
          <span class="mode-desc">${mode.desc}</span>
          <span class="mode-check">✓</span>
        `;
        card.onclick = function () {
          gameConfig.mode = id;
          modeGrid.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
        };
        modeGrid.appendChild(card);
      });
    }

    // 玩家人数
    const countBtns = UI.$$('#player-count button');
    countBtns.forEach(function (btn) {
      btn.onclick = function () {
        countBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        gameConfig.playerCount = parseInt(btn.dataset.count);
        renderPlayerSlots();
      };
    });

    renderPlayerSlots();

    // 开始按钮
    const startBtn = UI.$('#start-btn');
    if (startBtn) startBtn.onclick = startGame;

    // 继续按钮（如果有存档）
    const continueBtn = UI.$('#continue-btn');
    if (continueBtn && hasSaveGame()) {
      UI.show(continueBtn);
      continueBtn.onclick = loadAndContinue;
    }
  }

  function togglePlayMode() {
    const localSettings = UI.$('#local-settings');
    const onlineSettings = UI.$('#online-settings');
    const playerSettings = UI.$('#player-settings');
    const modeNote = UI.$('#panel-mode-note');

    if (gameConfig.playMode === 'online') {
      if (localSettings) localSettings.style.display = 'none';
      if (onlineSettings) onlineSettings.style.display = '';
      if (playerSettings) playerSettings.style.display = 'none';
      if (modeNote) modeNote.textContent = '局域网联机 · 多台设备一起玩';
    } else {
      if (localSettings) localSettings.style.display = '';
      if (onlineSettings) onlineSettings.style.display = 'none';
      if (playerSettings) playerSettings.style.display = '';
      if (modeNote) modeNote.textContent = '本地多人 · 一台设备轮流操作';
    }
  }

  function initOnlineSettings() {
    // 服务器地址
    const serverUrlInput = UI.$('#server-url');
    if (serverUrlInput) {
      serverUrlInput.value = MP.getServerUrl();
      serverUrlInput.onchange = function () {
        MP.setServerUrl(serverUrlInput.value);
      };
    }

    // 随机房间号按钮
    const genRoomBtn = UI.$('#btn-gen-room');
    if (genRoomBtn) {
      genRoomBtn.onclick = function () {
        const roomIdInput = UI.$('#room-id');
        if (roomIdInput) roomIdInput.value = MP.generateRoomId();
      };
    }

    // 创建房间按钮
    const createBtn = UI.$('#btn-create-room');
    if (createBtn) {
      createBtn.onclick = createRoom;
    }

    // 加入房间按钮
    const joinBtn = UI.$('#btn-join-room');
    if (joinBtn) {
      joinBtn.onclick = joinRoom;
    }

    // 设置回调
    MP.state.onPlayersUpdate = onPlayersUpdate;
    MP.state.onError = onMultiplayerError;
    MP.state.onStateUpdate = onRemoteStateUpdate;
  }

  function createRoom() {
    const serverUrl = UI.$('#server-url').value;
    const roomId = UI.$('#room-id').value || MP.generateRoomId();
    const playerName = UI.$('#player-name').value || '房主';

    updateRoomStatus('正在创建房间...', 'waiting');

    MP.connect({
      serverUrl: serverUrl,
      roomId: roomId,
      playerName: playerName
    }).then(function (result) {
      gameConfig.playMode = 'online';
      updateRoomStatus('房间已创建，等待玩家加入...', 'ready');
      UI.showToast('房间 ' + result.roomId + ' 已创建', 'success');
    }).catch(function (err) {
      updateRoomStatus('创建失败: ' + (err.message || '连接错误'), 'error');
      UI.showToast('连接失败', 'error');
    });
  }

  function joinRoom() {
    const serverUrl = UI.$('#server-url').value;
    const roomId = UI.$('#room-id').value;
    const playerName = UI.$('#player-name').value || '玩家';

    if (!roomId) {
      UI.showToast('请输入房间号', 'error');
      return;
    }

    updateRoomStatus('正在加入房间...', 'waiting');

    MP.connect({
      serverUrl: serverUrl,
      roomId: roomId.toUpperCase(),
      playerName: playerName
    }).then(function (result) {
      gameConfig.playMode = 'online';
      updateRoomStatus('已加入房间，等待房主开始游戏...', 'ready');
      UI.showToast('已加入房间', 'success');
    }).catch(function (err) {
      updateRoomStatus('加入失败: ' + (err.message || '连接错误'), 'error');
      UI.showToast('连接失败', 'error');
    });
  }

  function updateRoomStatus(message, type) {
    const status = UI.$('#room-status');
    if (!status) return;

    status.className = 'room-status' + (type === 'waiting' ? ' waiting' : type === 'error' ? ' error' : '');
    status.innerHTML = message;
    UI.show(status);
  }

  function onPlayersUpdate(players) {
    const status = UI.$('#room-status');
    if (!status) return;

    let html = `<div>房间号: <b>${MP.state.roomId}</b> · ${players.length} 位玩家</div>`;
    html += '<div class="players-list">';
    players.forEach(function (p) {
      const isHost = MP.state.isHost && p.id === MP.state.playerId;
      const cls = isHost ? 'player-chip host' : 'player-chip';
      html += `<span class="${cls}${!p.connected ? ' disconnected' : ''}">${p.name}</span>`;
    });
    html += '</div>';

    if (MP.state.isHost) {
      html += '<div style="margin-top:8px;font-size:11px">你是房主，可以开始游戏了</div>';
      // 显示开始游戏按钮
      const startBtn = UI.$('#start-btn');
      if (startBtn && players.length >= 2) {
        startBtn.style.display = '';
        startBtn.onclick = startOnlineGame;
      }
    }

    status.innerHTML = html;
  }

  function onMultiplayerError(message) {
    UI.showToast(message, 'error');
    updateRoomStatus(message, 'error');
  }

  function onRemoteStateUpdate(state) {
    // 收到房主同步的游戏状态
    if (!gameState && state) {
      gameState = state;
      switchToGameScreen();
      renderGame();
      bindGameEvents();
    } else if (gameState && state) {
      gameState = state;
      renderGame();
    }
  }

  function renderPlayerSlots() {
    const slots = UI.$('#player-slots');
    if (!slots) return;
    slots.innerHTML = '';

    for (let i = 0; i < gameConfig.playerCount; i++) {
      const defaultName = i === 0 ? '我' : '电脑 ' + i;
      const isAI = i !== 0;

      const slot = UI.el('div', {
        class: 'slot',
        style: `--slot-color: ${D.PLAYER_COLORS[i]}`
      });

      slot.innerHTML = `
        <div class="slot-avatar">${D.AVATARS[i]}</div>
        <input type="text" class="slot-name" value="${defaultName}" maxlength="12" data-idx="${i}">
        <div class="slot-type">
          <button class="${!isAI ? 'active' : ''}" data-type="human" data-idx="${i}">人类</button>
          <button class="${isAI ? 'active' : ''}" data-type="ai" data-idx="${i}">电脑</button>
        </div>
        <select class="slot-diff${isAI ? '' : ' hidden'}" data-idx="${i}">
          <option value="easy">简单</option>
          <option value="normal" selected>普通</option>
          <option value="hard">困难</option>
        </select>
      `;

      slots.appendChild(slot);
    }

    // 绑定类型切换
    slots.querySelectorAll('.slot-type button').forEach(function (btn) {
      btn.onclick = function () {
        const idx = btn.dataset.idx;
        const type = btn.dataset.type;
        const parent = btn.parentElement;
        parent.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const diffSelect = slots.querySelector(`.slot-diff[data-idx="${idx}"]`);
        if (type === 'ai') UI.show(diffSelect);
        else UI.hide(diffSelect);
      };
    });
  }

  function getPlayerConfig() {
    const slots = UI.$$('#player-slots .slot');
    const players = [];

    slots.forEach(function (slot, idx) {
      const name = slot.querySelector('.slot-name').value || ('玩家 ' + (idx + 1));
      const typeBtn = slot.querySelector('.slot-type button.active');
      const isAI = typeBtn && typeBtn.dataset.type === 'ai';
      const diffSelect = slot.querySelector('.slot-diff');
      const difficulty = diffSelect ? diffSelect.value : 'normal';

      players.push({
        name: name,
        isAI: isAI,
        difficulty: difficulty,
        color: D.PLAYER_COLORS[idx],
        avatar: D.AVATARS[idx]
      });
    });

    return players;
  }

  /* ---------- 游戏启动 ---------- */
  function startGame() {
    // 如果是联机模式，需要先连接
    if (gameConfig.playMode === 'online') {
      if (!MP.state.enabled) {
        UI.showToast('请先加入房间', 'error');
        return;
      }
      startOnlineGame();
      return;
    }

    const players = getPlayerConfig();
    if (players.length < 2) {
      UI.showToast('至少需要 2 名玩家', 'error');
      return;
    }

    try {
      gameState = E.createGame({
        mode: gameConfig.mode,
        players: players
      });

      switchToGameScreen();
      renderGame();
      bindGameEvents();
      gameLoop();
    } catch (err) {
      console.error('游戏启动失败:', err);
      UI.showToast('游戏启动失败: ' + err.message, 'error');
    }
  }

  // 联机模式：房主开始游戏
  function startOnlineGame() {
    if (!MP.state.enabled || !MP.state.isHost) {
      UI.showToast('只有房主可以开始游戏', 'error');
      return;
    }

    const onlinePlayers = MP.state.players;
    if (onlinePlayers.length < 2) {
      UI.showToast('至少需要 2 名玩家', 'error');
      return;
    }

    // 创建玩家配置：房主是人类，其他玩家也是人类（非AI）
    const players = onlinePlayers.map(function (p, idx) {
      return {
        name: p.name,
        isAI: false, // 联机模式下所有玩家都是人类
        difficulty: 'normal',
        color: D.PLAYER_COLORS[idx] || D.PLAYER_COLORS[0],
        avatar: D.AVATARS[idx] || D.AVATARS[0]
      };
    });

    try {
      gameState = E.createGame({
        mode: gameConfig.mode,
        players: players
      });

      // 同步游戏状态给所有玩家
      MP.startGame(gameState);

      switchToGameScreen();
      renderGame();
      bindGameEvents();
      gameLoop();
    } catch (err) {
      console.error('游戏启动失败:', err);
      UI.showToast('游戏启动失败: ' + err.message, 'error');
    }
  }

  function switchToGameScreen() {
    UI.$('#lobby-screen').classList.remove('active');
    UI.$('#game-screen').classList.add('active');
  }

  function switchToLobbyScreen() {
    UI.$('#game-screen').classList.remove('active');
    UI.$('#lobby-screen').classList.add('active');
    clearAITimer();
    gameState = null;
  }

  /* ---------- 游戏渲染 ---------- */
  function renderGame() {
    if (!gameState) return;

    UI.renderBoard(gameState);
    UI.renderTokens(gameState);
    UI.renderPlayersBar(gameState);
    UI.updateCenterInfo(gameState);
    UI.renderSidePanel(gameState);

    // 联机模式：同步状态给其他玩家
    if (gameConfig.playMode === 'online' && MP.state.isHost) {
      MP.syncState(gameState);
    }
  }

  /* ---------- 游戏事件绑定 ---------- */
  function bindGameEvents() {
    // UI 回调
    global.gameUI = {
      onRoll: doRoll,
      onBuyProperty: doBuyProperty,
      onDeclineProperty: doDeclineProperty,
      onClosePending: doClosePending,
      onEndTurn: doEndTurn,
      onOpenBank: doOpenBank,
      onOpenFinancing: doOpenFinancing,
      onOpenAuction: doOpenAuction,
      onOpenTrade: doOpenTrade,
      onUpgrade: doUpgrade,
      onBuyStock: doBuyStock,
      onSellStock: doSellStock,
      onDeposit: doDeposit,
      onWithdraw: doWithdraw,
      onLoan: doLoan,
      onRepay: doRepay,
      onMortgage: doMortgage,
      onRedeem: doRedeem,
      onBid: doBid,
      onPayFinancing: doPayFinancing,
      onBankrupt: doBankrupt,
      onBackToLobby: switchToLobbyScreen
    };

    // 顶部按钮
    const exportBtn = UI.$('#export-btn');
    if (exportBtn) exportBtn.onclick = saveGame;

    const quitBtn = UI.$('#quit-btn');
    if (quitBtn) quitBtn.onclick = function () {
      if (confirm('确定要返回大厅吗？当前游戏进度将自动保存。')) {
        saveGame();
        switchToLobbyScreen();
      }
    };

    // Tab 切换
    UI.initTabs();

    // 窗口大小变化时重新渲染棋子
    window.addEventListener('resize', function () {
      if (gameState) UI.renderTokens(gameState);
    });
  }

  /* ---------- 游戏操作 ---------- */
  function doRoll() {
    if (!gameState || gameState.phase !== 'awaiting_roll') return;

    // 播放骰子动画
    UI.renderDice(null, true);

    setTimeout(function () {
      const result = E.roll(gameState);
      if (result.ok) {
        UI.renderDice(result.dice, false);
        // 骰子落地效果
        UI.diceLanded();
        renderGame();
        // 棋子到达动画
        setTimeout(function() { UI.tokenArrive(); }, 300);

        // AI 继续行动
        scheduleAITurn();
      } else {
        UI.showToast(result.message, 'error');
      }
    }, 800);
  }

  function doBuyProperty() {
    if (!gameState) return;
    const pd = gameState.pending;
    if (!pd || pd.type !== 'property') return;

    const cur = E.currentPlayer(gameState);
    const result = E.buyProperty(gameState, cur.id, pd.propertyId);
    if (result.ok) {
      UI.showToast('购买成功！', 'success');
      // 购买成功动画
      UI.flashTile(pd.propertyId);
      renderGame();
      scheduleAITurn();
    } else {
      UI.showToast(result.message, 'error');
    }
  }

  function doDeclineProperty() {
    if (!gameState) return;
    E.declineProperty(gameState);
    renderGame();
    scheduleAITurn();
  }

  function doClosePending() {
    if (!gameState) return;
    E.closePending(gameState);
    renderGame();
    scheduleAITurn();
  }

  function doEndTurn() {
    if (!gameState) return;
    E.endTurn(gameState);
    // 回合切换闪光
    UI.showTurnTransition();
    renderGame();
    scheduleAITurn();
  }

  function doOpenBank() {
    if (!gameState) return;
    UI.showBankModal(gameState);
  }

  function doOpenFinancing() {
    if (!gameState) return;
    UI.showFinancingModal(gameState);
  }

  function doOpenAuction() {
    if (!gameState) return;
    UI.showAuctionModal(gameState);
    // 修复：如果第一个出价者是AI，触发AI出价
    checkAuctionAI();
  }

  function doOpenTrade() {
    if (!gameState) return;
    UI.showToast('交易功能开发中...', 'error');
  }

  function doUpgrade(propertyId) {
    if (!gameState) return;
    const cur = E.currentPlayer(gameState);
    const result = E.upgradeProperty(gameState, cur.id, propertyId);
    if (result.ok) {
      UI.showToast('升级成功！', 'success');
      // 升级星星动画
      const tileEl = document.querySelector('.tile[data-property="' + propertyId + '"]');
      UI.showLevelUpStars(tileEl);
      renderGame();
    } else {
      UI.showToast(result.message, 'error');
    }
  }

  function doBuyStock(stockId, shares) {
    if (!gameState) return;
    const cur = E.currentPlayer(gameState);
    const result = E.buyStock(gameState, cur.id, stockId, shares);
    if (result.ok) {
      UI.showToast('买入成功！', 'success');
      renderGame();
      scheduleAITurn();
    } else {
      UI.showToast(result.message, 'error');
    }
  }

  function doSellStock(stockId, shares) {
    if (!gameState) return;
    const cur = E.currentPlayer(gameState);
    const result = E.sellStock(gameState, cur.id, stockId, shares);
    if (result.ok) {
      UI.showToast('卖出成功！', 'success');
      renderGame();
      scheduleAITurn();
    } else {
      UI.showToast(result.message, 'error');
    }
  }

  function doDeposit(amount) {
    if (!gameState) return;
    const cur = E.currentPlayer(gameState);
    const result = E.deposit(gameState, cur.id, amount);
    if (result.ok) {
      UI.showToast('存款成功！', 'success');
      renderGame();
      UI.showBankModal(gameState);
    } else {
      UI.showToast(result.message, 'error');
    }
  }

  function doWithdraw(amount) {
    if (!gameState) return;
    const cur = E.currentPlayer(gameState);
    const result = E.withdraw(gameState, cur.id, amount);
    if (result.ok) {
      UI.showToast('取款成功！', 'success');
      renderGame();
      if (gameState.pending && gameState.pending.type === 'bank') {
        UI.showBankModal(gameState);
      } else if (gameState.pending && gameState.pending.type === 'financing') {
        UI.showFinancingModal(gameState);
      }
    } else {
      UI.showToast(result.message, 'error');
    }
  }

  function doLoan(amount) {
    if (!gameState) return;
    const cur = E.currentPlayer(gameState);
    const result = E.takeLoan(gameState, cur.id, amount);
    if (result.ok) {
      UI.showToast('贷款成功！', 'success');
      renderGame();
      if (gameState.pending && gameState.pending.type === 'bank') {
        UI.showBankModal(gameState);
      } else if (gameState.pending && gameState.pending.type === 'financing') {
        UI.showFinancingModal(gameState);
      }
    } else {
      UI.showToast(result.message, 'error');
    }
  }

  function doRepay(amount) {
    if (!gameState) return;
    const cur = E.currentPlayer(gameState);
    const result = E.repayLoan(gameState, cur.id, amount);
    if (result.ok) {
      UI.showToast('还款成功！', 'success');
      renderGame();
      if (gameState.pending && gameState.pending.type === 'bank') {
        UI.showBankModal(gameState);
      } else if (gameState.pending && gameState.pending.type === 'financing') {
        UI.showFinancingModal(gameState);
      }
    } else {
      UI.showToast(result.message, 'error');
    }
  }

  function doMortgage(propertyId) {
    if (!gameState) return;
    const cur = E.currentPlayer(gameState);
    const result = E.mortgageProperty(gameState, cur.id, propertyId);
    if (result.ok) {
      UI.showToast('抵押成功！', 'success');
      renderGame();
      if (gameState.pending && gameState.pending.type === 'bank') {
        UI.showBankModal(gameState);
      } else if (gameState.pending && gameState.pending.type === 'financing') {
        UI.showFinancingModal(gameState);
      }
    } else {
      UI.showToast(result.message, 'error');
    }
  }

  function doRedeem(propertyId) {
    if (!gameState) return;
    const cur = E.currentPlayer(gameState);
    const result = E.redeemProperty(gameState, cur.id, propertyId);
    if (result.ok) {
      UI.showToast('赎回成功！', 'success');
      renderGame();
      if (gameState.pending && gameState.pending.type === 'bank') {
        UI.showBankModal(gameState);
      }
    } else {
      UI.showToast(result.message, 'error');
    }
  }

  function doBid(amount) {
    if (!gameState) return;
    const cur = E.currentPlayer(gameState);
    const result = E.placeBid(gameState, cur.id, amount);
    if (result.ok) {
      renderGame();
      if (gameState.pending && gameState.pending.type === 'auction') {
        UI.showAuctionModal(gameState);
        // 修复：人类出价后，检查下一个出价者是否是AI
        checkAuctionAI();
      }
    } else {
      UI.showToast(result.message, 'error');
    }
  }

  // 修复拍卖死锁：检查拍卖状态，如果下一个出价者是AI，触发AI出价
  function checkAuctionAI() {
    if (!gameState) return;
    const pd = gameState.pending;
    if (!pd || pd.type !== 'auction') return;

    const nextPlayerId = pd.order[pd.index];
    if (!nextPlayerId) return;

    const nextPlayer = gameState.players.find(function(p) { return p.id === nextPlayerId; });
    if (nextPlayer && nextPlayer.isAI) {
      clearAITimer();
      aiTimer = setTimeout(function() {
        runAuctionAI();
      }, 800);
    }
  }

  // AI拍卖出价逻辑
  function runAuctionAI() {
    if (!gameState) return;
    const pd = gameState.pending;
    if (!pd || pd.type !== 'auction') return;

    const bidderId = pd.order[pd.index];
    const bidder = gameState.players.find(function(p) { return p.id === bidderId; });
    if (!bidder || !bidder.isAI) return;

    // 使用AI模块计算出价
    const bid = AI.chooseBid(gameState, pd, bidder, E);
    const result = E.placeBid(gameState, bidderId, bid);

    if (result.ok) {
      renderGame();
      if (gameState.pending && gameState.pending.type === 'auction') {
        UI.showAuctionModal(gameState);
        // 继续检查下一个出价者
        checkAuctionAI();
      }
    }
  }

  function doPayFinancing() {
    if (!gameState) return;
    const result = E.payFinancing(gameState);
    if (result.ok) {
      UI.showToast('支付完成！', 'success');
      UI.hideModal();
      renderGame();
      scheduleAITurn();
    } else {
      UI.showToast(result.message, 'error');
    }
  }

  function doBankrupt() {
    if (!gameState) return;
    if (!confirm('确定要宣告破产吗？这将结束你的游戏。')) return;
    const cur = E.currentPlayer(gameState);
    E.declareBankrupt(gameState, cur.id);
    UI.hideModal();
    renderGame();
    checkGameOver();
  }

  /* ---------- AI 驱动 ---------- */
  function gameLoop() {
    if (!gameState || gameState.status !== 'playing') return;

    const cur = E.currentPlayer(gameState);
    if (!cur) return;

    if (cur.isAI) {
      scheduleAITurn();
    }
  }

  function scheduleAITurn() {
    clearAITimer();
    if (!gameState || gameState.status !== 'playing') return;

    const cur = E.currentPlayer(gameState);
    if (!cur || !cur.isAI) return;

    aiTimer = setTimeout(function () {
      runAIStep();
    }, 800);
  }

  function runAIStep() {
    if (!gameState || gameState.status !== 'playing') return;

    const cur = E.currentPlayer(gameState);
    if (!cur || !cur.isAI) return;

    const result = AI.step(gameState, E);

    if (result.done) {
      checkGameOver();
      return;
    }

    renderGame();

    // 检查是否需要显示弹窗
    if (gameState.pending) {
      const pd = gameState.pending;
      if (pd.type === 'event' && pd.card) {
        UI.showEventModal(pd.card, gameState);
      } else if (pd.type === 'auction') {
        UI.showAuctionModal(gameState);
      }
    }

    // 继续 AI 行动
    if (!result.waiting && gameState.status === 'playing') {
      const nextCur = E.currentPlayer(gameState);
      if (nextCur && nextCur.isAI) {
        scheduleAITurn();
      }
    }

    checkGameOver();
  }

  function clearAITimer() {
    if (aiTimer) {
      clearTimeout(aiTimer);
      aiTimer = null;
    }
  }

  /* ---------- 游戏结束检查 ---------- */
  function checkGameOver() {
    if (!gameState) return;
    if (gameState.status === 'finished') {
      // 赢得游戏！五彩纸屑庆祝
      UI.showConfetti();
      UI.showGameOverModal(gameState);
    }
  }

  /* ---------- 存档系统 ---------- */
  function hasSaveGame() {
    try {
      return !!localStorage.getItem('citytycoon_save');
    } catch (e) {
      return false;
    }
  }

  function saveGame() {
    if (!gameState) return;
    try {
      localStorage.setItem('citytycoon_save', JSON.stringify(gameState));
      UI.showToast('游戏已保存', 'success');
    } catch (e) {
      console.error('保存失败:', e);
      UI.showToast('保存失败', 'error');
    }
  }

  function loadAndContinue() {
    try {
      const data = localStorage.getItem('citytycoon_save');
      if (!data) {
        UI.showToast('没有找到存档', 'error');
        return;
      }
      gameState = JSON.parse(data);
      switchToGameScreen();
      renderGame();
      bindGameEvents();
      gameLoop();
      UI.showToast('游戏已恢复', 'success');
    } catch (e) {
      console.error('加载存档失败:', e);
      UI.showToast('加载存档失败', 'error');
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    initLobby();
  }

  // DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 导出
  global.CityTycoonMain = {
    startGame: startGame,
    saveGame: saveGame,
    loadGame: loadAndContinue
  };
})(typeof window !== 'undefined' ? window : globalThis);
