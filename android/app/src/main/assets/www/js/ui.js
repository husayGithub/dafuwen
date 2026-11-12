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

  /* 骰子显示状态：renderBoard 会整体重建中心区，点数需要跨重渲染保留 */
  let diceState = { gameId: null, value: null, rolling: false };

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
        <div class="center-stage">
          <div class="dice" id="dice"></div>
          <div class="center-phase" id="center-phase">等待开始</div>
        </div>
        <div class="center-log" id="center-log"></div>
      </div>
      <canvas class="city-3d" id="city-3d" aria-hidden="true"></canvas>
      <div class="center-badge" id="center-badge">城市资本家</div>
    `);
    center.style.gridColumn = '2 / 11';
    center.style.gridRow = '2 / 11';
    board.appendChild(center);

    /* 中心区是新建的，按上一帧的骰子状态还原；换局（gameId 变）则回到「待掷」态 */
    const gid = state && state.gameId;
    if (gid !== diceState.gameId) {
      diceState = { gameId: gid, value: null, rolling: false };
    }
    renderDice(diceState.value, diceState.rolling);

    syncBoardMetrics();
    // 中心 3D 城市：跟随地产建设等级长高
    renderCity(state);
  }

  /* 按实测棋盘宽度推算单格尺寸，写入 --cell 供地块/棋子/中心区共用 */
  function syncBoardMetrics() {
    const board = $('#board');
    const wrap = $('#board-wrap');
    if (!board || !wrap) return;
    const ring = parseFloat(getComputedStyle(board).getPropertyValue('--ring')) || 1.85;
    const units = 9 + 2 * ring;
    const cell = wrap.getBoundingClientRect().width / units;
    if (cell > 0) wrap.style.setProperty('--cell', cell.toFixed(2) + 'px');
    // 地块信息密度：格子太小时把名称/价格/等级收进详情弹窗，只留色条+图标+归属点
    if (cell > 0 && board) {
      const density = cell < 38 ? 'compact' : (cell < 52 ? 'cozy' : 'roomy');
      if (board.dataset.density !== density) board.dataset.density = density;
    }
  }

  /* ---------- 中心 3D 城市（等轴测 canvas，随建设等级长高） ---------- */
  const cityAnim = { heights: {}, gameId: null, raf: 0, state: null, bound: false };

  // 颜色明暗：k>0 提亮，k<0 压暗
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
    else { r *= (1 + k); g *= (1 + k); b *= (1 + k); }
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  }

  function cityTarget(state, pid) {
    const prop = state.properties[pid];
    // 未售出也给一栋小房子，否则中心区空荡荡只剩地基
    if (!prop || !prop.ownerId) return 0.4;
    return Math.max(0.78, 0.55 + (prop.level || 0) * 0.75);
  }

  function renderCity(state) {
    const cv = $('#city-3d');
    if (!cv || !state || !D || !D.PROPERTY_LIST) return;
    if (cityAnim.raf) { global.cancelAnimationFrame(cityAnim.raf); cityAnim.raf = 0; }
    cityAnim.state = state;
    if (!cityAnim.bound) {
      cityAnim.bound = true;
      global.addEventListener('resize', function () {
        if (cityAnim.state) renderCity(cityAnim.state);
      });
    }

    // 四个街区各占一个 3×2 小网格，拼成等轴测城市
    const groups = ['res', 'com', 'fin', 'cbd'];
    const items = [];
    groups.forEach(function (g, gi) {
      (D.PROPERTY_LIST || []).filter(function (p) { return p.group === g; }).forEach(function (p, pi) {
        const gx = (gi % 2) * 3.7 + (pi % 3);
        const gy = Math.floor(gi / 2) * 2.7 + Math.floor(pi / 3);
        items.push({
          pid: p.id,
          ux: gx - gy,
          uy: (gx + gy) * 0.5,
          group: g,
          color: (D.GROUPS[g] && D.GROUPS[g].color) || '#8aa0bd',
          target: cityTarget(state, p.id)
        });
      });
    });
    if (!items.length) return;

    // 换局：直接落到目标高度，不播生长动画
    const gid = state.gameId || null;
    const instant = cityAnim.gameId !== gid;
    cityAnim.gameId = gid;
    items.forEach(function (it) {
      if (instant || cityAnim.heights[it.pid] === undefined) cityAnim.heights[it.pid] = it.target;
    });

    // 业主颜色：楼顶亮灯，一眼看出地盘归属
    const ownerColor = {};
    (state.players || []).forEach(function (pl) { ownerColor[pl.id] = pl.color; });
    items.forEach(function (it) {
      const prop = state.properties[it.pid];
      it.owner = prop && prop.ownerId ? ownerColor[prop.ownerId] : null;
      // 未售出的地块用中性灰蓝，与已开发地块形成对比
      if (!it.owner) it.color = '#b9c6d6';
    });

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    items.forEach(function (it) {
      minX = Math.min(minX, it.ux); maxX = Math.max(maxX, it.ux);
      minY = Math.min(minY, it.uy); maxY = Math.max(maxY, it.uy);
    });

    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let tries = 0;
    function draw() {
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (!w || !h) {
        // 棋盘还在隐藏容器里时拿不到尺寸，最多重试 30 帧
        if (tries++ < 30) cityAnim.raf = global.requestAnimationFrame(draw);
        return;
      }
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // 拟合：水平推出画面，垂直多留楼高底部天际线基线接近底边
      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);
      // 中心图案整体收小：把视觉重心让给放大后的外圈图标
      const s = Math.min((w * 0.82) / (spanX + 1.2), (h * 0.5) / (spanY + 1.4));
      if (!isFinite(s) || s <= 0) return;
      const halfW = Math.max(3.5, s * 0.42);
      const halfD = Math.max(2, s * 0.21);
      const ox = w / 2 - ((minX + maxX) / 2) * s;
      let oy = h * 0.86 - ((minY + maxY) / 2) * s;
      // 最近一排会落到画布下沿，整体上移避免被裁掉
      const bottom = oy + maxY * s + halfD + 3;
      if (bottom > h) oy -= (bottom - h);

      // 由远及近绘制，保证近处楼挡住远处楼
      items.slice().sort(function (a, b) { return a.uy - b.uy; }).forEach(function (it) {
        const bx = ox + it.ux * s;
        const by = oy + it.uy * s;
        const lv = cityAnim.heights[it.pid] || 0;
        // 占地收小后楼高比例略提，保证缩小后仍读得出“楼”而不是地基片
        const hh = lv > 0.02 ? Math.max(2, lv * s * 0.8) : 0;

        // 地基：菱形草坪
        ctx.beginPath();
        ctx.moveTo(bx, by - halfD);
        ctx.lineTo(bx + halfW, by);
        ctx.lineTo(bx, by + halfD);
        ctx.lineTo(bx - halfW, by);
        ctx.closePath();
        ctx.fillStyle = it.owner ? 'rgba(120, 150, 120, .34)' : 'rgba(110, 140, 118, .2)';
        ctx.fill();

        if (hh > 0) {
          // 左面 / 右面（朝向观察者的两个侧面）
          ctx.beginPath();
          ctx.moveTo(bx - halfW, by - hh);
          ctx.lineTo(bx, by + halfD - hh);
          ctx.lineTo(bx, by + halfD);
          ctx.lineTo(bx - halfW, by);
          ctx.closePath();
          ctx.fillStyle = shade(it.color, -0.16);
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(bx + halfW, by - hh);
          ctx.lineTo(bx, by + halfD - hh);
          ctx.lineTo(bx, by + halfD);
          ctx.lineTo(bx + halfW, by);
          ctx.closePath();
          ctx.fillStyle = shade(it.color, -0.36);
          ctx.fill();

          // 顶面：业主色亮灯，未售出用组色提亮
          ctx.beginPath();
          ctx.moveTo(bx, by - halfD - hh);
          ctx.lineTo(bx + halfW, by - hh);
          ctx.lineTo(bx, by + halfD - hh);
          ctx.lineTo(bx - halfW, by - hh);
          ctx.closePath();
          ctx.fillStyle = it.owner ? shade(it.owner, 0.18) : shade(it.color, 0.34);
          ctx.fill();

          // 窗光（楼够高才画，否则会糊成一片）
          if (hh > s * 0.42 && halfW > 5) {
            const rows = Math.min(4, Math.max(1, Math.round(hh / (s * 0.22))));
            ctx.fillStyle = 'rgba(255, 246, 208, .72)';
            const ww = Math.max(1, halfW * 0.3);
            const wh = Math.max(1, s * 0.05);
            for (let r = 1; r <= rows; r++) {
              const yy = by - (hh * r) / (rows + 1);
              ctx.fillRect(bx - halfW * 0.58, yy, ww, wh);
              ctx.fillRect(bx + halfW * 0.28, yy - halfD * 0.3, ww, wh);
            }
          }
        }
      });

      // 高度缓动，收敛后自动停帧
      let moving = false;
      items.forEach(function (it) {
        const cur = cityAnim.heights[it.pid];
        const d = it.target - cur;
        if (Math.abs(d) > 0.01) { cityAnim.heights[it.pid] = cur + d * 0.16; moving = true; }
        else cityAnim.heights[it.pid] = it.target;
      });
      cityAnim.raf = moving ? global.requestAnimationFrame(draw) : 0;
    }

    draw();
  }

  /* 地块所在边：0/10/20/30 为四角，其余分属下左右上四条边 */
  function tileSide(index) {
    if (index === 0) return ' corner-br';
    if (index < 10) return ' side-bottom';
    if (index === 10) return ' corner-bl';
    if (index < 20) return ' side-left';
    if (index === 20) return ' corner-tl';
    if (index < 30) return ' side-top';
    if (index === 30) return ' corner-tr';
    return ' side-right';
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

    let classes = 'tile tile-' + tile.type + tileSide(index);
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

    // 名称与价格成组，便于按边切换横排/竖排
    const text = el('div', { class: 'tile-text' });
    const name = prop ? prop.name : tile.name;
    text.appendChild(el('div', { class: 'tile-name', text: name }));
    if (prop) {
      text.appendChild(el('div', { class: 'tile-price', text: '¥' + fmt(prop.price) }));
    }
    tileEl.appendChild(text);

    // 等级指示
    if (propState && propState.ownerId) {
      const levels = el('div', { class: 'tile-levels' });
      for (let i = 0; i < 3; i++) {
        levels.appendChild(el('div', { class: 'level-dot' + (i < propState.level ? ' on' : '') }));
      }
      tileEl.appendChild(levels);

      // 已建设的地产加金色等级角标，远看也能认出建筑规模
      if (propState.level > 0) {
        tileEl.appendChild(el('span', { class: 'tile-lv', text: 'Lv' + propState.level }));
      }

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
    let text;
    if (tile.type === 'property') {
      const prop = D.PROPERTIES[tile.propertyId];
      text = `${prop.name} - ¥${fmt(prop.price)}`;
    } else {
      text = tile.desc || tile.name;
    }
    if (hint) hint.textContent = text;
    // 窄屏下提示条不显示，改用 toast，避免点击地块后没有任何反馈
    if (!hint || hint.offsetParent === null) showToast(text);
  }

  /* ---------- 棋子渲染 ---------- */
  const TOKEN_STEP_MS = 110;   // 逐格位移节奏，配合 .token 的 left/top .14s 补间得到连续滑动
  const TOKEN_MAX_STEPS = 12;  // 单骰最大步数，超过则视为状态跳变，直接落位
  let tokenAnim = null;        // 互斥锁：{ playerId, dest, index, node, tileEls, boardWrap, playerIdx, timer }
  const lastTokenPos = {};     // playerId -> 已落定的格子序号
  let tokenGameId = null;

  function stopTokenAnim() {
    if (!tokenAnim) return;
    if (tokenAnim.timer) clearTimeout(tokenAnim.timer);
    const node = tokenAnim.node;
    tokenAnim = null;
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  /* 实测地块矩形定位，兼容外圈加粗后的不等宽网格；每步重新实测，缩放后自动校准 */
  function positionToken(tokenEl, boardWrap, tileEls, index, playerIdx) {
    const tileEl = tileEls[index];
    if (!tileEl || !tokenEl) return;
    const wrapRect = boardWrap.getBoundingClientRect();
    const r = tileEl.getBoundingClientRect();
    const unit = Math.min(r.width, r.height);
    const offset = getTokenOffset(playerIdx, unit);
    tokenEl.style.left = (r.left - wrapRect.left + r.width / 2 + offset.x).toFixed(1) + 'px';
    tokenEl.style.top = (r.top - wrapRect.top + r.height / 2 + offset.y).toFixed(1) + 'px';
  }

  /* 环形前进：棋盘 index 递增方向即移动方向 */
  function forwardSteps(from, to, total) {
    return (to - from + total) % total;
  }

  function pulseToken(node, cls, ms) {
    if (!node) return;
    node.classList.add(cls);
    setTimeout(function () { node.classList.remove(cls); }, ms);
  }

  function walkStep(ctx) {
    ctx.timer = null;
    if (!tokenAnim || !ctx.node.parentNode) return;
    const total = ctx.tileEls.length || 40;
    ctx.index = (ctx.index + 1) % total;
    positionToken(ctx.node, ctx.boardWrap, ctx.tileEls, ctx.index, ctx.playerIdx);
    // 每格一记小跳，配合 left/top 补间形成“走一步跳一下”
    pulseToken(ctx.node, 'hop', 200);
    if (ctx.index === 0) pulseToken(ctx.node, 'pass-start', 600);
    if (ctx.index === ctx.dest) {
      lastTokenPos[ctx.playerId] = ctx.dest;
      pulseToken(ctx.node, 'arrive', 500);
      tokenAnim = null;
      return;
    }
    ctx.timer = setTimeout(function () { walkStep(ctx); }, TOKEN_STEP_MS);
  }

  function renderTokens(state) {
    const board = $('#board');
    const layer = $('#tokens');
    const boardWrap = $('#board-wrap');
    if (!layer || !board || !boardWrap) return;

    syncBoardMetrics();

    // 换了一局：清空位移缓存与进行中的动画
    if (tokenGameId !== state.gameId) {
      tokenGameId = state.gameId || null;
      stopTokenAnim();
      Object.keys(lastTokenPos).forEach(function (k) { delete lastTokenPos[k]; });
    }

    const tileEls = board.querySelectorAll('.tile');

    // 引擎又移动了 / 状态回退 / 玩家破产：放弃动画，本轮按最终态瞬时落位
    if (tokenAnim) {
      const animPlayer = state.players.filter(function (p) { return p.id === tokenAnim.playerId; })[0];
      if (!animPlayer || animPlayer.status === 'bankrupt' || animPlayer.position !== tokenAnim.dest) {
        stopTokenAnim();
      } else {
        // 棋盘重建后旧的节点集合已失效，刷新为当前测量对象
        tokenAnim.tileEls = tileEls;
        tokenAnim.boardWrap = boardWrap;
      }
    }

    // 只移除非动画中的棋子；正在走步的元素必须原位保留，否则重新插入会打断 left/top 补间
    Array.prototype.slice.call(layer.childNodes).forEach(function (node) {
      if (tokenAnim && node === tokenAnim.node) return;
      layer.removeChild(node);
    });

    state.players.forEach(function (player, idx) {
      if (player.status === 'bankrupt') return;
      const destEl = tileEls[player.position];
      if (!destEl) return;

      if (tokenAnim && tokenAnim.playerId === player.id) return;

      const unit = Math.min(destEl.getBoundingClientRect().width, destEl.getBoundingClientRect().height);
      const size = Math.max(14, unit * 0.42);
      const token = el('div', {
        class: 'token' + (player.id === state.currentPlayerId ? ' current' : ''),
        'data-token-player': player.id,
        style: `--token-color: ${player.color}; --token-size: ${size.toFixed(1)}px`
      }, el('span', { class: 'token-avatar', text: player.avatar }));
      layer.appendChild(token);

      const prev = lastTokenPos[player.id];
      const steps = prev === undefined ? 0 : forwardSteps(prev, player.position, tileEls.length || 40);
      const canWalk = player.id === state.currentPlayerId
        && prev !== undefined
        && prev !== player.position
        && steps > 0 && steps <= TOKEN_MAX_STEPS
        && !prefersReducedMotion();

      if (canWalk) {
        positionToken(token, boardWrap, tileEls, prev, idx);
        const ctx = {
          playerId: player.id, playerIdx: idx, node: token,
          boardWrap: boardWrap, tileEls: tileEls,
          from: prev, dest: player.position, index: prev, timer: null
        };
        tokenAnim = ctx;
        ctx.timer = setTimeout(function () { walkStep(ctx); }, TOKEN_STEP_MS);
      } else {
        positionToken(token, boardWrap, tileEls, player.position, idx);
        lastTokenPos[player.id] = player.position;
      }
    });
  }

  function getTokenOffset(playerIdx, unit) {
    const d = unit * 0.16;
    const offsets = [
      { x: -d, y: -d },
      { x: d, y: -d },
      { x: -d, y: d },
      { x: d, y: d }
    ];
    return offsets[playerIdx] || { x: 0, y: 0 };
  }

  /* ---------- 玩家栏渲染 ---------- */
  // 净资产上一次的值：驱动 flash-up / flash-down 脉冲，换局按 gameId 重置
  const pcFlash = { gameId: null, net: {} };

  function renderPlayersBar(state) {
    const bar = $('#players-bar');
    if (!bar) return;
    bar.innerHTML = '';
    // 按人数等分，取消横向滚动；窄屏由 CSS 强制两列
    bar.style.setProperty('--pc-cols', state.players.length);

    if (pcFlash.gameId !== state.gameId) {
      pcFlash.gameId = state.gameId || null;
      pcFlash.net = {};
    }

    state.players.forEach(function (player) {
      const netWorth = E.netWorth(state, player);
      const prevNet = pcFlash.net[player.id];
      pcFlash.net[player.id] = netWorth;
      // 首次观测不闪烁，只在实际变动的渲染补上脉冲
      const flashCls = prevNet === undefined || netWorth === prevNet
        ? ''
        : (netWorth > prevNet ? ' flash-up' : ' flash-down');
      const card = el('div', {
        class: 'player-card' +
          (player.id === state.currentPlayerId ? ' active' : '') +
          (player.status === 'bankrupt' ? ' bankrupt' : '') +
          flashCls,
        style: `--pc-color: ${player.color}`,
        'data-player': player.id
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
      card.onclick = function () { showPlayerDetailModal(state, player.id); };
      bar.appendChild(card);
    });

    renderTopIdentity(state);
  }

  /* 顶栏身份与金额：跟玩家栏一起刷新，避免多出渲染入口 */
  function renderTopIdentity(state) {
    const cur = E.currentPlayer(state);
    const avatarEl = $('#tb-avatar');
    const nameEl = $('#tb-name');
    if (avatarEl) {
      avatarEl.textContent = cur ? cur.avatar : '🎩';
      avatarEl.style.setProperty('--pc-color', cur ? cur.color : 'rgba(255, 255, 255, .85)');
    }
    if (nameEl) nameEl.textContent = cur ? cur.name : '城市资本家';
    animateNumber($('#tb-cash'), cur ? cur.cash : 0);
    animateNumber($('#tb-net'), cur ? E.netWorth(state, cur) : 0);
  }

  /* 金额滚动：rAF + easeOutCubic；data-num 缓存相同值时不重播 */
  function animateNumber(node, to, dur) {
    if (!node) return;
    const target = Math.round(to) || 0;
    const cached = node.dataset.num;
    node.dataset.num = String(target);
    if (cached === String(target)) return;

    const from = cached === undefined ? target : (parseInt(cached, 10) || 0);
    if (from === target || prefersReducedMotion()) {
      node.textContent = '¥' + fmt(target);
      return;
    }

    if (node._numRaf) cancelAnimationFrame(node._numRaf);
    const duration = dur || 650;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = '¥' + fmt(Math.round(from + (target - from) * eased));
      if (t < 1) node._numRaf = requestAnimationFrame(step);
      else node._numRaf = null;
    }
    node._numRaf = requestAnimationFrame(step);
  }

  function prefersReducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* 玩家详情：纯只读展示，不触发任何引擎写操作 */
  function showPlayerDetailModal(state, playerId) {
    const player = state.players.filter(p => p.id === playerId)[0];
    if (!player) return;

    const props = D.PROPERTY_LIST.filter(p => state.properties[p.id].ownerId === playerId);
    const rentTotal = props.reduce(function (sum, p) { return sum + E.calcRent(state, p.id); }, 0);
    const stocks = Object.keys(player.stocks).filter(sid => player.stocks[sid] > 0);

    let html = `
      <div class="modal-head">
        <div class="modal-icon-lg" style="--msoft: ${player.color}22; background: ${player.color}22">${player.avatar}</div>
        <div>
          <div class="modal-kicker" style="color: ${player.color}">${player.isAI ? 'AI 对手' : '玩家'} · 净资产 ¥${fmt(E.netWorth(state, player))}</div>
          <h3 class="modal-title">${player.name}</h3>
        </div>
        <button class="modal-x">✕</button>
      </div>
      <div class="stat-grid">
        ${statCard('现金', '💰', player.cash)}
        ${statCard('存款', '🏦', player.deposit, 'emphasis')}
        ${statCard('负债', '💳', player.debt, player.debt > 0 ? 'warn' : '')}
        ${statCard('租金收入', '🏠', rentTotal, 'emphasis')}
      </div>
      <div class="section-title">持有地产 <span class="st-note">${props.length} 处</span></div>
    `;

    if (props.length === 0) {
      html += '<div class="asset-empty">暂无地产</div>';
    } else {
      props.forEach(function (prop) {
        const conf = D.PROPERTIES[prop.id];
        const st = state.properties[prop.id];
        html += assetRow(prop, st, conf, D.GROUPS[conf.group], E.calcRent(state, prop.id), '');
      });
    }

    html += '<div class="section-title">股票持仓</div>';
    if (stocks.length === 0) {
      html += '<div class="asset-empty">暂无持股</div>';
    } else {
      stocks.forEach(function (sid) {
        html += stockRow(D.STOCKS[sid], player.stocks[sid], state.stocks[sid].price);
      });
    }

    html += `<div class="action-hint" style="margin-top:12px">${
      player.status === 'bankrupt' ? '该玩家已破产退出'
        : (player.id === state.currentPlayerId ? '正在其回合中' : '点击自己或对手的玩家卡片可随时查看资产')
    }</div>`;

    showModal(html, { wide: true });
  }

  function countProperties(state, playerId) {
    return D.PROPERTY_LIST.filter(p => state.properties[p.id].ownerId === playerId).length;
  }

  /* ---------- 骰子显示 ---------- */
  // 六面点阵
  const DICE_PIPS = {
    1: [4], 2: [0, 8], 3: [0, 4, 8],
    4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
  };
  // 把目标面转到朝向观察者，再叠加 -24/-32 的展示倾角（对面点数和为 7）
  // 倾角过小时侧面只有几像素，看不出立体，24°/32° 能稳定露出两个面
  const DICE_ROT = {
    1: [-24, -32], 2: [-114, -32], 3: [-24, -122],
    4: [-24, 58], 5: [66, -32], 6: [-24, 148]
  };

  /* 首次渲染时把平面骰子升级成 6 面立方体；之后只改转角度，不重建 DOM */
  function buildDiceCube(dice) {
    if (dice.dataset.cube === '1') return;
    let html = '<div class="dice-cube">';
    for (let v = 1; v <= 6; v++) {
      html += '<div class="dice-face f' + v + '">';
      for (let i = 0; i < 9; i++) {
        html += '<div class="pip' + (DICE_PIPS[v].indexOf(i) >= 0 ? ' on' : '') + '"></div>';
      }
      html += '</div>';
    }
    html += '</div><div class="dice-num">?</div>';
    dice.innerHTML = html;
    dice.dataset.cube = '1';
  }

  function renderDice(value, rolling) {
    /* 先记状态：即使此刻中心区还没挂载，重渲染时也能回放 */
    diceState.value = value || null;
    diceState.rolling = !!rolling;

    const dice = $('#dice');
    if (!dice) return;

    buildDiceCube(dice);
    dice.classList.toggle('rolling', !!rolling);

    const cube = dice.querySelector('.dice-cube');
    const num = dice.querySelector('.dice-num');
    const rot = DICE_ROT[value] || null;

    // 滚动中、或已出点数 → 收起「?」面
    if (num) num.classList.toggle('hidden', !!(rolling || rot));
    if (!cube) return;
    if (rolling) return;              // 滚动角度交给 diceRoll3d
    if (rot) {
      cube.style.setProperty('--rx', rot[0] + 'deg');
      cube.style.setProperty('--ry', rot[1] + 'deg');
    } else {
      // 待掷：立方体回正，与「?」面完全重叠
      cube.style.setProperty('--rx', '0deg');
      cube.style.setProperty('--ry', '0deg');
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

    // 最近4条日志
    if (logEl) {
      const recent = state.log.slice(-4);
      logEl.innerHTML = recent.map(l => `<div>${l.text}</div>`).join('');
    }
  }

  /* ---------- 侧栏面板渲染 ---------- */
  function renderSidePanel(state) {
    renderOverviewTab(state);
    renderAssetsTab(state);
    renderMarketTab(state);
    renderActionBar(state);
    renderDock(state);
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
    html += statCard('现金', '💰', cur.cash, '', pk(cur, 'cash'));
    html += statCard('存款', '🏦', cur.deposit, 'emphasis', pk(cur, 'deposit'));
    html += statCard('负债', '💳', cur.debt, cur.debt > 0 ? 'warn' : '', pk(cur, 'debt'));
    html += statCard('净资产', '💎', E.netWorth(state, cur), 'emphasis', pk(cur, 'net'));
    html += '</div>';

    // 地产列表
    html += '<div class="section-title" id="assets-props-section">我的地产 <span class="st-note">' +
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
        let actions = '';
        if (st.mortgaged) {
          actions = '';
        } else if (st.level >= 3) {
          actions = '<span class="tag tag-max">满级</span>';
        } else {
          const affordable = cur.cash >= conf.upgradeCost;
          actions = `<button class="btn btn-sm" data-action="upgrade" data-id="${prop.id}"${affordable ? '' : ' disabled title="现金不足"'}>升级 ¥${fmt(conf.upgradeCost)}</button>`;
        }
        html += assetRow(prop, st, conf, group, rent, actions);
      });
    }

    // 股票持仓
    html += '<div class="section-title">股票持仓</div>';
    const stocks = Object.keys(cur.stocks).filter(sid => cur.stocks[sid] > 0);
    if (stocks.length === 0) {
      html += '<div class="asset-empty">暂无持股</div>';
    } else {
      stocks.forEach(function (sid) {
        html += stockRow(D.STOCKS[sid], cur.stocks[sid], state.stocks[sid].price);
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

  /* 资产卡增量缓存：只在同一玩家同一指标上比较，切换玩家时首轮不显示箭头 */
  const statPrev = {};
  function pk(player, key) { return 'p' + player.id + ':' + key; }

  function statCard(label, icon, value, extra, memoKey) {
    const v = Math.round(value) || 0;
    let deltaHtml = '';
    if (memoKey) {
      const prev = statPrev[memoKey];
      statPrev[memoKey] = v;
      if (prev !== undefined && prev !== v) {
        const diff = v - prev;
        deltaHtml = `<span class="stat-delta ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'}${fmt(Math.abs(diff))}</span>`;
      }
    }
    return `<div class="stat-card ${extra || ''}">
      <div class="stat-top">
        <span class="stat-ring">${icon}</span>
        <span class="stat-label">${label}</span>
        ${deltaHtml}
      </div>
      <div class="stat-value">¥${fmt(v)}</div>
    </div>`;
  }

  /* 地产行模板：资产 tab 与玩家详情弹窗共用，actions 传空串即只读展示 */
  function assetRow(prop, st, conf, group, rent, actionsHtml) {
    return `
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
        ${actionsHtml ? `<div class="asset-actions">${actionsHtml}</div>` : ''}
      </div>
    `;
  }

  /* 持股行模板：同样两处共用 */
  function stockRow(conf, shares, price) {
    const value = Math.round(shares * price);
    return `
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
  }

  function renderMarketTab(state) {
    const pane = $('#pane-market');
    if (!pane) return;

    const cur = E.currentPlayer(state);
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
      const held = cur ? (cur.stocks[sid] || 0) : 0;
      const heldValue = Math.round(held * s.price);
      const changePct = (s.change * 100).toFixed(1);
      const changeClass = s.change >= 0 ? 'up' : 'down';
      const changeSign = s.change >= 0 ? '+' : '';
      const maxBuy = cur ? Math.max(1, Math.floor(cur.cash / s.price)) : 1;

      html += `
        <div class="stock-card" style="--ssoft: ${conf.color}20">
          <div class="stock-head">
            <div class="stock-icon">${conf.icon}</div>
            <div class="stock-id">
              <div class="stock-name">${conf.name}</div>
              <div class="stock-code">${conf.code} · ${conf.sectorName}</div>
            </div>
            <div class="stock-quote">
              <div class="stock-price">¥${s.price.toFixed(2)}</div>
              <div class="stock-change ${changeClass}">${changeSign}${changePct}%</div>
            </div>
          </div>
          ${held > 0 ? `<div class="stock-hold"><span>持有 ${held}股</span><span>市值 ¥${fmt(heldValue)}</span></div>` : ''}
          <canvas class="sparkline" data-sid="${sid}"></canvas>
          <div class="qty-chips" data-sid="${sid}">
            <button type="button" class="chip" data-qty="1">1 股</button>
            <button type="button" class="chip" data-qty="5">5 股</button>
            <button type="button" class="chip" data-qty="10">10 股</button>
            <button type="button" class="chip" data-qty="max">最大 ${maxBuy}</button>
          </div>
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

    // 快捷数量筹码：只写 .qty-input 的 value，不引入新回调
    pane.querySelectorAll('.qty-chips').forEach(function (group) {
      const sid = group.dataset.sid;
      const input = pane.querySelector('.qty-input[data-sid="' + sid + '"]');
      if (!input) return;
      group.querySelectorAll('.chip').forEach(function (chip) {
        chip.onclick = function () {
          let n = chip.dataset.qty;
          if (n === 'max') n = cur ? Math.max(1, Math.floor(cur.cash / state.stocks[sid].price)) : 1;
          else n = parseInt(n, 10) || 1;
          input.value = n;
        };
      });
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

  /* 涨跌色统一取自设计 token，读不到时回落原值 */
  function themeColor(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
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
    const up = data[data.length - 1] >= data[0];
    const line = up ? themeColor('--gain', '#2fa96a') : themeColor('--loss', '#e45b4f');

    ctx.clearRect(0, 0, w, h);

    // 折线下方渐变填充
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, hexAlpha(line, 0.28));
    fill.addColorStop(1, hexAlpha(line, 0));

    const points = data.map(function (val, i) {
      return {
        x: (i / (data.length - 1)) * w,
        y: h - ((val - min) / range) * (h - 8) - 4
      };
    });

    ctx.beginPath();
    points.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    points.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // 末点高亮
    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x - 2, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = line;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(last.x - 2, last.y, 5.5, 0, Math.PI * 2);
    ctx.strokeStyle = hexAlpha(line, 0.35);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* #rrggbb / rgb() / 颜色名 → 带透明度的 rgba，无法解析时回落半透明白 */
  function hexAlpha(color, alpha) {
    const c = String(color).trim();
    const m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) {
      const n = parseInt(m[1], 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
    }
    const rgb = /rgba?\(([^)]+)\)/.exec(c);
    if (rgb) {
      const parts = rgb[1].split(',').map(function (s) { return parseFloat(s); });
      return 'rgba(' + parts[0] + ',' + parts[1] + ',' + parts[2] + ',' + alpha + ')';
    }
    return 'rgba(136,150,176,' + alpha + ')';
  }

  function renderActionBar(state) {
    const bar = $('#action-bar');
    if (!bar) return;

    const cur = E.currentPlayer(state);
    if (!cur || state.status === 'finished') {
      bar.innerHTML = '';
      const gone = $('#game-screen');
      if (gone) { gone.classList.remove('has-confirm'); gone.style.removeProperty('--confirm-h'); }
      return;
    }

    let html = '';

    if (state.phase === 'awaiting_roll') {
      html = `<button class="btn btn-primary action-main" id="btn-roll">🎲 掷骰子</button>`;
    } else if (state.phase === 'pending') {
      const pd = state.pending;
      if (pd.type === 'property') {
        const conf = D.PROPERTIES[pd.propertyId];
        const group = D.GROUPS[conf.group];
        const canAfford = !!cur && cur.cash >= conf.price;
        html = `
          <div class="confirm-card" style="--group-color: ${group.color}">
            <div class="confirm-ico">${conf.icon}</div>
            <div class="confirm-text">
              <div class="confirm-name">${conf.name}</div>
              <div class="confirm-sub">
                <span class="tag" style="background:${group.soft};color:${group.color}">${group.name}</span>
                <span>最高 Lv3</span>
              </div>
            </div>
            <div class="confirm-price${canAfford ? '' : ' short'}">¥${fmt(conf.price)}</div>
          </div>
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

    // 移动端确认条是浮层，需要实测高度给页面底部留出对应空间
    const screen = $('#game-screen');
    if (screen) {
      screen.classList.toggle('has-confirm', !!html);
      if (!html) {
        screen.style.removeProperty('--confirm-h');
      } else {
        requestAnimationFrame(function () {
          const h = Math.ceil(bar.getBoundingClientRect().height);
          if (h > 0) screen.style.setProperty('--confirm-h', h + 'px');
        });
      }
    }
  }

  /* ---------- 底部快捷 Dock ---------- */
  const DOCK_ITEMS = [
    { key: 'roll', icon: '🎲', label: '掷骰' },
    { key: 'build', icon: '🏗', label: '建设' },
    { key: 'stock', icon: '📈', label: '股票' },
    { key: 'bank', icon: '🏦', label: '银行' },
    { key: 'asset', icon: '💼', label: '资产' },
    { key: 'end', icon: '⏭', label: '结束' }
  ];
  // DOM 只建一次：否则每回合重建会让金色呼吸动画从头重播
  let dockBuilt = false;

  function renderDock(state) {
    const dock = $('#dock');
    if (!dock) return;

    if (!dockBuilt) {
      dock.innerHTML = '';
      DOCK_ITEMS.forEach(function (item) {
        dock.appendChild(el('button', {
          class: 'dock-btn',
          type: 'button',
          'data-dock': item.key,
          'aria-label': item.label,
          html: `<span class="dock-ico">${item.icon}</span><span>${item.label}</span>`
        }));
      });
      dockBuilt = true;
    }

    const playing = state.status !== 'finished';
    const cur = E.currentPlayer(state);
    const canRoll = playing && state.phase === 'awaiting_roll';
    const canEnd = playing && state.phase === 'action';
    const owned = cur ? countProperties(state, cur.id) : 0;

    // 可用性只依据 state.phase，与操作区按钮保持一致，不引入座位/AI 判断
    updateDockBtn('roll', canRoll, 'dock-gold' + (canRoll ? ' dock-ready' : ''));
    updateDockBtn('build', playing && owned > 0, '');
    updateDockBtn('stock', playing, '');
    updateDockBtn('bank', playing, '');
    updateDockBtn('asset', playing, '');
    updateDockBtn('end', canEnd, canEnd ? 'dock-primary' : '');

    function updateDockBtn(key, enabled, variant) {
      const btn = dock.querySelector('[data-dock="' + key + '"]');
      if (!btn) return;
      btn.disabled = !enabled;
      btn.className = 'dock-btn' + (variant ? ' ' + variant : '');
      btn.onclick = function () { onDockAction(key); };
    }
  }

  /* 复用现有 tab 切换：initTabs 用的是 onclick 属性赋值，click() 能正常触发 */
  function switchTab(name) {
    const btn = $('#tabs button[data-tab="' + name + '"]');
    if (btn && !btn.classList.contains('active')) btn.click();
  }

  function onDockAction(key) {
    const ui = global.gameUI || {};
    if (key === 'roll') { if (ui.onRoll) ui.onRoll(); }
    else if (key === 'end') { if (ui.onEndTurn) ui.onEndTurn(); }
    else if (key === 'bank') { if (ui.onOpenBank) ui.onOpenBank(); }
    else if (key === 'stock') switchTab('market');
    else if (key === 'asset') switchTab('assets');
    else if (key === 'build') {
      switchTab('assets');
      const anchor = $('#assets-props-section');
      if (anchor) anchor.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start'
      });
    }
  }

  /* ---------- 弹窗系统 ---------- */
  // 弹窗打开时锁定页面滚动；关闭后恢复到原位置（移动端整页滚动，桌面 #game-screen 不滚动）
  let savedScrollY = 0;
  function setModalScrollLock(on) {
    const html = global.document.documentElement;
    if (!html) return;
    if (on) {
      if (html.classList.contains('modal-open')) return;
      savedScrollY = global.pageYOffset || html.scrollTop || 0;
      html.classList.add('modal-open');
    } else {
      if (!html.classList.contains('modal-open')) return;
      html.classList.remove('modal-open');
      global.scrollTo(0, savedScrollY);
    }
  }

  function showModal(content, options) {
    const root = $('#modal-root');
    const card = $('#modal-card');
    if (!root || !card) return;

    options = options || {};
    card.className = 'modal-card'
      + (options.wide ? ' wide' : '')
      + (options.narrow ? ' narrow' : '')
      + (options.danger ? ' danger' : '');
    card.innerHTML = content;

    show(root);
    setModalScrollLock(true);
    // 抽屉内容从顶部开始查看
    card.scrollTop = 0;

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
    if (!root) return;
    hide(root);
    setModalScrollLock(false);
  }

  /* 快捷额度胶囊：只写入目标 input，不引入新回调；onChange 用于同步按钮 disabled 态 */
  function bindAmountChips(root, onChange) {
    if (!root) return;
    root.querySelectorAll('.field-chips').forEach(function (group) {
      const input = root.querySelector('#' + group.dataset.chipsFor);
      if (!input) return;
      group.querySelectorAll('.chip').forEach(function (chip) {
        chip.onclick = function () {
          const v = chip.dataset.amt;
          input.value = (v === 'max') ? (parseInt(input.dataset.maxVal, 10) || 0) : (parseInt(v, 10) || 0);
          if (onChange) onChange();
        };
      });
    });
  }

  function showPropertyModal(propertyId, state) {
    const conf = D.PROPERTIES[propertyId];
    const st = state.properties[propertyId];
    const group = D.GROUPS[conf.group];
    const owner = st.ownerId ? state.players.find(p => p.id === st.ownerId) : null;
    const rent = E.calcRent(state, propertyId);
    const detail = E.calcRentDetail(state, propertyId);

    let html = `
      <div class="modal-head">
        <div class="modal-icon-lg" style="--msoft: ${group.soft}; background: ${group.soft}">${conf.icon}</div>
        <div>
          <div class="modal-kicker" style="color: ${group.color}">${group.name}</div>
          <h3 class="modal-title">${conf.name}</h3>
        </div>
        <button class="modal-x">✕</button>
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

  /* 事件卡收益倾向：汇总卡面效果的正负，用于 --gain / --loss 着色 */
  function eventTone(card) {
    const e = (card && card.effect) || {};
    let score = 0;
    if (typeof e.amount === 'number') score += e.amount;
    if (typeof e.cash === 'number') score += e.cash;
    if (typeof e.pct === 'number') score += (e.type === 'pctCash' ? -Math.abs(e.pct) : e.pct);
    if (score > 0) return 'gain';
    if (score < 0) return 'loss';
    return '';
  }

  function showEventModal(card, state) {
    const cat = D.EVENT_CATEGORIES[card.category];
    const tone = eventTone(card);
    let html = `
      <div class="event-card${tone ? ' ' + tone : ''}" style="--ecolor: ${cat.color}">
        <span class="event-cat">${cat.icon} ${cat.name}</span>
        <h2 class="event-title">${card.title}</h2>
        <p class="event-desc">${card.desc}</p>
      </div>
      <div class="modal-foot">
        <button class="btn btn-primary btn-full" onclick="CityTycoonUI.hideModal()">确定</button>
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
      <div class="modal-head">
        <div class="modal-icon-lg" style="--msoft: #e8f1ff">🏦</div>
        <div>
          <div class="modal-kicker">城市银行</div>
          <h3 class="modal-title">金融服务</h3>
        </div>
        <button class="modal-x">✕</button>
      </div>
      <div class="modal-body">
        <div class="bank-hero">
          <div class="bank-stat"><div class="bs-label">现金</div><div class="bs-value">¥${fmt(cur.cash)}</div></div>
          <div class="bank-stat dep"><div class="bs-label">存款</div><div class="bs-value">¥${fmt(cur.deposit)}</div></div>
          <div class="bank-stat debt"><div class="bs-label">负债</div><div class="bs-value">¥${fmt(cur.debt)}</div></div>
        </div>

        <div class="section-title">存款 / 取款</div>
        <div class="bank-form">
          <div class="field">
            <div class="field-label"><span>金额</span><span class="fl-note">现金 ¥${fmt(cur.cash)}</span></div>
            <div class="field-wrap">
              <input type="number" class="input" id="bank-deposit-amt" placeholder="0" min="100" step="100" data-max-val="${cur.cash}">
              <span class="field-suffix">元</span>
            </div>
            <div class="field-chips" data-chips-for="bank-deposit-amt">
              <button type="button" class="chip" data-amt="500">500</button>
              <button type="button" class="chip" data-amt="1000">1千</button>
              <button type="button" class="chip" data-amt="5000">5千</button>
              <button type="button" class="chip" data-amt="max">全部</button>
            </div>
          </div>
          <div class="field-actions">
            <button class="btn btn-sm btn-primary" id="btn-deposit">存入</button>
            <button class="btn btn-sm btn-ghost" id="btn-withdraw">取出</button>
          </div>
        </div>

        <div class="section-title">贷款 / 还款 <span class="st-note">可贷 ¥${fmt(limit)}</span></div>
        <div class="bank-form">
          <div class="field">
            <div class="field-label"><span>金额</span><span class="fl-note">负债 ¥${fmt(cur.debt)}</span></div>
            <div class="field-wrap">
              <input type="number" class="input" id="bank-loan-amt" placeholder="0" min="100" step="100" max="${limit}" data-max-val="${limit}">
              <span class="field-suffix">元</span>
            </div>
            <div class="field-chips" data-chips-for="bank-loan-amt">
              <button type="button" class="chip" data-amt="1000">1千</button>
              <button type="button" class="chip" data-amt="5000">5千</button>
              <button type="button" class="chip" data-amt="max">可贷额度</button>
            </div>
          </div>
          <div class="field-actions">
            <button class="btn btn-sm btn-primary" id="btn-loan">贷款</button>
            <button class="btn btn-sm btn-ghost" id="btn-repay">还款</button>
          </div>
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
            <button class="btn btn-sm btn-ghost" data-mortgage="${prop.id}">抵押</button>
          </div>
        `;
      });
    }

    // 已抵押的地产
    const mortgaged = D.PROPERTY_LIST.filter(p => state.properties[p.id].ownerId === cur.id && state.properties[p.id].mortgaged);
    if (mortgaged.length > 0) {
      html += '<div class="section-title">赎回地产</div>';
      mortgaged.forEach(function (prop) {
        const conf = D.PROPERTIES[prop.id];
        html += `
          <div class="asset-row">
            <div class="asset-icon">${prop.icon}</div>
            <div class="asset-main">
              <div class="asset-name">${prop.name}</div>
              <div class="asset-sub"><span>赎回需 ¥${fmt(conf.mortgage)}</span></div>
            </div>
            <button class="btn btn-sm btn-primary" data-redeem="${prop.id}">赎回</button>
          </div>
        `;
      });
    }

    html += `
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost btn-full" onclick="CityTycoonUI.hideModal()">关闭</button>
      </div>
    `;

    showModal(html, { wide: true });

    // 绑定银行操作
    setTimeout(function () {
      const card = $('#modal-card');
      if (!card) return;

      bindAmountChips(card);

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
      <div class="modal-head">
        <div class="modal-icon-lg" style="--msoft: #ffe4de">💸</div>
        <div>
          <div class="modal-kicker" style="color:#dc2626">资金周转</div>
          <h3 class="modal-title">紧急筹款</h3>
        </div>
      </div>
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
            <button class="btn btn-sm btn-primary" data-sell="${sid}">卖出</button>
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
            <button class="btn btn-sm btn-ghost" data-mortgage="${prop.id}">抵押</button>
          </div>
        `;
      });
    }

    const limit = E.creditLimit(state, cur);
    html += `
        </div>
        <div class="fin-section">
          <div class="section-title">申请贷款 <span class="st-note">可贷 ¥${fmt(limit)}</span></div>
          <div class="fin-loan">
            <div class="field">
              <div class="field-label"><span>金额</span><span class="fl-note">还差 ¥${fmt(Math.max(0, need))}</span></div>
              <div class="field-wrap">
                <input type="number" class="input" id="fin-loan-amt" placeholder="0" min="100" step="100" max="${limit}" data-max-val="${limit}">
                <span class="field-suffix">元</span>
              </div>
              <div class="field-chips" data-chips-for="fin-loan-amt">
                <button type="button" class="chip" data-amt="1000">1千</button>
                <button type="button" class="chip" data-amt="5000">5千</button>
                <button type="button" class="chip" data-amt="max">可贷额度</button>
              </div>
            </div>
            <div class="field-actions">
              <button class="btn btn-primary" id="fin-loan-btn">贷款</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-danger" id="fin-bankrupt">宣告破产</button>
        <button class="btn btn-primary" id="fin-pay" ${cur.cash < pd.amount ? 'disabled' : ''}>支付 ¥${fmt(pd.amount)}</button>
      </div>
    `;

    showModal(html, { wide: true, danger: true });

    // 绑定事件
    setTimeout(function () {
      const card = $('#modal-card');
      if (!card) return;

      bindAmountChips(card);

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
      <div class="auction-hero">
        <button class="modal-x">✕</button>
        <div class="auction-ico">${conf.icon}</div>
        <h3 class="modal-title">${conf.name}</h3>
        <div class="auction-sub">${group.name} · 地价 ¥${fmt(conf.price)}</div>
      </div>
      <div class="modal-body">
        <div class="auction-tally">
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
          <div class="block-gap">
            <div class="section-title">你的出价 <span class="st-note">最低 ¥${fmt(minBid)}</span></div>
            <div class="bank-form">
              <div class="field">
                <div class="field-wrap">
                  <input type="number" class="input" id="auction-bid" value="${minBid}" min="${minBid}" max="${bidder.cash}" step="100" data-max-val="${bidder.cash}">
                  <span class="field-suffix">元</span>
                </div>
                <div class="field-chips" data-chips-for="auction-bid">
                  <button type="button" class="chip" data-amt="${minBid}">最低</button>
                  <button type="button" class="chip" data-amt="${minBid + 1000}">+1千</button>
                  <button type="button" class="chip" data-amt="${minBid + 5000}">+5千</button>
                  <button type="button" class="chip" data-amt="max">全部</button>
                </div>
              </div>
              <div class="field-actions">
                <button class="btn btn-primary" id="bid-btn">出价</button>
                <button class="btn btn-ghost" id="pass-btn">放弃</button>
              </div>
            </div>
            <div class="small muted">${bidder.name} 的现金: ¥${fmt(bidder.cash)}（最高可出 ¥${fmt(bidder.cash)}）</div>
          </div>
          ` : `
          <div class="block-gap">
            <div class="mono-note">现金不足（最多 ¥${fmt(bidder.cash)}），无法达到最低出价 ¥${fmt(minBid)}，本轮只能放弃。</div>
            <div class="auction-tally">
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
        bindAmountChips(card, checkBid);
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
      <div class="modal-head">
        <div class="modal-icon-lg" style="--msoft: #e8f1ff">🤝</div>
        <div>
          <div class="modal-kicker">资产交易</div>
          <h3 class="modal-title">发起交易</h3>
        </div>
        <button class="modal-x">✕</button>
      </div>
      <div class="modal-body">
        <p class="small muted">选择交易对象，用现金、地产或股票互换资源（抵押中的地产不可交易）。</p>
        <div class="field">
          <div class="field-label"><span>交易对象</span></div>
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

      /* 「一半」快捷额度按百人取整，避免出现零钱输入 */
      function halfAmount(cash) {
        return Math.max(0, Math.floor((parseInt(cash, 10) || 0) / 200) * 100);
      }

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
              <div class="field">
                <div class="field-label"><span>现金</span><span class="fl-note">最多 ¥${fmt(me.cash)}</span></div>
                <div class="field-wrap">
                  <input type="number" class="input" id="give-cash" min="0" max="${me.cash}" value="0" data-max-val="${me.cash}">
                  <span class="field-suffix">元</span>
                </div>
                <div class="field-chips" data-chips-for="give-cash">
                  <button type="button" class="chip" data-amt="0">0</button>
                  <button type="button" class="chip" data-amt="${halfAmount(me.cash)}">一半</button>
                  <button type="button" class="chip" data-amt="max">全部</button>
                </div>
              </div>
              <div class="mini-title">地产</div>${propsSection(me.id, 'give')}
              <div class="mini-title">股票</div>${stocksSection(me.id, 'give')}
            </div>
            <div class="trade-col">
              <div class="section-title">${to.avatar} ${to.name} 给出</div>
              <div class="field">
                <div class="field-label"><span>现金</span><span class="fl-note">最多 ¥${fmt(to.cash)}</span></div>
                <div class="field-wrap">
                  <input type="number" class="input" id="get-cash" min="0" max="${to.cash}" value="0" data-max-val="${to.cash}">
                  <span class="field-suffix">元</span>
                </div>
                <div class="field-chips" data-chips-for="get-cash">
                  <button type="button" class="chip" data-amt="0">0</button>
                  <button type="button" class="chip" data-amt="${halfAmount(to.cash)}">一半</button>
                  <button type="button" class="chip" data-amt="max">全部</button>
                </div>
              </div>
              <div class="mini-title">地产</div>${propsSection(to.id, 'get')}
              <div class="mini-title">股票</div>${stocksSection(to.id, 'get')}
            </div>
          </div>
        `;
        // builder 每次重建 DOM，快捷额度需要跟着重绑
        bindAmountChips(builder);
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
      <div class="modal-head">
        <div class="modal-icon-lg" style="--msoft: #e8f1ff">🤝</div>
        <div>
          <div class="modal-kicker">来自 ${from.name}</div>
          <h3 class="modal-title">收到交易请求</h3>
        </div>
      </div>
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

    showModal(html, { wide: true, danger: state.endReason === 'bankrupt' });

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

  /* ---------- Canvas 粒子层（零依赖，只画特效，不接管布局） ---------- */
  const fx = { cv: null, ctx: null, parts: [], raf: 0, w: 0, h: 0 };

  function fxReady() {
    if (fx.ctx) return fx.ctx;
    let cv = $('#fx-layer');
    if (!cv) {
      cv = el('canvas', { id: 'fx-layer', 'aria-hidden': 'true' });
      document.body.appendChild(cv);
    }
    fx.cv = cv;
    fx.ctx = cv.getContext('2d');
    fxResize();
    global.addEventListener('resize', fxResize);
    return fx.ctx;
  }

  function fxResize() {
    if (!fx.cv) return;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    fx.w = global.innerWidth;
    fx.h = global.innerHeight;
    fx.cv.width = Math.round(fx.w * dpr);
    fx.cv.height = Math.round(fx.h * dpr);
    fx.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function fxPush(p) {
    if (fx.parts.length > 320) fx.parts.shift();
    fx.parts.push(p);
    if (!fx.raf) fx.raf = global.requestAnimationFrame(fxTick);
  }

  function fxStarPath(ctx, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.44 : r;
      const ang = -Math.PI / 2 + i * Math.PI / 5;
      const x = Math.cos(ang) * rad;
      const y = Math.sin(ang) * rad;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  function fxTick() {
    const ctx = fx.ctx;
    if (!ctx) { fx.raf = 0; return; }
    ctx.clearRect(0, 0, fx.w, fx.h);
    const list = fx.parts;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.life++;
      p.vy += p.g;
      p.vx *= 0.995;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      const t = p.life / p.max;
      if (t >= 1) { list.splice(i, 1); i--; continue; }
      ctx.save();
      ctx.globalAlpha = t > 0.72 ? Math.max(0, (1 - t) / 0.28) : 1;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.kind === 'coin') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, 6.2832);
        ctx.fill();
        ctx.strokeStyle = 'rgba(146, 96, 8, .55)';
        ctx.lineWidth = Math.max(1, p.size * .22);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, .75)';
        ctx.beginPath();
        ctx.arc(-p.size * .3, -p.size * .3, p.size * .28, 0, 6.2832);
        ctx.fill();
      } else if (p.kind === 'confetti') {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size * .3, p.size, p.size * .6);
      } else if (p.kind === 'star') {
        ctx.fillStyle = p.color;
        fxStarPath(ctx, p.size);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.globalAlpha *= 0.85;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, 6.2832);
        ctx.fill();
      }
      ctx.restore();
    }
    if (list.length) fx.raf = global.requestAnimationFrame(fxTick);
    else { fx.raf = 0; ctx.clearRect(0, 0, fx.w, fx.h); }
  }

  /* 金币喷射（原地爆开 + 重力回落） */
  function fxCoins(cx, cy, n) {
    if (prefersReducedMotion()) return;
    fxReady();
    const colors = ['#ffd75e', '#ffc727', '#f5a623'];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = 3 + Math.random() * 6;
      fxPush({
        x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 0.3, life: 0, max: 44 + Math.random() * 24,
        size: 4.5 + Math.random() * 4, rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.32, kind: 'coin',
        color: colors[i % colors.length]
      });
    }
  }

  /* 彩带（从视口顶部飘落） */
  function fxConfetti(n) {
    if (prefersReducedMotion()) return;
    fxReady();
    const colors = ['#ff4757', '#ffc727', '#00c9a7', '#4a90ff', '#9b59ff', '#ff6b9d', '#2ed573', '#ff7f50'];
    for (let i = 0; i < n; i++) {
      fxPush({
        x: Math.random() * fx.w, y: -20 - Math.random() * fx.h * 0.35,
        vx: (Math.random() - 0.5) * 1.8, vy: 1.5 + Math.random() * 2.4,
        g: 0.02, life: 0, max: 160 + Math.random() * 100,
        size: 6 + Math.random() * 7, rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.26, kind: 'confetti',
        color: colors[i % colors.length]
      });
    }
  }

  /* 星星（向上散开） */
  function fxStars(cx, cy, n) {
    if (prefersReducedMotion()) return;
    fxReady();
    const colors = ['#ffd75e', '#fff3b0', '#ffc727'];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
      const sp = 2 + Math.random() * 4.5;
      fxPush({
        x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 0.06, life: 0, max: 46 + Math.random() * 26,
        size: 4 + Math.random() * 4, rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.4, kind: 'star',
        color: colors[i % colors.length]
      });
    }
  }

  /* 细碎火花（飘字/点击的轻量点缀） */
  function fxSparks(cx, cy, n, color) {
    if (prefersReducedMotion()) return;
    fxReady();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.2832;
      const sp = 1 + Math.random() * 2.6;
      fxPush({
        x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.6,
        g: 0.05, life: 0, max: 26 + Math.random() * 18,
        size: 1.6 + Math.random() * 2, rot: 0, vr: 0,
        kind: 'spark', color: color || '#ffd75e'
      });
    }
  }

  /* ---------- 音效（Web Audio 现场合成，零音频素材） ---------- */
  const SFX_KEY = 'citytycoon_sfx';
  const sfx = { ctx: null, master: null, muted: false };
  try { sfx.muted = global.localStorage.getItem(SFX_KEY) === 'off'; } catch (e) { /* 隐私模式忽略 */ }

  function sfxCtx() {
    if (sfx.muted) return null;
    try {
      if (!sfx.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        sfx.ctx = new AC();
        sfx.master = sfx.ctx.createGain();
        sfx.master.gain.value = 0.42;
        sfx.master.connect(sfx.ctx.destination);
      }
      if (sfx.ctx.state === 'suspended') sfx.ctx.resume();
      return sfx.ctx;
    } catch (e) { return null; }
  }

  function sfxTone(ctx, type, freq, at, dur, gain, endFreq) {
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(sfx.master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function sfxNoise(ctx, at, dur, gain, freq) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = buf;
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 0.9;
    g.gain.value = gain;
    src.connect(bp); bp.connect(g); g.connect(sfx.master);
    src.start(ctx.currentTime + at);
  }

  const SFX = {
    // 骰子在桌面滚动的两颗轻响
    dice: function (c) {
      sfxNoise(c, 0, 0.16, 0.5, 1500);
      sfxNoise(c, 0.14, 0.12, 0.36, 900);
      sfxTone(c, 'square', 200, 0.26, 0.09, 0.05, 120);
    },
    // 买地：明亮三音上行
    buy: function (c) {
      [523, 659, 784].forEach(function (f, i) { sfxTone(c, 'triangle', f, i * 0.07, 0.2, 0.16); });
    },
    // 收金：两声金属轻响
    coin: function (c) {
      sfxTone(c, 'sine', 1046, 0, 0.09, 0.13);
      sfxTone(c, 'sine', 1568, 0.07, 0.12, 0.1);
    },
    // 升级：四音上行
    upgrade: function (c) {
      [659, 784, 988, 1318].forEach(function (f, i) { sfxTone(c, 'triangle', f, i * 0.06, 0.18, 0.13); });
    },
    // 胜利：琶音 + 尾巴
    win: function (c) {
      [523, 659, 784, 1046, 1318].forEach(function (f, i) { sfxTone(c, 'triangle', f, i * 0.09, 0.34, 0.14); });
      sfxTone(c, 'sine', 2093, 0.46, 0.5, 0.07);
    },
    // 失败/不可用
    error: function (c) { sfxTone(c, 'sawtooth', 250, 0, 0.16, 0.06, 150); }
  };

  function playSfx(name) {
    const ctx = sfxCtx();
    if (!ctx || !SFX[name]) return;
    try { SFX[name](ctx); } catch (e) { /* 音频失败不影响游戏 */ }
  }

  function syncSfxBtn() {
    const btn = $('#sfx-btn');
    if (!btn) return;
    btn.textContent = sfx.muted ? '🔇' : '🔊';
    btn.title = sfx.muted ? '开启音效' : '关闭音效';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', sfx.muted ? 'false' : 'true');
  }

  function toggleSfx() {
    sfx.muted = !sfx.muted;
    try { global.localStorage.setItem(SFX_KEY, sfx.muted ? 'off' : 'on'); } catch (e) { /* ignore */ }
    syncSfxBtn();
    if (!sfx.muted) playSfx('coin');
    return sfx.muted;
  }

  // 浏览器要求首次用户手势后才能出声：全局监听一次
  function initSfx() {
    syncSfxBtn();
    const unlock = function () {
      sfxCtx();
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
  }
  initSfx();

  /* ---------- 庆祝动画 ---------- */

  // 五彩纸屑 - 赢得游戏
  function showConfetti() {
    fxConfetti(140);
    playSfx('win');
  }

  // 地产购买闪光
  function flashTile(propertyId) {
    const board = $('#board');
    if (!board) return;
    const tile = board.querySelector('.tile[data-property="' + propertyId + '"]');
    if (tile) {
      tile.classList.add('tile-flash');
      // 与 tileStamp 动画时长对齐，否则印章还没看清就被移除
      setTimeout(function() { tile.classList.remove('tile-flash'); }, 950);
    }
  }

  // 金币飘出效果
  function showCoinBurst(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    fxCoins(rect.left + rect.width / 2, rect.top + rect.height / 2, 12);
    playSfx('coin');
  }

  // 收益飘字（数字仍用 DOM 保证清晰，粒子只是点缀）
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
    fxSparks(rect.left + rect.width / 2, rect.top + rect.height / 2, 10,
      isPositive ? '#ffd75e' : '#ff8a95');
    playSfx(isPositive ? 'coin' : 'error');
  }

  // 升级星星效果
  function showLevelUpStars(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    fxStars(rect.left + rect.width / 2, rect.top + rect.height / 2, 12);
    playSfx('upgrade');
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
    playSfx('dice');
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
    renderTopIdentity: renderTopIdentity,
    renderDice: renderDice,
    updateCenterInfo: updateCenterInfo,
    renderSidePanel: renderSidePanel,
    renderDock: renderDock,
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
    showPlayerDetailModal: showPlayerDetailModal,
    showToast: showToast,
    playSfx: playSfx,
    toggleSfx: toggleSfx,
    animateNumber: animateNumber,
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
