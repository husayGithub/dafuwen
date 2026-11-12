/* 城市资本家 City Tycoon — UI 渲染层 */
(function (global) {
  'use strict';

  const D = global.CityTycoonData;
  const E = global.CityTycoonEngine;

  /* ---------- 工具函数 ---------- */
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    if (children) {
      if (typeof children === 'string') node.innerHTML = children;
      else if (Array.isArray(children)) children.forEach(function (c) { if (c) node.appendChild(c); });
      else node.appendChild(children);
    }
    return node;
  }
  function fmt(n) { return n.toLocaleString('zh-CN'); }
  function show(el) { el && el.classList.remove('hidden'); }
  function hide(el) { el && el.classList.add('hidden'); }

  /* ---------- 棋盘渲染 ---------- */
  function renderBoard(state) {
    const board = $('#board');
    if (!board) return;
    board.innerHTML = '';

    // 40格棋盘布局：11x11网格，外圈是地块，中间是城市景观
    const positions = getBoardPositions();

    for (let i = 0; i < 40; i++) {
      const tile = D.getTile(i);
      const pos = positions[i];
      const cell = createTileElement(tile, state, i);
      cell.style.gridColumn = pos.col;
      cell.style.gridRow = pos.row;
      board.appendChild(cell);
    }

    // 中心区域
    const center = el('div', { class: 'board-center' }, `
      <div class="city-cloud"></div>
      <div class="city-cloud two"></div>
      <div class="center-content">
        <div class="center-head">
          <span class="dot-live"></span>
          <span id="center-round">第 1 回合</span>
        </div>
        <div class="dice" id="dice">
          <div class="pip"></div><div class="pip"></div><div class="pip"></div>
          <div class="pip"></div><div class="pip on"></div><div class="pip"></div>
          <div class="pip"></div><div class="pip"></div><div class="pip"></div>
        </div>
        <div class="center-phase" id="center-phase">等待开始</div>
        <div class="center-log" id="center-log"></div>
      </div>
      <div class="city-scene">
        <span class="city-building">🏢</span>
        <span class="city-building">🏦</span>
        <span class="city-building">🏬</span>
        <span class="city-building">🏙️</span>
        <span class="city-building">🏨</span>
      </div>
      <div class="center-badge" id="center-badge">城市资本家</div>
    `);
    center.style.gridColumn = '2 / 11';
    center.style.gridRow = '2 / 11';
    board.appendChild(center);
  }

  function getBoardPositions() {
    // 40格在11x11网格上的位置映射（顺时针）
    const positions = [];
    // 底部行 (0-10): 从右下到左下
    for (let i = 0; i <= 10; i++) positions.push({ col: 11 - i, row: 11 });
    // 左侧列 (11-20): 从下到上
    for (let i = 1; i <= 10; i++) positions.push({ col: 1, row: 11 - i });
    // 顶部行 (21-30): 从左到右
    for (let i = 1; i <= 10; i++) positions.push({ col: 1 + i, row: 1 });
    // 右侧列 (31-39): 从上到下
    for (let i = 1; i <= 9; i++) positions.push({ col: 11, row: 1 + i });
    return positions;
  }

  function createTileElement(tile, state, index) {
    const isProperty = tile.type === 'property';
    const prop = isProperty ? D.PROPERTIES[tile.propertyId] : null;
    const propState = isProperty ? state.properties[tile.propertyId] : null;
    const group = prop ? D.GROUPS[prop.group] : null;

    let classes = 'tile tile-' + tile.type;
    if (index === 0 || index === 10 || index === 20 || index === 30) classes += ' tile-corner';

    const style = group ? `--group-color: ${group.color}` : '';
    const attrs = {
      class: classes,
      style: style,
      'data-index': index,
      onclick: function () { handleTileClick(index); }
    };
    // 添加 property ID 用于动画定位
    if (isProperty) attrs['data-property'] = tile.propertyId;
    
    const tileEl = el('button', attrs);

    // 组别色条
    if (group) {
      tileEl.appendChild(el('div', { class: 'tile-group-bar' }));
    }

    // 图标
    const icon = prop ? prop.icon : tile.icon;
    tileEl.appendChild(el('div', { class: 'tile-icon', text: icon }));

    // 名称
    const name = prop ? prop.name : tile.name;
    tileEl.appendChild(el('div', { class: 'tile-name', text: name }));

    // 价格
    if (prop) {
      tileEl.appendChild(el('div', { class: 'tile-price', text: '¥' + fmt(prop.price) }));
    }

    // 等级指示
    if (propState && propState.ownerId) {
      const levels = el('div', { class: 'tile-levels' });
      for (let i = 0; i < 3; i++) {
        levels.appendChild(el('div', { class: 'level-dot' + (i < propState.level ? ' on' : '') }));
      }
      tileEl.appendChild(levels);

      // 所有者标记
      const owner = state.players.find(p => p.id === propState.ownerId);
      if (owner) {
        const dot = el('div', {
          class: 'tile-owner-dot',
          style: `background: ${owner.color}`
        });
        tileEl.appendChild(dot);
      }

      if (propState.mortgaged) tileEl.classList.add('mortgaged');
    }

    return tileEl;
  }

  function handleTileClick(index) {
    const tile = D.getTile(index);
    const hint = $('#board-hint');
    if (tile.type === 'property') {
      const prop = D.PROPERTIES[tile.propertyId];
      if (hint) hint.textContent = `${prop.name} - ¥${fmt(prop.price)}`;
    } else {
      if (hint) hint.textContent = tile.desc || tile.name;
    }
  }

  /* ---------- 棋子渲染 ---------- */
  function renderTokens(state) {
    const layer = $('#tokens');
    if (!layer) return;
    layer.innerHTML = '';

    const positions = getBoardPositions();
    const boardWrap = $('#board-wrap');
    if (!boardWrap) return;
    const rect = boardWrap.getBoundingClientRect();
    const cellSize = rect.width / 11;

    state.players.forEach(function (player, idx) {
      if (player.status === 'bankrupt') return;
      const pos = positions[player.position];
      const x = (11 - pos.col) * cellSize + cellSize / 2;
      const y = (pos.row - 1) * cellSize + cellSize / 2;

      // 多个玩家在同一格时错开
      const offset = getTokenOffset(idx, state.players);

      const token = el('div', {
        class: 'token' + (player.id === state.currentPlayerId ? ' current' : ''),
        style: `--token-color: ${player.color}; left: ${x + offset.x}px; top: ${y + offset.y}px`,
      }, el('span', { class: 'token-avatar', text: player.avatar }));

      layer.appendChild(token);
    });
  }

  function getTokenOffset(playerIdx, players) {
    const offsets = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 0, y: 12 },
      { x: 12, y: 12 }
    ];
    return offsets[playerIdx] || { x: 0, y: 0 };
  }

  /* ---------- 玩家栏渲染 ---------- */
  function renderPlayersBar(state) {
    const bar = $('#players-bar');
    if (!bar) return;
    bar.innerHTML = '';

    state.players.forEach(function (player) {
      const netWorth = E.netWorth(state, player);
      const card = el('div', {
        class: 'player-card' +
          (player.id === state.currentPlayerId ? ' active' : '') +
          (player.status === 'bankrupt' ? ' bankrupt' : ''),
        style: `--pc-color: ${player.color}`
      });

      card.innerHTML = `
        <div class="pc-avatar">${player.avatar}</div>
        <div class="pc-info">
          <div class="pc-name">
            ${player.name}
            ${player.isAI ? '<span class="pc-ai">AI</span>' : ''}
          </div>
          <div class="pc-cash">💰 ${fmt(player.cash)}</div>
          <div class="pc-meta">
            <span>🏠 ${countProperties(state, player.id)}</span>
            ${player.debt > 0 ? '<span>💳 ' + fmt(player.debt) + '</span>' : ''}
          </div>
        </div>
        <div class="pc-right">
          <div class="pc-assets">¥${fmt(netWorth)}</div>
          ${player.id === state.currentPlayerId ? '<div class="pc-turn">当前回合</div>' : ''}
        </div>
      `;
      bar.appendChild(card);
    });
  }

  function countProperties(state, playerId) {
    return D.PROPERTY_LIST.filter(p => state.properties[p.id].ownerId === playerId).length;
  }

  /* ---------- 骰子显示 ---------- */
  function renderDice(value, rolling) {
    const dice = $('#dice');
    if (!dice) return;

    dice.classList.toggle('rolling', !!rolling);

    if (rolling || !value) {
      dice.innerHTML = '<div class="dice-num">?</div>';
      return;
    }

    // 骰子点阵布局
    const patterns = {
      1: [4],
      2: [0, 8],
      3: [0, 4, 8],
      4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8],
      6: [0, 2, 3, 5, 6, 8]
    };

    const pattern = patterns[value] || [];
    dice.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      dice.appendChild(el('div', { class: 'pip' + (pattern.includes(i) ? ' on' : '') }));
    }
  }

  /* ---------- 中心信息更新 ---------- */
  function updateCenterInfo(state) {
    const round = $('#center-round');
    const phase = $('#center-phase');
    const badge = $('#center-badge');
    const logEl = $('#center-log');

    if (round) round.textContent = `第 ${state.round} 回合`;
    if (badge) badge.textContent = state.modeName || '城市资本家';

    const cur = E.currentPlayer(state);
    if (phase && cur) {
      let text = cur.name + ' 的回合';
      if (state.phase === 'awaiting_roll') text = cur.name + ' 请掷骰子';
      else if (state.phase === 'landing') text = cur.name + ' 查看结果';
      else if (state.phase === 'action') text = cur.name + ' 可以行动了';
      else if (state.phase === 'pending') text = '处理中...';
      phase.textContent = text;
    }

    // 最近3条日志
    if (logEl) {
      const recent = state.log.slice(-3);
      logEl.innerHTML = recent.map(l => `<div>${l.text}</div>`).join('');
    }
  }

  /* ---------- 侧栏面板渲染 ---------- */
  function renderSidePanel(state) {
    renderOverviewTab(state);
    renderAssetsTab(state);
    renderMarketTab(state);
    renderActionBar(state);
  }

  function renderOverviewTab(state) {
    const pane = $('#pane-overview');
    if (!pane) return;

    const cur = E.currentPlayer(state);
    if (!cur) return;

    const turnCard = pane.querySelector('#turn-card') || el('div', { id: 'turn-card' });
    turnCard.className = 'turn-card';
    turnCard.style.setProperty('--tc-color', cur.color);
    turnCard.innerHTML = `
      <div class="turn-top">
        <div class="turn-avatar">${cur.avatar}</div>
        <div>
          <div class="turn-name">${cur.name} ${cur.isAI ? '<small>(AI)</small>' : ''}</div>
          <div class="turn-sub">现金 ¥${fmt(cur.cash)} · 总资产 ¥${fmt(E.netWorth(state, cur))}</div>
        </div>
      </div>
      <div class="turn-hint">
        ${getTurnHint(state, cur)}
      </div>
    `;

    if (!pane.querySelector('#turn-card')) {
      pane.insertBefore(turnCard, pane.firstChild);
    }

    // 迷你日志
    const miniLog = pane.querySelector('#mini-log');
    if (miniLog) {
      const recent = state.log.slice(-8).reverse();
      miniLog.innerHTML = recent.map(l => `
        <div class="log-item kind-${l.kind}">
          <span class="log-round">R${l.round}</span>
          <span class="log-text">${l.text}</span>
        </div>
      `).join('');
    }
  }

  function getTurnHint(state, player) {
    if (state.status === 'finished') return '游戏已结束';
    if (state.phase === 'awaiting_roll') return '点击 <b>掷骰子</b> 前进';
    if (state.phase === 'pending') {
      const pd = state.pending;
      if (pd.type === 'property') return '落在无主地产，可以 <b>购买</b> 或放弃';
      if (pd.type === 'bank') return '可以 <b>存款、取款、贷款</b> 或抵押地产';
      if (pd.type === 'stock') return '可以 <b>买卖股票</b>';
      if (pd.type === 'auction') return '正在 <b>拍卖</b> 中';
      if (pd.type === 'event') return '触发了 <b>随机事件</b>';
      if (pd.type === 'trade') return '正在 <b>交易</b> 中';
      if (pd.type === 'financing') return '现金不足，需要 <b>周转资金</b>';
    }
    if (state.phase === 'action') return '可以点击 <b>结束回合</b> 或继续操作';
    return '';
  }

  function renderAssetsTab(state) {
    const pane = $('#pane-assets');
    if (!pane) return;

    const cur = E.currentPlayer(state);
    if (!cur) return;

    let html = '<div class="section-title">资产概览</div>';
    html += '<div class="stat-grid">';
    html += statCard('现金', '💰', cur.cash);
    html += statCard('存款', '🏦', cur.deposit, 'emphasis');
    html += statCard('负债', '💳', cur.debt, cur.debt > 0 ? 'warn' : '');
    html += statCard('净资产', '💎', E.netWorth(state, cur), 'emphasis');
    html += '</div>';

    // 地产列表
    html += '<div class="section-title">我的地产 <span class="st-note">' +
      countProperties(state, cur.id) + ' 处</span></div>';

    const myProps = D.PROPERTY_LIST.filter(p => state.properties[p.id].ownerId === cur.id);
    if (myProps.length === 0) {
      html += '<div class="asset-empty">暂无地产，掷骰前进购买吧！</div>';
    } else {
      myProps.forEach(function (prop) {
        const conf = D.PROPERTIES[prop.id];
        const st = state.properties[prop.id];
        const group = D.GROUPS[conf.group];
        const rent = E.calcRent(state, prop.id);
        html += `
          <div class="asset-row" style="--gsoft: ${group.soft}">
            <div class="asset-icon">${prop.icon}</div>
            <div class="asset-main">
              <div class="asset-name">${prop.name}
                <span class="level-pips${st.mortgaged ? ' mortgaged' : ''}">
                  ${[0,1,2].map(i => `<i class="${i < st.level ? 'on' : ''}"></i>`).join('')}
                </span>
              </div>
              <div class="asset-sub">
                <span class="tag" style="background:${group.soft};color:${group.color}">${group.name}</span>
                <span>租金 ¥${fmt(rent)}</span>
                ${st.mortgaged ? '<span class="tag tag-warn">已抵押</span>' : ''}
              </div>
            </div>
            <div class="asset-actions">
              ${st.level < 3 && !st.mortgaged ? `<button class="btn btn-sm" data-action="upgrade" data-id="${prop.id}">升级 ¥${fmt(conf.upgradeCost)}</button>` : ''}
            </div>
          </div>
        `;
      });
    }

    // 股票持仓
    html += '<div class="section-title">股票持仓</div>';
    const stocks = Object.keys(cur.stocks).filter(sid => cur.stocks[sid] > 0);
    if (stocks.length === 0) {
      html += '<div class="asset-empty">暂无持股</div>';
    } else {
      stocks.forEach(function (sid) {
        const conf = D.STOCKS[sid];
        const shares = cur.stocks[sid];
        const value = Math.round(shares * state.stocks[sid].price);
        html += `
          <div class="asset-row" style="--gsoft: ${conf.color}20">
            <div class="asset-icon">${conf.icon}</div>
            <div class="asset-main">
              <div class="asset-name">${conf.name}</div>
              <div class="asset-sub">
                <span>${shares}股</span>
                <span>市值 ¥${fmt(value)}</span>
              </div>
            </div>
          </div>
        `;
      });
    }

    pane.innerHTML = html;

    // 绑定升级按钮
    pane.querySelectorAll('[data-action="upgrade"]').forEach(function (btn) {
      btn.onclick = function () {
        if (global.gameUI && global.gameUI.onUpgrade) {
          global.gameUI.onUpgrade(btn.dataset.id);
        }
      };
    });
  }

  function statCard(label, icon, value, extra) {
    return `<div class="stat-card ${extra || ''}">
      <div class="stat-label">${icon} ${label}</div>
      <div class="stat-value">¥${fmt(value)}</div>
    </div>`;
  }

  function renderMarketTab(state) {
    const pane = $('#pane-market');
    if (!pane) return;

    let html = '<div class="section-title">股票市场</div>';

    // 租金修改器提示
    if (state.rentModifiers.length > 0) {
      const active = state.rentModifiers.filter(m => m.expiresRound >= state.round);
      if (active.length > 0) {
        html += '<div class="market-note warn">⚡ 租金效果生效中</div>';
        active.forEach(function (m) {
          const scope = m.scope === 'all' ? '所有地产' : D.GROUPS[m.scope].name;
          const pct = (m.pct * 100).toFixed(0);
          html += `<div class="rent-mod-row">
            <span>${scope}</span>
            <span>${pct > 0 ? '+' : ''}${pct}% · 剩余${m.expiresRound - state.round + 1}回合</span>
          </div>`;
        });
      }
    }

    // 股票列表
    Object.keys(D.STOCKS).forEach(function (sid) {
      const conf = D.STOCKS[sid];
      const s = state.stocks[sid];
      const cur = E.currentPlayer(state);
      const held = cur ? (cur.stocks[sid] || 0) : 0;
      const heldValue = Math.round(held * s.price);
      const changePct = (s.change * 100).toFixed(1);
      const changeClass = s.change >= 0 ? 'up' : 'down';
      const changeSign = s.change >= 0 ? '+' : '';

      html += `
        <div class="stock-card" style="--ssoft: ${conf.color}20">
          <div class="stock-head">
            <div class="stock-icon">${conf.icon}</div>
            <div class="stock-id">
              <div class="stock-name">${conf.name}</div>
              <div class="stock-code">${conf.code} · ${conf.sectorName}</div>
            </div>
            <div class="stock-price">¥${s.price.toFixed(2)}</div>
          </div>
          <div class="stock-change ${changeClass}">${changeSign}${changePct}%</div>
          ${held > 0 ? `<div class="stock-hold"><span>持有 ${held}股</span><span>市值 ¥${fmt(heldValue)}</span></div>` : ''}
          <canvas class="sparkline" data-sid="${sid}"></canvas>
          <div class="stock-actions">
            <input type="number" class="qty-input" data-sid="${sid}" value="1" min="1" max="${Math.max(1, held)}">
            <button class="btn btn-sm btn-primary" data-action="buy-stock" data-sid="${sid}">买入</button>
            <button class="btn btn-sm btn-danger" data-action="sell-stock" data-sid="${sid}" ${held <= 0 ? 'disabled' : ''}>卖出</button>
          </div>
        </div>
      `;
    });

    pane.innerHTML = html;

    // 绘制迷你走势图
    pane.querySelectorAll('.sparkline').forEach(function (canvas) {
      drawSparkline(canvas, state.stocks[canvas.dataset.sid]);
    });

    // 绑定股票操作
    pane.querySelectorAll('[data-action="buy-stock"]').forEach(function (btn) {
      btn.onclick = function () {
        const sid = btn.dataset.sid;
        const input = pane.querySelector(`.qty-input[data-sid="${sid}"]`);
        const shares = parseInt(input.value) || 1;
        if (global.gameUI && global.gameUI.onBuyStock) {
          global.gameUI.onBuyStock(sid, shares);
        }
      };
    });

    pane.querySelectorAll('[data-action="sell-stock"]').forEach(function (btn) {
      btn.onclick = function () {
        const sid = btn.dataset.sid;
        const input = pane.querySelector(`.qty-input[data-sid="${sid}"]`);
        const shares = parseInt(input.value) || 1;
        if (global.gameUI && global.gameUI.onSellStock) {
          global.gameUI.onSellStock(sid, shares);
        }
      };
    });
  }

  function drawSparkline(canvas, stockData) {
    const ctx = canvas.getContext('2d');
    if (!ctx || !stockData.history) return;

    const w = canvas.width = canvas.offsetWidth * 2;
    const h = canvas.height = 56;
    const data = stockData.history.slice(-20);
    if (data.length < 2) return;

    const min = Math.min.apply(null, data);
    const max = Math.max.apply(null, data);
    const range = max - min || 1;

    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.strokeStyle = data[data.length - 1] >= data[0] ? '#2fa96a' : '#e45b4f';
    ctx.lineWidth = 2;

    data.forEach(function (val, i) {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((val - min) / range) * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function renderActionBar(state) {
    const bar = $('#action-bar');
    if (!bar) return;

    const cur = E.currentPlayer(state);
    if (!cur || state.status === 'finished') {
      bar.innerHTML = '';
      return;
    }

    let html = '';

    if (state.phase === 'awaiting_roll') {
      html = `<button class="btn btn-primary action-main" id="btn-roll">🎲 掷骰子</button>`;
    } else if (state.phase === 'pending') {
      const pd = state.pending;
      if (pd.type === 'property') {
        const conf = D.PROPERTIES[pd.propertyId];
        const canAfford = !!cur && cur.cash >= conf.price;
        html = `
          <div class="action-row">
            <button class="btn btn-primary" id="btn-buy" ${canAfford ? '' : 'disabled'}>购买 ¥${fmt(conf.price)}</button>
            <button class="btn btn-ghost" id="btn-decline">${canAfford ? '放弃' : '现金不足'}</button>
          </div>
        `;
      } else if (pd.type === 'bank') {
        html = `
          <div class="action-row">
            <button class="btn btn-primary" id="btn-open-bank">🏦 打开银行</button>
            <button class="btn btn-ghost" id="btn-close-pending">完成</button>
          </div>
        `;
      } else if (pd.type === 'stock') {
        html = `<button class="btn btn-ghost" id="btn-close-pending">完成买卖</button>`;
      } else if (pd.type === 'event' || pd.type === 'info' || pd.type === 'rent' || pd.type === 'tax' || pd.type === 'auctionResult') {
        html = `<button class="btn btn-primary" id="btn-close-pending">确定</button>`;
      } else if (pd.type === 'financing') {
        html = `<button class="btn btn-danger" id="btn-open-financing">💸 资金周转 (需 ¥${fmt(pd.amount)})</button>`;
      } else if (pd.type === 'auction') {
        html = `<button class="btn btn-primary" id="btn-open-auction">🔨 参与拍卖</button>`;
      } else if (pd.type === 'trade') {
        html = `<button class="btn btn-primary" id="btn-respond-trade">🤝 处理交易</button>`;
      }
    } else if (state.phase === 'action') {
      html = `
        <div class="action-row">
          <button class="btn btn-ghost" id="btn-trade">🤝 交易</button>
          <button class="btn btn-primary" id="btn-end-turn">结束回合 →</button>
        </div>
      `;
    }

    bar.innerHTML = html;

    // 绑定事件
    const rollBtn = bar.querySelector('#btn-roll');
    if (rollBtn) rollBtn.onclick = function () { if (global.gameUI && global.gameUI.onRoll) global.gameUI.onRoll(); };

    const buyBtn = bar.querySelector('#btn-buy');
    if (buyBtn) buyBtn.onclick = function () { if (global.gameUI && global.gameUI.onBuyProperty) global.gameUI.onBuyProperty(); };

    const declineBtn = bar.querySelector('#btn-decline');
    if (declineBtn) declineBtn.onclick = function () { if (global.gameUI && global.gameUI.onDeclineProperty) global.gameUI.onDeclineProperty(); };

    const closeBtn = bar.querySelector('#btn-close-pending');
    if (closeBtn) closeBtn.onclick = function () { if (global.gameUI && global.gameUI.onClosePending) global.gameUI.onClosePending(); };

    const endBtn = bar.querySelector('#btn-end-turn');
    if (endBtn) endBtn.onclick = function () { if (global.gameUI && global.gameUI.onEndTurn) global.gameUI.onEndTurn(); };

    const bankBtn = bar.querySelector('#btn-open-bank');
    if (bankBtn) bankBtn.onclick = function () { if (global.gameUI && global.gameUI.onOpenBank) global.gameUI.onOpenBank(); };

    const finBtn = bar.querySelector('#btn-open-financing');
    if (finBtn) finBtn.onclick = function () { if (global.gameUI && global.gameUI.onOpenFinancing) global.gameUI.onOpenFinancing(); };

    const auctionBtn = bar.querySelector('#btn-open-auction');
    if (auctionBtn) auctionBtn.onclick = function () { if (global.gameUI && global.gameUI.onOpenAuction) global.gameUI.onOpenAuction(); };

    const tradeBtn = bar.querySelector('#btn-trade');
    if (tradeBtn) tradeBtn.onclick = function () { if (global.gameUI && global.gameUI.onOpenTrade) global.gameUI.onOpenTrade(); };

    const respondTradeBtn = bar.querySelector('#btn-respond-trade');
    if (respondTradeBtn) respondTradeBtn.onclick = function () { if (global.gameUI && global.gameUI.onRespondTrade) global.gameUI.onRespondTrade(); };
  }

  /* ---------- 弹窗系统 ---------- */
  function showModal(content, options) {
    const root = $('#modal-root');
    const card = $('#modal-card');
    if (!root || !card) return;

    options = options || {};
    card.className = 'modal-card' + (options.wide ? ' wide' : '') + (options.narrow ? ' narrow' : '');
    card.innerHTML = content;

    show(root);

    // 关闭按钮
    const closeBtn = card.querySelector('.modal-x');
    if (closeBtn) closeBtn.onclick = hideModal;

    // 点击背景关闭
    const backdrop = root.querySelector('.modal-backdrop');
    if (backdrop && options.closable !== false) {
      backdrop.onclick = hideModal;
    }
  }

  function hideModal() {
    const root = $('#modal-root');
    if (root) hide(root);
  }

  function showPropertyModal(propertyId, state) {
    const conf = D.PROPERTIES[propertyId];
    const st = state.properties[propertyId];
    const group = D.GROUPS[conf.group];
    const owner = st.ownerId ? state.players.find(p => p.id === st.ownerId) : null;
    const rent = E.calcRent(state, propertyId);
    const detail = E.calcRentDetail(state, propertyId);

    let html = `
      <button class="modal-x">✕</button>
      <div class="modal-head">
        <div class="modal-icon-lg" style="--msoft: ${group.soft}; background: ${group.soft}">${conf.icon}</div>
        <div>
          <div class="modal-kicker" style="color: ${group.color}">${group.name}</div>
          <h3 class="modal-title">${conf.name}</h3>
        </div>
      </div>
      <div class="modal-body">
        <div class="prop-hero" style="--soft: ${group.soft}">
          <div>
            <div class="prop-group" style="--gcolor: ${group.color}">${group.name}</div>
            <div class="prop-price">¥${fmt(conf.price)} <small>地价</small></div>
          </div>
        </div>
        <table class="rent-table">
          <tr><th>等级</th><th>租金</th></tr>
          <tr><td>空地</td><td>¥0</td></tr>
          <tr class="${st.level === 0 ? 'owned' : ''}"><td>Lv1 普通住宅</td><td>¥${fmt(conf.rents[0])}</td></tr>
          <tr class="${st.level === 1 ? 'owned' : ''}"><td>Lv2 商业建筑</td><td>¥${fmt(conf.rents[1])}</td></tr>
          <tr class="${st.level === 2 ? 'owned' : ''}"><td>Lv3 高级酒店</td><td>¥${fmt(conf.rents[2])}</td></tr>
        </table>
        <div class="fact-list">
          <div class="fact-row"><span>当前等级</span><span>Lv${st.level}</span></div>
          <div class="fact-row"><span>当前租金</span><span>¥${fmt(rent)}</span></div>
          <div class="fact-row"><span>升级费用</span><span>¥${fmt(conf.upgradeCost)}</span></div>
          ${owner ? `<div class="fact-row"><span>所有者</span><span style="color:${owner.color}">${owner.name}</span></div>` : ''}
        </div>
        ${detail.monopoly ? '<div class="mono-note">🏆 垄断加成生效中，租金已翻倍！</div>' : ''}
        ${st.mortgaged ? '<div class="mono-note" style="background:#fff3e0;color:#b37a00">⚠️ 已抵押，暂停经营</div>' : ''}
      </div>
    `;
    showModal(html, { narrow: true });
  }

  function showEventModal(card, state) {
    const cat = D.EVENT_CATEGORIES[card.category];
    let html = `
      <div class="event-card" style="--ecolor: ${cat.color}">
        <span class="event-cat">${cat.icon} ${cat.name}</span>
        <h2 class="event-title">${card.title}</h2>
        <p class="event-desc">${card.desc}</p>
      </div>
      <div class="modal-foot">
        <button class="btn btn-primary btn-full" onclick="document.querySelector('#modal-root').classList.add('hidden')">确定</button>
      </div>
    `;
    showModal(html, { narrow: true });
  }

  function showBankModal(state) {
    const cur = E.currentPlayer(state);
    if (!cur) return;

    const limit = E.creditLimit(state, cur);
    const myProps = D.PROPERTY_LIST.filter(p => state.properties[p.id].ownerId === cur.id && !state.properties[p.id].mortgaged);

    let html = `
      <button class="modal-x">✕</button>
      <div class="modal-head">
        <div class="modal-icon-lg" style="--msoft: #e8f1ff">🏦</div>
        <div>
          <div class="modal-kicker">城市银行</div>
          <h3 class="modal-title">金融服务</h3>
        </div>
      </div>
      <div class="modal-body">
        <div class="bank-hero">
          <div class="bank-stat"><div class="bs-label">现金</div><div class="bs-value">¥${fmt(cur.cash)}</div></div>
          <div class="bank-stat dep"><div class="bs-label">存款</div><div class="bs-value">¥${fmt(cur.deposit)}</div></div>
          <div class="bank-stat debt"><div class="bs-label">负债</div><div class="bs-value">¥${fmt(cur.debt)}</div></div>
        </div>

        <div class="section-title">存款 / 取款</div>
        <div class="bank-form">
          <input type="number" class="input" id="bank-deposit-amt" placeholder="金额" min="100" step="100">
          <button class="btn btn-sm" id="btn-deposit">存入</button>
          <button class="btn btn-sm" id="btn-withdraw">取出</button>
        </div>

        <div class="section-title">贷款 / 还款 <span class="st-note">可贷 ¥${fmt(limit)}</span></div>
        <div class="bank-form">
          <input type="number" class="input" id="bank-loan-amt" placeholder="金额" min="100" step="100" max="${limit}">
          <button class="btn btn-sm" id="btn-loan">贷款</button>
          <button class="btn btn-sm" id="btn-repay">还款</button>
        </div>

        <div class="section-title">抵押地产 <span class="st-note">抵押率 50%</span></div>
        <div class="mortgage-list">
    `;

    if (myProps.length === 0) {
      html += '<div class="asset-empty">没有可抵押的地产</div>';
    } else {
      myProps.forEach(function (prop) {
        const conf = D.PROPERTIES[prop.id];
        html += `
          <div class="asset-row">
            <div class="asset-icon">${prop.icon}</div>
            <div class="asset-main">
              <div class="asset-name">${prop.name}</div>
              <div class="asset-sub"><span>可抵押 ¥${fmt(conf.mortgage)}</span></div>
            </div>
            <button class="btn btn-sm" data-mortgage="${prop.id}">抵押</button>
          </div>
        `;
      });
    }

    // 已抵押的地产
    const mortgaged = D.PROPERTY_LIST.filter(p => state.properties[p.id].ownerId === cur.id && state.properties[p.id].mortgaged);
    if (mortgaged.length > 0) {
      html += '<div class="section-title" style="margin-top:12px">赎回地产</div>';
      mortgaged.forEach(function (prop) {
        const conf = D.PROPERTIES[prop.id];
        html += `
          <div class="asset-row">
            <div class="asset-icon">${prop.icon}</div>
            <div class="asset-main">
              <div class="asset-name">${prop.name}</div>
              <div class="asset-sub"><span>赎回需 ¥${fmt(conf.mortgage)}</span></div>
            </div>
            <button class="btn btn-sm" data-redeem="${prop.id}">赎回</button>
          </div>
        `;
      });
    }

    html += `
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost btn-full" onclick="document.querySelector('#modal-root').classList.add('hidden')">关闭</button>
      </div>
    `;

    showModal(html, { wide: true });

    // 绑定银行操作
    setTimeout(function () {
      const card = $('#modal-card');
      if (!card) return;

      card.querySelector('#btn-deposit').onclick = function () {
        const amt = parseInt(card.querySelector('#bank-deposit-amt').value) || 0;
        if (global.gameUI && global.gameUI.onDeposit) global.gameUI.onDeposit(amt);
      };
      card.querySelector('#btn-withdraw').onclick = function () {
        const amt = parseInt(card.querySelector('#bank-deposit-amt').value) || 0;
        if (global.gameUI && global.gameUI.onWithdraw) global.gameUI.onWithdraw(amt);
      };
      card.querySelector('#btn-loan').onclick = function () {
        const amt = parseInt(card.querySelector('#bank-loan-amt').value) || 0;
        if (global.gameUI && global.gameUI.onLoan) global.gameUI.onLoan(amt);
      };
      card.querySelector('#btn-repay').onclick = function () {
        const amt = parseInt(card.querySelector('#bank-loan-amt').value) || 0;
        if (global.gameUI && global.gameUI.onRepay) global.gameUI.onRepay(amt);
      };

      card.querySelectorAll('[data-mortgage]').forEach(function (btn) {
        btn.onclick = function () {
          if (global.gameUI && global.gameUI.onMortgage) global.gameUI.onMortgage(btn.dataset.mortgage);
        };
      });
      card.querySelectorAll('[data-redeem]').forEach(function (btn) {
        btn.onclick = function () {
          if (global.gameUI && global.gameUI.onRedeem) global.gameUI.onRedeem(btn.dataset.redeem);
        };
      });
    }, 0);
  }

  function showFinancingModal(state) {
    const cur = E.currentPlayer(state);
    const pd = state.pending;
    if (!cur || !pd || pd.type !== 'financing') return;

    const need = pd.amount - cur.cash;

    let html = `
      <div class="fin-hero">
        <div class="fin-label">需要支付</div>
        <div class="fin-amount">¥${fmt(pd.amount)}</div>
        <div class="fin-status">
          <span>现金 <b>¥${fmt(cur.cash)}</b></span>
          <span>还差 <b style="color:var(--red)">¥${fmt(Math.max(0, need))}</b></span>
        </div>
      </div>
      <div class="modal-body">
        <p>现金不足！请通过以下方式筹集资金：</p>
        <div class="fin-section">
          <div class="section-title">银行存款 (¥${fmt(cur.deposit)})</div>
          <button class="btn btn-full" id="fin-withdraw" ${cur.deposit <= 0 ? 'disabled' : ''}>取出全部存款</button>
        </div>
        <div class="fin-section">
          <div class="section-title">卖出股票</div>
    `;

    const stocks = Object.keys(cur.stocks).filter(sid => cur.stocks[sid] > 0);
    if (stocks.length === 0) {
      html += '<div class="asset-empty">无股票可卖</div>';
    } else {
      stocks.forEach(function (sid) {
        const conf = D.STOCKS[sid];
        const shares = cur.stocks[sid];
        const value = Math.round(shares * state.stocks[sid].price);
        html += `
          <div class="asset-row">
            <div class="asset-icon">${conf.icon}</div>
            <div class="asset-main">
              <div class="asset-name">${conf.name}</div>
              <div class="asset-sub"><span>${shares}股 · ¥${fmt(value)}</span></div>
            </div>
            <button class="btn btn-sm" data-sell="${sid}">卖出</button>
          </div>
        `;
      });
    }

    html += `
        </div>
        <div class="fin-section">
          <div class="section-title">抵押贷款</div>
    `;

    const myProps = D.PROPERTY_LIST.filter(p => state.properties[p.id].ownerId === cur.id && !state.properties[p.id].mortgaged);
    if (myProps.length === 0) {
      html += '<div class="asset-empty">无地产可抵押</div>';
    } else {
      myProps.forEach(function (prop) {
        const conf = D.PROPERTIES[prop.id];
        html += `
          <div class="asset-row">
            <div class="asset-icon">${prop.icon}</div>
            <div class="asset-main">
              <div class="asset-name">${prop.name}</div>
              <div class="asset-sub"><span>可抵押 ¥${fmt(conf.mortgage)}</span></div>
            </div>
            <button class="btn btn-sm" data-mortgage="${prop.id}">抵押</button>
          </div>
        `;
      });
    }

    const limit = E.creditLimit(state, cur);
    html += `
        </div>
        <div class="fin-section">
          <div class="section-title">申请贷款 (可贷 ¥${fmt(limit)})</div>
          <div class="fin-loan">
            <input type="number" class="input" id="fin-loan-amt" placeholder="金额" min="100" step="100">
            <button class="btn" id="fin-loan-btn">贷款</button>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-danger" id="fin-bankrupt">宣告破产</button>
        <button class="btn btn-primary" id="fin-pay" ${cur.cash < pd.amount ? 'disabled' : ''}>支付 ¥${fmt(pd.amount)}</button>
      </div>
    `;

    showModal(html, { wide: true });

    // 绑定事件
    setTimeout(function () {
      const card = $('#modal-card');
      if (!card) return;

      card.querySelector('#fin-withdraw').onclick = function () {
        if (global.gameUI && global.gameUI.onWithdraw) global.gameUI.onWithdraw(cur.deposit);
      };
      card.querySelectorAll('[data-sell]').forEach(function (btn) {
        btn.onclick = function () {
          if (global.gameUI && global.gameUI.onSellStock) global.gameUI.onSellStock(btn.dataset.sell, cur.stocks[btn.dataset.sell]);
        };
      });
      card.querySelectorAll('[data-mortgage]').forEach(function (btn) {
        btn.onclick = function () {
          if (global.gameUI && global.gameUI.onMortgage) global.gameUI.onMortgage(btn.dataset.mortgage);
        };
      });
      card.querySelector('#fin-loan-btn').onclick = function () {
        const amt = parseInt(card.querySelector('#fin-loan-amt').value) || 0;
        if (global.gameUI && global.gameUI.onLoan) global.gameUI.onLoan(amt);
      };
      card.querySelector('#fin-pay').onclick = function () {
        if (global.gameUI && global.gameUI.onPayFinancing) global.gameUI.onPayFinancing();
      };
      card.querySelector('#fin-bankrupt').onclick = function () {
        if (global.gameUI && global.gameUI.onBankrupt) global.gameUI.onBankrupt();
      };
    }, 0);
  }

  function showAuctionModal(state) {
    const pd = state.pending;
    if (!pd || pd.type !== 'auction') return;

    const conf = D.PROPERTIES[pd.propertyId];
    const group = D.GROUPS[conf.group];
    const bidderId = pd.order[pd.index];
    const bidder = bidderId ? state.players.find(function (x) { return x.id === bidderId; }) : null;
    // 出价面向“当前指定出价人”，而非回合玩家：
    // 本地热座下拍卖常在 AI 回合触发，回合玩家恒为 AI，若按 currentPlayer 判定会导致人类看不到出价表单而死锁。
    const isMyTurn = !!(bidder && !bidder.isAI);
    const minBid = E.nextBidMinimum(pd);

    let html = `
      <button class="modal-x">✕</button>
      <div class="auction-hero">
        <div style="font-size:48px">${conf.icon}</div>
        <h3 class="modal-title">${conf.name}</h3>
        <div class="auction-sub">${group.name} · 地价 ¥${fmt(conf.price)}</div>
      </div>
      <div class="modal-body">
        <div style="text-align:center;margin:12px 0">
          <div class="auction-sub">当前最高出价</div>
          <div class="auction-bid">¥${fmt(pd.highBid || pd.minBid)}</div>
          <div class="auction-sub">${pd.highBidderId ? state.players.find(p=>p.id===pd.highBidderId).name + ' 领先' : '起拍价'}</div>
        </div>
        <div class="auction-order">
    `;

    pd.order.forEach(function (pid, idx) {
      const p = state.players.find(x => x.id === pid);
      const isCurrent = idx === pd.index;
      const hasBid = pd.bids[pid] !== undefined;
      html += `<span class="auction-chip${isCurrent ? ' current' : ''}${hasBid && pd.bids[pid] === 0 ? ' out' : ''}">${p.avatar} ${p.name}</span>`;
    });

    html += `
        </div>
        ${isMyTurn ? (
          (minBid <= bidder.cash) ? `
          <div style="margin-top:16px">
            <div class="section-title">你的出价 (最低 ¥${fmt(minBid)})</div>
            <div class="bank-form">
              <input type="number" class="input" id="auction-bid" value="${minBid}" min="${minBid}" max="${bidder.cash}" step="100">
              <button class="btn btn-primary" id="bid-btn">出价</button>
              <button class="btn btn-ghost" id="pass-btn">放弃</button>
            </div>
            <div class="small muted" style="margin-top:6px">${bidder.name} 的现金: ¥${fmt(bidder.cash)}（最高可出 ¥${fmt(bidder.cash)}）</div>
          </div>
          ` : `
          <div style="margin-top:16px">
            <div class="mono-note">现金不足（最多 ¥${fmt(bidder.cash)}），无法达到最低出价 ¥${fmt(minBid)}，本轮只能放弃。</div>
            <div style="text-align:center;margin-top:10px">
              <button class="btn btn-ghost" id="pass-btn">放弃</button>
            </div>
          </div>
          `
        ) : '<div class="mono-note">等待其他玩家出价...</div>'}
      </div>
    `;

    showModal(html, { narrow: true });

    setTimeout(function () {
      const card = $('#modal-card');
      if (!card) return;

      const bidBtn = card.querySelector('#bid-btn');
      const bidInput = card.querySelector('#auction-bid');
      if (bidBtn && bidInput) {
        const checkBid = function () {
          const v = parseInt(bidInput.value) || 0;
          bidBtn.disabled = (v < minBid || v > bidder.cash);
        };
        bidInput.oninput = checkBid;
        checkBid();
        bidBtn.onclick = function () {
          const amt = parseInt(bidInput.value) || 0;
          if (amt > bidder.cash) { showToast('现金不足，最多可出 ¥' + fmt(bidder.cash), 'error'); return; }
          if (amt < minBid) { showToast('出价不得低于 ¥' + fmt(minBid), 'error'); return; }
          if (global.gameUI && global.gameUI.onBid) global.gameUI.onBid(amt);
        };
      }
      const passBtn = card.querySelector('#pass-btn');
      if (passBtn) {
        passBtn.onclick = function () {
          if (global.gameUI && global.gameUI.onBid) global.gameUI.onBid(0);
        };
      }
    }, 0);
  }

  /* ---------- 玩家交易 ---------- */

  function showTradeModal(state) {
    const me = E.currentPlayer(state);
    if (!me) return;
    const others = state.players.filter(function (p) { return p.status === 'active' && p.id !== me.id; });
    if (others.length === 0) { showToast('没有可交易的玩家', 'error'); return; }

    function ownedProps(pid) {
      return D.PROPERTY_LIST.filter(function (p) {
        const st = state.properties[p.id];
        return st && st.ownerId === pid && !st.mortgaged;
      });
    }
    function ownedStocks(pid) {
      const p = state.players.find(function (x) { return x.id === pid; });
      if (!p) return [];
      return Object.keys(p.stocks).filter(function (s) { return p.stocks[s] > 0; });
    }

    let html = `
      <button class="modal-x">✕</button>
      <div class="modal-head"><h3 class="modal-title">🤝 发起交易</h3></div>
      <div class="modal-body">
        <p class="small muted">与 ${me.name} 交换资产（抵押中的地产不可交易）。</p>
        <div class="online-row">
          <label>交易对象</label>
          <select class="input" id="trade-target">
            ${others.map(function (p) { return `<option value="${p.id}">${p.avatar} ${p.name}</option>`; }).join('')}
          </select>
        </div>
        <div id="trade-builder"></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" id="trade-cancel">取消</button>
        <button class="btn btn-primary" id="trade-send">发起交易</button>
      </div>
    `;
    showModal(html, { wide: true });

    setTimeout(function () {
      const card = $('#modal-card');
      if (!card) return;
      const targetSel = card.querySelector('#trade-target');
      const builder = card.querySelector('#trade-builder');

      function propsSection(pid, dir) {
        const list = ownedProps(pid);
        if (!list.length) return '<div class="asset-empty">无地产</div>';
        return list.map(function (p) {
          const lvl = state.properties[p.id].level;
          return `<label class="asset-row trade-check">
            <input type="checkbox" data-${dir}-prop="${p.id}">
            <div class="asset-icon">${p.icon}</div>
            <div class="asset-main"><div class="asset-name">${p.name}${lvl > 0 ? ' · Lv' + lvl : ''}</div>
            <div class="asset-sub">地价 ¥${fmt(p.price)}</div></div>
          </label>`;
        }).join('');
      }
      function stocksSection(pid, dir) {
        const list = ownedStocks(pid);
        const owner = state.players.find(function (x) { return x.id === pid; });
        if (!list.length) return '<div class="asset-empty">无股票</div>';
        return list.map(function (sid) {
          const conf = D.STOCKS[sid];
          const sh = owner.stocks[sid];
          return `<div class="asset-row">
            <div class="asset-icon">${conf.icon}</div>
            <div class="asset-main"><div class="asset-name">${conf.name}</div>
            <div class="asset-sub">持 ${sh} 股 · 每股 ¥${fmt(state.stocks[sid].price)}</div></div>
            <input type="number" class="input trade-stock" data-${dir}-stock="${sid}" min="0" max="${sh}" value="0">
          </div>`;
        }).join('');
      }

      function render() {
        const tid = targetSel.value;
        const to = state.players.find(function (p) { return p.id === tid; });
        builder.innerHTML = `
          <div class="trade-cols">
            <div class="trade-col">
              <div class="section-title">${me.avatar} ${me.name} 给出</div>
              <div class="online-row"><label>现金</label><input type="number" class="input" id="give-cash" min="0" max="${me.cash}" value="0"></div>
              <div class="mini-title">地产</div>${propsSection(me.id, 'give')}
              <div class="mini-title">股票</div>${stocksSection(me.id, 'give')}
            </div>
            <div class="trade-col">
              <div class="section-title">${to.avatar} ${to.name} 给出</div>
              <div class="online-row"><label>现金</label><input type="number" class="input" id="get-cash" min="0" max="${to.cash}" value="0"></div>
              <div class="mini-title">地产</div>${propsSection(to.id, 'get')}
              <div class="mini-title">股票</div>${stocksSection(to.id, 'get')}
            </div>
          </div>
        `;
      }
      targetSel.onchange = render;
      render();

      card.querySelector('#trade-cancel').onclick = hideModal;
      card.querySelector('#trade-send').onclick = function () {
        const offer = {
          fromId: me.id,
          toId: targetSel.value,
          giveCash: parseInt(card.querySelector('#give-cash').value) || 0,
          getCash: parseInt(card.querySelector('#get-cash').value) || 0,
          giveProperties: Array.prototype.map.call(card.querySelectorAll('[data-give-prop]:checked'), function (el) { return el.dataset.giveProp; }),
          getProperties: Array.prototype.map.call(card.querySelectorAll('[data-get-prop]:checked'), function (el) { return el.dataset.getProp; }),
          giveStocks: {},
          getStocks: {}
        };
        card.querySelectorAll('[data-give-stock]').forEach(function (el) { const n = parseInt(el.value) || 0; if (n > 0) offer.giveStocks[el.dataset.giveStock] = n; });
        card.querySelectorAll('[data-get-stock]').forEach(function (el) { const n = parseInt(el.value) || 0; if (n > 0) offer.getStocks[el.dataset.getStock] = n; });
        if (global.gameUI && global.gameUI.onProposeTrade) global.gameUI.onProposeTrade(offer);
      };
    }, 0);
  }

  function showTradeOfferModal(state) {
    const pd = state.pending;
    if (!pd || pd.type !== 'trade' || !pd.offer) return;
    const offer = pd.offer;
    const from = state.players.find(function (p) { return p.id === offer.fromId; });
    const to = state.players.find(function (p) { return p.id === offer.toId; });
    if (!from || !to) return;

    function propNames(ids) { return ids.length ? ids.map(function (id) { return D.PROPERTIES[id].name; }).join('、') : '—'; }
    function stockNames(map) {
      const ks = Object.keys(map);
      return ks.length ? ks.map(function (s) { return D.STOCKS[s].name + '×' + map[s]; }).join('、') : '—';
    }

    const html = `
      <div class="modal-head"><h3 class="modal-title">🤝 ${to.name}，收到交易请求</h3></div>
      <div class="modal-body">
        <p><b>${from.name}</b> 向你发起如下交换：</p>
        <div class="trade-cols">
          <div class="trade-col">
            <div class="section-title">${from.name} 提供</div>
            <ul class="trade-list">
              <li>现金 ¥${fmt(offer.giveCash)}</li>
              <li>地产：${propNames(offer.giveProperties)}</li>
              <li>股票：${stockNames(offer.giveStocks)}</li>
            </ul>
          </div>
          <div class="trade-col">
            <div class="section-title">需 ${to.name} 提供</div>
            <ul class="trade-list">
              <li>现金 ¥${fmt(offer.getCash)}</li>
              <li>地产：${propNames(offer.getProperties)}</li>
              <li>股票：${stockNames(offer.getStocks)}</li>
            </ul>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" id="trade-reject">拒绝</button>
        <button class="btn btn-primary" id="trade-accept">接受</button>
      </div>
    `;
    showModal(html, { wide: true, closable: false });

    setTimeout(function () {
      const card = $('#modal-card');
      if (!card) return;
      card.querySelector('#trade-accept').onclick = function () {
        if (global.gameUI && global.gameUI.onAcceptTrade) global.gameUI.onAcceptTrade();
      };
      card.querySelector('#trade-reject').onclick = function () {
        if (global.gameUI && global.gameUI.onRejectTrade) global.gameUI.onRejectTrade();
      };
    }, 0);
  }

  function showGameOverModal(state) {
    if (!state.ranking) return;

    const medals = ['🥇', '🥈', '🥉', '4️⃣'];
    const winner = state.ranking[0];

    let html = `
      <div class="gameover-banner">
        <div class="trophy">🏆</div>
        <h2 class="gameover-title">${winner.name} 获胜！</h2>
        <div class="gameover-sub">${state.endReason === 'bankrupt' ? '其他玩家全部破产' : '回合结束，总资产最高'}</div>
      </div>
      <div class="rank-list">
    `;

    state.ranking.forEach(function (r, idx) {
      html += `
        <div class="rank-row${idx === 0 ? ' first' : ''}" style="--rc: ${r.color}">
          <div class="rank-medal">${medals[idx]}</div>
          <div class="rank-avatar">${r.avatar}</div>
          <div class="rank-main">
            <div class="rank-name">${r.name} ${r.isAI ? '<small>(AI)</small>' : ''} ${r.bankrupt ? '<small style="color:var(--red)">破产</small>' : ''}</div>
            <div class="rank-breakdown">
              现金 ¥${fmt(r.cash)} · 地产 ¥${fmt(r.propertyValue)} · 股票 ¥${fmt(r.stockValue)}${r.debt > 0 ? ' · 负债 ¥' + fmt(r.debt) : ''}
            </div>
          </div>
          <div class="rank-value">¥${fmt(r.netWorth)}<small>净资产</small></div>
        </div>
      `;
    });

    html += `
      </div>
      <div class="modal-foot">
        <button class="btn btn-primary btn-full" id="btn-back-lobby">返回大厅</button>
      </div>
    `;

    showModal(html, { wide: true });

    setTimeout(function () {
      const btn = $('#modal-card #btn-back-lobby');
      if (btn) btn.onclick = function () {
        hideModal();
        if (global.gameUI && global.gameUI.onBackToLobby) global.gameUI.onBackToLobby();
      };
    }, 0);
  }

  /* ---------- Toast 提示 ---------- */
  function showToast(message, type) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast' + (type ? ' ' + type : '');
    show(toast);
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { hide(toast); }, 2500);
  }

  /* ---------- 庆祝动画 ---------- */
  
  // 五彩纸屑 - 赢得游戏
  function showConfetti() {
    const container = el('div', { class: 'confetti-container' });
    const colors = ['#ff4757', '#ffc727', '#00c9a7', '#4a90ff', '#9b59ff', '#ff6b9d', '#2ed573', '#ff7f50'];
    for (let i = 0; i < 60; i++) {
      const piece = el('div', { class: 'confetti-piece' });
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = (2 + Math.random() * 2) + 's';
      piece.style.animationDelay = Math.random() * 0.8 + 's';
      container.appendChild(piece);
    }
    document.body.appendChild(container);
    setTimeout(function() { container.remove(); }, 5000);
  }

  // 地产购买闪光
  function flashTile(propertyId) {
    const board = $('#board');
    if (!board) return;
    const tile = board.querySelector('.tile[data-property="' + propertyId + '"]');
    if (tile) {
      tile.classList.add('tile-flash');
      setTimeout(function() { tile.classList.remove('tile-flash'); }, 600);
    }
  }

  // 金币飘出效果
  function showCoinBurst(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const burst = el('div', { class: 'coin-burst' });
    burst.style.left = (rect.left + rect.width / 2) + 'px';
    burst.style.top = (rect.top + rect.height / 2) + 'px';
    burst.style.position = 'fixed';
    
    for (let i = 0; i < 5; i++) {
      const coin = el('div', { class: 'coin-particle', text: '💰' });
      coin.style.animationDelay = (i * 0.1) + 's';
      coin.style.left = (Math.random() * 40 - 20) + 'px';
      burst.appendChild(coin);
    }
    document.body.appendChild(burst);
    setTimeout(function() { burst.remove(); }, 1200);
  }

  // 收益飘字
  function showMoneyFloat(element, amount, isPositive) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const float = el('div', { 
      class: 'money-float ' + (isPositive ? 'positive' : 'negative'),
      text: (isPositive ? '+' : '-') + '💰' + fmt(Math.abs(amount))
    });
    float.style.left = (rect.left + rect.width / 2) + 'px';
    float.style.top = rect.top + 'px';
    float.style.position = 'fixed';
    float.style.transform = 'translateX(-50%)';
    document.body.appendChild(float);
    setTimeout(function() { float.remove(); }, 1300);
  }

  // 升级星星效果
  function showLevelUpStars(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const container = el('div', { class: 'level-up-stars' });
    container.style.position = 'fixed';
    container.style.left = rect.left + 'px';
    container.style.top = rect.top + 'px';
    container.style.width = rect.width + 'px';
    container.style.height = rect.height + 'px';
    
    const starEmojis = ['⭐', '✨', '🌟', '💫'];
    for (let i = 0; i < 6; i++) {
      const star = el('div', { 
        class: 'star-particle', 
        text: starEmojis[Math.floor(Math.random() * starEmojis.length)]
      });
      star.style.left = '50%';
      star.style.top = '50%';
      star.style.setProperty('--dx', (Math.random() * 80 - 40) + 'px');
      star.style.setProperty('--dy', (Math.random() * -60 - 20) + 'px');
      star.style.animationDelay = (i * 0.08) + 's';
      container.appendChild(star);
    }
    document.body.appendChild(container);
    setTimeout(function() { container.remove(); }, 1000);
  }

  // 回合切换闪光
  function showTurnTransition() {
    const flash = el('div', { class: 'turn-transition' });
    document.body.appendChild(flash);
    setTimeout(function() { flash.remove(); }, 700);
  }

  // 骰子落地效果
  function diceLanded() {
    const dice = $('#dice');
    if (dice) {
      dice.classList.remove('rolling');
      dice.classList.add('landed');
      setTimeout(function() { dice.classList.remove('landed'); }, 400);
    }
  }

  // 棋子到达动画
  function tokenArrive(tileIndex) {
    const layer = $('#tokens');
    if (!layer) return;
    const tokens = layer.querySelectorAll('.token');
    tokens.forEach(function(t) {
      if (t.dataset.current === 'true') {
        t.classList.add('arrive');
        setTimeout(function() { t.classList.remove('arrive'); }, 500);
      }
    });
  }

  /* ---------- Tab 切换 ---------- */
  function initTabs() {
    const tabs = $$('.tabs button');
    tabs.forEach(function (tab) {
      tab.onclick = function () {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        $$('.tab-pane').forEach(p => p.classList.remove('active'));
        const target = $('#pane-' + tab.dataset.tab);
        if (target) target.classList.add('active');
      };
    });
  }

  /* ---------- 导出 ---------- */
  const UI = {
    renderBoard: renderBoard,
    renderTokens: renderTokens,
    renderPlayersBar: renderPlayersBar,
    renderDice: renderDice,
    updateCenterInfo: updateCenterInfo,
    renderSidePanel: renderSidePanel,
    showModal: showModal,
    hideModal: hideModal,
    showPropertyModal: showPropertyModal,
    showEventModal: showEventModal,
    showBankModal: showBankModal,
    showFinancingModal: showFinancingModal,
    showAuctionModal: showAuctionModal,
    showTradeModal: showTradeModal,
    showTradeOfferModal: showTradeOfferModal,
    showGameOverModal: showGameOverModal,
    showToast: showToast,
    initTabs: initTabs,
    // 动画效果
    showConfetti: showConfetti,
    flashTile: flashTile,
    showCoinBurst: showCoinBurst,
    showMoneyFloat: showMoneyFloat,
    showLevelUpStars: showLevelUpStars,
    showTurnTransition: showTurnTransition,
    diceLanded: diceLanded,
    tokenArrive: tokenArrive,
    // 工具
    $: $,
    $$: $$,
    el: el,
    fmt: fmt,
    show: show,
    hide: hide
  };

  global.CityTycoonUI = UI;
  if (typeof module !== 'undefined' && module.exports) module.exports = UI;
})(typeof window !== 'undefined' ? window : globalThis);
