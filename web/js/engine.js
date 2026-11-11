/* 城市资本家 City Tycoon — 核心规则引擎
 * 所有规则集中在这里，UI 只负责展示与调用。
 */
(function (global) {
  'use strict';

  const D = global.CityTycoonData;
  const R = D.RULES;

  /* ---------- 基础工具 ---------- */

  function fail(message, extra) {
    return Object.assign({ ok: false, message: message || '操作失败' }, extra || {});
  }

  function ok(extra) {
    return Object.assign({ ok: true }, extra || {});
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function rand(state) {
    state.rngState = (Math.imul(1664525, state.rngState) + 1013904223) >>> 0;
    return state.rngState / 4294967296;
  }

  function byId(state, id) {
    return state.players.find(function (p) { return p.id === id; }) || null;
  }

  function currentPlayer(state) {
    return byId(state, state.currentPlayerId);
  }

  function activePlayers(state) {
    return state.players.filter(function (p) { return p.status === 'active'; });
  }

  function log(state, text, kind) {
    state.log.push({
      round: state.round,
      kind: kind || 'info',
      text: text,
      at: Date.now()
    });
    if (state.log.length > R.maxLog) state.log.splice(0, state.log.length - R.maxLog);
  }

  function bump(state) {
    state.stateRevision += 1;
    state.actionSeq = (state.actionSeq || 0) + 1;
    state.lastActionId = 'action_' + state.actionSeq;
    state.updatedAt = Date.now();
  }

  function setPending(state, pending) {
    state.pending = pending;
    state.phase = 'pending';
    bump(state);
  }

  function setInfo(state, title, text, extra) {
    setPending(state, Object.assign({ type: 'info', title: title, text: text }, extra || {}));
  }

  function closePending(state) {
    if (!state.pending) { state.phase = 'action'; return ok(); }
    if (state.pending.type === 'financing') return fail('请先处理资金问题');
    if (state.pending.type === 'trade') {
      const offer = state.pending.offer;
      return rejectTrade(state, offer.toId);
    }
    state.pending = null;
    state.phase = 'action';
    bump(state);
    return ok();
  }

  /* ---------- 游戏创建 ---------- */

  function createGame(opts) {
    opts = opts || {};
    const modeId = opts.mode && D.MODES[opts.mode] ? opts.mode : '40';
    const mode = D.MODES[modeId];
    const playerCfg = (opts.players || []).slice(0, 4);
    if (playerCfg.length < 2) throw new Error('至少需要 2 名玩家');

    const seed = opts.seed != null
      ? (opts.seed >>> 0)
      : ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);

    const players = playerCfg.map(function (cfg, i) {
      return {
        id: 'p' + (i + 1),
        name: (cfg.name || ('玩家 ' + (i + 1))).slice(0, 12),
        color: cfg.color || D.PLAYER_COLORS[i],
        avatar: cfg.avatar || D.AVATARS[i],
        isAI: !!cfg.isAI,
        difficulty: cfg.difficulty || 'normal',
        position: 0,
        cash: R.startCash,
        deposit: 0,
        debt: 0,
        stocks: {},
        status: 'active',
        tradesThisTurn: 0
      };
    });

    const properties = {};
    D.PROPERTY_LIST.forEach(function (p) {
      properties[p.id] = { ownerId: null, level: 0, mortgaged: false };
    });

    const stocks = {};
    Object.keys(D.STOCKS).forEach(function (id) {
      const conf = D.STOCKS[id];
      stocks[id] = { price: conf.price, change: 0, history: [conf.price] };
    });

    const state = {
      version: 1,
      gameId: 'game_' + seed,
      configVersion: D.CONFIG_VERSION,
      mode: modeId,
      modeName: mode.name,
      maxRounds: mode.maxRounds,
      status: 'playing',
      round: 1,
      currentPlayerId: players[0].id,
      phase: 'awaiting_roll',
      pending: null,
      players: players,
      properties: properties,
      stocks: stocks,
      rentModifiers: [],
      log: [],
      stateRevision: 1,
      actionSeq: 0,
      lastActionId: null,
      rngState: seed || 123456789,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
      endReason: null,
      ranking: null
    };

    log(state, '🏙️ 游戏开始：' + mode.name + '，共 ' + players.length + ' 位玩家，初始现金 ' + R.startCash, 'system');
    if (mode.maxRounds) log(state, '本局共 ' + mode.maxRounds + ' 回合，结束后按总资产排名', 'system');
    return state;
  }

  /* ---------- 资产估值 ---------- */

  function groupMembers(group) {
    return D.PROPERTY_LIST.filter(function (p) { return p.group === group; });
  }

  function ownsGroup(state, playerId, group) {
    const members = groupMembers(group);
    return members.length > 0 && members.every(function (p) {
      return state.properties[p.id].ownerId === playerId;
    });
  }

  function propertyValueOf(state, player) {
    let total = 0;
    D.PROPERTY_LIST.forEach(function (item) {
      const conf = D.PROPERTIES[item.id];
      const st = state.properties[conf.id];
      if (st.ownerId === player.id) {
        total += conf.price + st.level * conf.upgradeCost;
      }
    });
    return total;
  }

  function stockValueOf(state, player) {
    let total = 0;
    Object.keys(player.stocks).forEach(function (sid) {
      const shares = player.stocks[sid] || 0;
      if (shares > 0 && state.stocks[sid]) total += shares * state.stocks[sid].price;
    });
    return Math.round(total);
  }

  function grossAssets(state, player) {
    return Math.round(player.cash + player.deposit + propertyValueOf(state, player) + stockValueOf(state, player));
  }

  function netWorth(state, player) {
    return Math.round(player.cash + player.deposit + propertyValueOf(state, player) + stockValueOf(state, player) - player.debt);
  }

  function creditLimit(state, player) {
    return Math.max(0, Math.floor(grossAssets(state, player) * R.loanCapRatio) - player.debt);
  }

  /* ---------- 租金 ---------- */

  function calcRentDetail(state, propertyId) {
    const conf = D.PROPERTIES[propertyId];
    const st = state.properties[propertyId];
    if (!st || !st.ownerId || st.mortgaged) {
      return { base: 0, monopoly: false, modPct: 0, rent: 0, level: st ? st.level : 0 };
    }
    const base = st.level > 0 ? conf.rents[st.level - 1] : 0;
    const monopoly = ownsGroup(state, st.ownerId, conf.group);
    let rent = base;
    if (monopoly) rent = Math.round(rent * R.groupRentMultiplier);
    let modPct = 0;
    state.rentModifiers.forEach(function (m) {
      if (m.expiresRound >= state.round && (m.scope === 'all' || m.scope === conf.group)) {
        modPct += m.pct;
      }
    });
    rent = Math.max(0, Math.round(rent * (1 + modPct)));
    return { base: base, monopoly: monopoly, modPct: modPct, rent: rent, level: st.level };
  }

  function calcRent(state, propertyId) {
    return calcRentDetail(state, propertyId).rent;
  }

  function calcTax(state, player) {
    return Math.max(R.taxMin, Math.round(player.cash * R.taxRate));
  }

  /* ---------- 收付款与资金周转 ---------- */

  function charge(state, payer, amount, receiver, reason, resume) {
    amount = Math.max(0, Math.round(amount));
    if (amount === 0) return ok({ amount: 0 });
    if (payer.cash >= amount) {
      payer.cash -= amount;
      if (receiver) receiver.cash += amount;
      return ok({ amount: amount });
    }
    // 自动取出存款补足
    const need = amount - payer.cash;
    const wd = Math.min(payer.deposit, need);
    if (wd > 0) {
      payer.deposit -= wd;
      payer.cash += wd;
      log(state, '🏦 ' + payer.name + ' 自动取出存款 ' + wd + '，用于支付' + (reason || '款项'), 'bank');
    }
    if (payer.cash >= amount) {
      payer.cash -= amount;
      if (receiver) receiver.cash += amount;
      return ok({ amount: amount });
    }
    setPending(state, {
      type: 'financing',
      amount: amount,
      creditorId: receiver ? receiver.id : null,
      reason: reason || '款项',
      resume: resume || { type: 'info', title: '资金周转', text: '已完成支付。' }
    });
    return fail('现金不足，需要周转资金', { amount: amount });
  }

  function payFinancing(state) {
    const pd = state.pending;
    if (!pd || pd.type !== 'financing') return fail('当前没有待支付的款项');
    const p = currentPlayer(state);
    if (!p) return fail('找不到当前玩家');
    if (p.cash < pd.amount) return fail('现金仍然不足，还需 ' + (pd.amount - p.cash));
    p.cash -= pd.amount;
    if (pd.creditorId) {
      const c = byId(state, pd.creditorId);
      if (c && c.status === 'active') c.cash += pd.amount;
    }
    log(state, '💰 ' + p.name + ' 完成支付 ' + pd.amount + '（' + pd.reason + '）', 'money');
    if (pd.resume) setPending(state, pd.resume);
    else closePending(state);
    bump(state);
    return ok();
  }

  function declareBankrupt(state, playerId) {
    const p = byId(state, playerId);
    if (!p || p.status !== 'active') return fail('该玩家不在游戏中');
    const pd = state.pending;
    const creditor = pd && pd.type === 'financing' && pd.creditorId ? byId(state, pd.creditorId) : null;
    const remaining = Math.max(0, p.cash) + Math.max(0, p.deposit);

    p.cash = 0;
    p.deposit = 0;
    p.debt = 0;
    p.stocks = {};
    p.status = 'bankrupt';
    p.tradesThisTurn = 0;

    Object.keys(state.properties).forEach(function (id) {
      if (state.properties[id].ownerId === p.id) {
        state.properties[id] = { ownerId: null, level: 0, mortgaged: false };
      }
    });

    if (creditor && creditor.status === 'active') creditor.cash += remaining;
    log(state, '💀 ' + p.name + ' 资不抵债，宣告破产' +
      (creditor ? '，剩余资产 ' + remaining + ' 归 ' + creditor.name : '，资产被银行清算'), 'bankrupt');

    state.pending = null;
    state.phase = 'landing';

    const active = activePlayers(state);
    if (active.length <= 1) {
      finishGame(state, 'bankrupt');
      return ok({ gameOver: true });
    }
    advanceTurn(state, true);
    return ok();
  }

  /* ---------- 地块结算 ---------- */

  function moveForward(state, player, steps) {
    let pos = player.position;
    let passed = false;
    for (let i = 0; i < steps; i++) {
      pos += 1;
      if (pos >= 40) { pos = 0; passed = true; }
    }
    player.position = pos;
    return { position: pos, passed: passed };
  }

  function resolveTile(state, pos, depth) {
    depth = depth || 0;
    const tile = D.getTile(pos);
    const p = currentPlayer(state);

    switch (tile.type) {
      case 'start':
        setInfo(state, '起点', p.name + ' 停在起点，城市发展基金已发放。');
        return;

      case 'property':
        resolveProperty(state, tile);
        return;

      case 'chance':
        drawEvent(state);
        return;

      case 'bank':
        setPending(state, { type: 'bank' });
        return;

      case 'stock':
        setPending(state, { type: 'stock' });
        return;

      case 'tax':
        payTax(state);
        return;

      case 'auction':
        startAuction(state);
        return;

      case 'transport': {
        if (depth > 0) {
          setInfo(state, '地铁枢纽', '换乘站台，本次不再移动。');
          return;
        }
        const mv = moveForward(state, p, 4);
        if (mv.passed) p.cash += R.passStartBonus;
        log(state, '🚇 ' + p.name + ' 搭乘地铁前进 4 格' + (mv.passed ? '，经过起点 +' + R.passStartBonus : ''), 'move');
        resolveTile(state, mv.position, depth + 1);
        return;
      }

      case 'rest':
        setInfo(state, tile.name, p.name + ' 在' + tile.name + '休息，安全地度过本回合。');
        return;

      default:
        setInfo(state, '城市街道', '这里什么也没有发生。');
    }
  }

  function resolveProperty(state, tile) {
    const p = currentPlayer(state);
    const conf = D.PROPERTIES[tile.propertyId];
    const st = state.properties[tile.propertyId];

    if (!st.ownerId) {
      setPending(state, { type: 'property', propertyId: tile.propertyId, price: conf.price });
      return;
    }
    if (st.ownerId === p.id) {
      setInfo(state, '自己的地产', conf.name + '（Lv' + st.level + '）' +
        (st.mortgaged ? '已抵押，暂时停止经营。' : '，可以在资产页升级或抵押。'), { propertyId: tile.propertyId });
      return;
    }
    const owner = byId(state, st.ownerId);
    if (!owner) return;
    if (st.mortgaged) {
      setInfo(state, '抵押地产', conf.name + ' 已被 ' + owner.name + ' 抵押，本次免租。', { propertyId: tile.propertyId });
      return;
    }
    const detail = calcRentDetail(state, tile.propertyId);
    if (detail.rent <= 0) {
      setInfo(state, '空地', conf.name + ' 尚未开发，本次无需支付租金。', { propertyId: tile.propertyId });
      return;
    }
    const paid = charge(state, p, detail.rent, owner, '租金', {
      type: 'rent',
      amount: detail.rent,
      propertyId: tile.propertyId,
      ownerId: owner.id,
      ownerName: owner.name
    });
    if (!paid.ok) return;
    log(state, '💸 ' + p.name + ' 向 ' + owner.name + ' 支付租金 ' + detail.rent + '（' + conf.name + ' Lv' + st.level + '）', 'rent');
    setPending(state, {
      type: 'rent',
      amount: detail.rent,
      propertyId: tile.propertyId,
      ownerId: owner.id,
      ownerName: owner.name
    });
  }

  function payTax(state) {
    const p = currentPlayer(state);
    const tax = calcTax(state, p);
    const paid = charge(state, p, tax, null, '税款', { type: 'tax', amount: tax });
    if (!paid.ok) return;
    log(state, '🧾 ' + p.name + ' 向税务局缴纳 ' + tax, 'money');
    setPending(state, { type: 'tax', amount: tax });
  }

  /* ---------- 掷骰与回合 ---------- */

  function roll(state) {
    if (state.status !== 'playing') return fail('游戏已经结束');
    if (state.phase !== 'awaiting_roll') return fail('当前不能掷骰子');
    const p = currentPlayer(state);
    if (!p || p.status !== 'active') return fail('当前玩家状态异常');

    const dice = 1 + Math.floor(rand(state) * R.diceSides);
    const from = p.position;
    const path = [];
    let pos = from;
    let passed = false;
    for (let i = 0; i < dice; i++) {
      pos += 1;
      if (pos >= 40) { pos = 0; passed = true; }
      path.push(pos);
    }
    p.position = pos;
    if (passed) p.cash += R.passStartBonus;

    state.phase = 'landing';
    log(state, '🎲 ' + p.name + ' 掷出 ' + dice + ' 点' + (passed ? '，经过起点 +' + R.passStartBonus : ''), 'dice');

    resolveTile(state, pos, 0);
    if (state.phase !== 'pending') state.phase = 'action';
    bump(state);
    return ok({ dice: dice, from: from, path: path, passed: passed });
  }

  function advanceTurn(state) {
    const order = state.players;
    const curIdx = order.findIndex(function (x) { return x.id === state.currentPlayerId; });
    const base = curIdx < 0 ? order.length - 1 : curIdx;
    let nextIdx = -1;
    let wrapped = false;
    for (let step = 1; step <= order.length; step++) {
      const i = (base + step) % order.length;
      if (order[i].status === 'active') {
        nextIdx = i;
        wrapped = base + step >= order.length;
        break;
      }
    }
    if (nextIdx < 0) {
      finishGame(state, 'no-players');
      return;
    }

    if (wrapped) {
      settleRound(state);
      state.round += 1;
      state.rentModifiers = state.rentModifiers.filter(function (m) { return m.expiresRound >= state.round; });
      if (state.maxRounds && state.round > state.maxRounds) {
        state.currentPlayerId = order[nextIdx].id;
        finishGame(state, 'rounds');
        return;
      }
    }

    state.currentPlayerId = order[nextIdx].id;
    state.phase = 'awaiting_roll';
    state.pending = null;
    const np = byId(state, state.currentPlayerId);
    if (np) np.tradesThisTurn = 0;
    bump(state);
  }

  function settleRound(state) {
    log(state, '—— 第 ' + state.round + ' 回合结束 ——', 'round');

    // 股价更新：P(t+1) = P(t) * (1 + 随机波动 + 均值回归)
    Object.keys(D.STOCKS).forEach(function (id) {
      const conf = D.STOCKS[id];
      const s = state.stocks[id];
      const r = (rand(state) * 2 - 1) * conf.volatility + conf.drift;
      const rev = (conf.anchor - s.price) / conf.anchor * 0.03;
      const change = Math.max(-0.15, Math.min(0.15, r + rev));
      const before = s.price;
      s.price = round2(Math.max(1, s.price * (1 + change)));
      s.change = change;
      s.history.push(s.price);
      if (s.history.length > R.maxStockHistory) s.history.shift();
      const pct = (change * 100).toFixed(1);
      log(state, '📈 ' + conf.name + ' ' + before.toFixed(2) + ' → ' + s.price.toFixed(2) +
        '（' + (change >= 0 ? '+' : '') + pct + '%）', 'stock');
    });

    if (state.round % R.interestInterval === 0) {
      activePlayers(state).forEach(function (p) {
        if (p.deposit > 0) p.deposit += Math.round(p.deposit * R.depositInterest);
        if (p.debt > 0) p.debt += Math.round(p.debt * R.loanInterest);
      });
      log(state, '🏦 银行结算：存款利息 +' + Math.round(R.depositInterest * 100) + '%，贷款利息 +' +
        Math.round(R.loanInterest * 100) + '%（每 ' + R.interestInterval + ' 回合）', 'bank');
    }
  }

  function endTurn(state) {
    if (state.status !== 'playing') return fail('游戏已经结束');
    if (state.phase !== 'action') return fail('请先处理当前事件');
    const p = currentPlayer(state);
    if (p) p.tradesThisTurn = 0;
    state.pending = null;
    advanceTurn(state);
    return ok();
  }

  function finishGame(state, reason) {
    state.status = 'finished';
    state.phase = 'finished';
    state.pending = null;
    state.finishedAt = Date.now();
    state.endReason = reason || 'finished';
    state.ranking = buildRanking(state);
    const first = state.ranking[0];
    if (first) {
      log(state, '🏆 游戏结束：' + first.name + ' 以总资产 ' + first.netWorth + ' 获得第一名！', 'system');
    }
    bump(state);
  }

  function buildRanking(state) {
    const list = state.players.map(function (p) {
      const pv = propertyValueOf(state, p);
      const sv = stockValueOf(state, p);
      return {
        playerId: p.id,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        isAI: p.isAI,
        bankrupt: p.status === 'bankrupt',
        cash: Math.round(p.cash),
        deposit: Math.round(p.deposit),
        debt: Math.round(p.debt),
        propertyValue: Math.round(pv),
        stockValue: Math.round(sv),
        netWorth: netWorth(state, p),
        propertyCount: D.PROPERTY_LIST.filter(function (c) { return state.properties[c.id].ownerId === p.id; }).length,
        stockCount: Object.keys(p.stocks).reduce(function (s, k) { return s + (p.stocks[k] || 0); }, 0)
      };
    });
    list.sort(function (a, b) {
      if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
      if (b.netWorth !== a.netWorth) return b.netWorth - a.netWorth;
      if (b.cash !== a.cash) return b.cash - a.cash;
      if (b.propertyCount !== a.propertyCount) return b.propertyCount - a.propertyCount;
      return b.stockValue - a.stockValue;
    });
    list.forEach(function (item, i) { item.rank = i + 1; });
    return list;
  }

  /* ---------- 地产操作 ---------- */

  function buyProperty(state, playerId, propertyId) {
    const pd = state.pending;
    if (!pd || pd.type !== 'property' || pd.propertyId !== propertyId) return fail('当前没有可购买的地产');
    if (state.currentPlayerId !== playerId) return fail('还没轮到你操作');
    const p = currentPlayer(state);
    const conf = D.PROPERTIES[propertyId];
    const st = state.properties[propertyId];
    if (!conf || !st) return fail('地产不存在');
    if (st.ownerId) return fail('该地产已经有主人了');
    if (p.cash < conf.price) return fail('现金不足，无法购买');

    p.cash -= conf.price;
    st.ownerId = p.id;
    st.level = 0;
    st.mortgaged = false;
    log(state, '🏠 ' + p.name + ' 以 ' + conf.price + ' 买下 ' + conf.name, 'property');
    if (ownsGroup(state, p.id, conf.group)) {
      log(state, '🏆 ' + p.name + ' 完成 ' + D.GROUPS[conf.group].name + ' 垄断，该区域租金翻倍！', 'property');
    }
    state.pending = null;
    state.phase = 'action';
    bump(state);
    return ok({ propertyId: propertyId });
  }

  function declineProperty(state) {
    const pd = state.pending;
    if (!pd || pd.type !== 'property') return fail('当前没有待购买的地产');
    const conf = D.PROPERTIES[pd.propertyId];
    log(state, '🙅 ' + currentPlayer(state).name + ' 放弃购买 ' + conf.name, 'property');
    state.pending = null;
    state.phase = 'action';
    bump(state);
    return ok();
  }

  function upgradeProperty(state, playerId, propertyId) {
    if (state.status !== 'playing') return fail('游戏已经结束');
    const p = byId(state, playerId);
    if (!p || p.status !== 'active') return fail('玩家状态异常');
    if (state.currentPlayerId !== playerId) return fail('还没轮到你操作');
    if (state.phase !== 'action') return fail('请先处理当前事件');
    const conf = D.PROPERTIES[propertyId];
    const st = state.properties[propertyId];
    if (!conf || !st) return fail('地产不存在');
    if (st.ownerId !== p.id) return fail('这不是你的地产');
    if (st.mortgaged) return fail('抵押中的地产不能升级');
    if (st.level >= R.maxLevel) return fail('已经升到最高等级');
    if (p.cash < conf.upgradeCost) return fail('现金不足，升级需要 ' + conf.upgradeCost);

    p.cash -= conf.upgradeCost;
    st.level += 1;
    log(state, '🔨 ' + p.name + ' 将 ' + conf.name + ' 升级至 Lv' + st.level +
      '（花费 ' + conf.upgradeCost + '，租金 ' + conf.rents[st.level - 1] + '）', 'property');
    if (st.level === R.maxLevel) log(state, '🏨 ' + conf.name + ' 建成高级酒店！', 'property');
    bump(state);
    return ok({ propertyId: propertyId, level: st.level });
  }

  function canUseBank(state, p) {
    return D.getTile(p.position).type === 'bank' || (state.pending && state.pending.type === 'financing');
  }

  function mortgageProperty(state, playerId, propertyId) {
    const p = byId(state, playerId);
    if (!p || p.status !== 'active') return fail('玩家状态异常');
    if (state.currentPlayerId !== playerId) return fail('还没轮到你操作');
    const conf = D.PROPERTIES[propertyId];
    const st = state.properties[propertyId];
    if (!conf || !st) return fail('地产不存在');
    if (st.ownerId !== p.id) return fail('这不是你的地产');
    if (st.mortgaged) return fail('该地产已经抵押');
    if (!canUseBank(state, p)) return fail('只能在银行办理抵押');
    const amount = conf.mortgage;
    st.mortgaged = true;
    p.cash += amount;
    p.debt += amount;
    log(state, '🏦 ' + p.name + ' 抵押 ' + conf.name + '，获得 ' + amount + '（已计入负债）', 'bank');
    bump(state);
    return ok({ amount: amount });
  }

  function redeemProperty(state, playerId, propertyId) {
    const p = byId(state, playerId);
    if (!p || p.status !== 'active') return fail('玩家状态异常');
    if (state.currentPlayerId !== playerId) return fail('还没轮到你操作');
    const conf = D.PROPERTIES[propertyId];
    const st = state.properties[propertyId];
    if (!conf || !st) return fail('地产不存在');
    if (st.ownerId !== p.id) return fail('这不是你的地产');
    if (!st.mortgaged) return fail('该地产没有抵押');
    if (!canUseBank(state, p)) return fail('只能在银行办理赎回');
    const amount = conf.mortgage;
    if (p.cash < amount) return fail('现金不足，赎回需要 ' + amount);
    p.cash -= amount;
    p.debt = Math.max(0, p.debt - amount);
    st.mortgaged = false;
    log(state, '🏦 ' + p.name + ' 赎回 ' + conf.name + '，支付 ' + amount, 'bank');
    bump(state);
    return ok({ amount: amount });
  }

  /* ---------- 银行业务 ---------- */

  function deposit(state, playerId, amount) {
    const p = byId(state, playerId);
    if (!p || p.status !== 'active') return fail('玩家状态异常');
    if (state.currentPlayerId !== playerId) return fail('还没轮到你操作');
    if (!canUseBank(state, p) || (state.pending && state.pending.type === 'financing')) return fail('只能在银行办理存款');
    amount = Math.floor(Number(amount) || 0);
    if (amount <= 0) return fail('存款金额必须大于 0');
    if (p.cash < amount) return fail('现金不足');
    p.cash -= amount;
    p.deposit += amount;
    log(state, '🏦 ' + p.name + ' 存入 ' + amount + '，每 ' + R.interestInterval + ' 回合获得 ' +
      Math.round(R.depositInterest * 100) + '% 利息', 'bank');
    bump(state);
    return ok();
  }

  function withdraw(state, playerId, amount) {
    const p = byId(state, playerId);
    if (!p || p.status !== 'active') return fail('玩家状态异常');
    const financing = state.pending && state.pending.type === 'financing';
    if (state.currentPlayerId !== playerId) return fail('还没轮到你操作');
    if (!canUseBank(state, p) && !financing) return fail('只能在银行办理取款');
    amount = Math.floor(Number(amount) || 0);
    if (amount <= 0) return fail('取款金额必须大于 0');
    if (p.deposit < amount) return fail('存款余额不足');
    p.deposit -= amount;
    p.cash += amount;
    log(state, '🏦 ' + p.name + ' 从银行取出 ' + amount, 'bank');
    bump(state);
    return ok();
  }

  function takeLoan(state, playerId, amount) {
    const p = byId(state, playerId);
    if (!p || p.status !== 'active') return fail('玩家状态异常');
    if (state.currentPlayerId !== playerId) return fail('还没轮到你操作');
    if (!canUseBank(state, p)) return fail('只能在银行申请贷款');
    amount = Math.floor(Number(amount) || 0);
    if (amount <= 0) return fail('贷款金额必须大于 0');
    const limit = creditLimit(state, p);
    if (amount > limit) return fail('超出可贷额度，最多还能贷 ' + limit);
    p.cash += amount;
    p.debt += amount;
    log(state, '🏦 ' + p.name + ' 获得贷款 ' + amount + '（负债 ' + p.debt + '，每 ' +
      R.interestInterval + ' 回合计息 ' + Math.round(R.loanInterest * 100) + '%）', 'bank');
    bump(state);
    return ok({ limit: limit });
  }

  function repayLoan(state, playerId, amount) {
    const p = byId(state, playerId);
    if (!p || p.status !== 'active') return fail('玩家状态异常');
    if (state.currentPlayerId !== playerId) return fail('还没轮到你操作');
    if (!canUseBank(state, p)) return fail('只能在银行办理还款');
    amount = Math.floor(Number(amount) || 0);
    if (amount <= 0) return fail('还款金额必须大于 0');
    if (amount > p.debt) return fail('还款金额超过负债');
    if (p.cash < amount) return fail('现金不足');
    p.cash -= amount;
    p.debt -= amount;
    log(state, '🏦 ' + p.name + ' 偿还贷款 ' + amount + '，剩余负债 ' + p.debt, 'bank');
    bump(state);
    return ok();
  }

  /* ---------- 股票交易 ---------- */

  function canTradeStock(state, player) {
    if (state.status !== 'playing') return false;
    if (state.currentPlayerId !== player.id) return false;
    if (state.pending && (state.pending.type === 'stock' || state.pending.type === 'financing')) return true;
    if (state.phase === 'action' && D.getTile(player.position).type === 'stock') return true;
    return false;
  }

  function stockTradeLimitReached(state, player) {
    const emergency = state.pending && state.pending.type === 'financing';
    return !emergency && player.tradesThisTurn >= R.maxStockTradesPerTurn;
  }

  function buyStock(state, playerId, stockId, shares) {
    const p = byId(state, playerId);
    if (!p || p.status !== 'active') return fail('玩家状态异常');
    if (state.currentPlayerId !== playerId) return fail('还没轮到你操作');
    if (!D.STOCKS[stockId] || !state.stocks[stockId]) return fail('股票不存在');
    if (!canTradeStock(state, p)) return fail('只能在股票交易所买卖股票');
    if (stockTradeLimitReached(state, p)) return fail('本回合股票交易次数已用完');
    shares = Math.floor(Number(shares) || 0);
    if (shares <= 0) return fail('至少买入 1 股');
    const s = state.stocks[stockId];
    const cost = Math.round(shares * s.price * (1 + R.stockFee));
    if (p.cash < cost) return fail('现金不足，需要 ' + cost);

    p.cash -= cost;
    p.stocks[stockId] = (p.stocks[stockId] || 0) + shares;
    p.tradesThisTurn += 1;
    log(state, '📈 ' + p.name + ' 买入 ' + D.STOCKS[stockId].name + ' ' + shares + ' 股，花费 ' +
      cost + '（含 1% 手续费）', 'stock');
    bump(state);
    return ok({ cost: cost });
  }

  function sellStock(state, playerId, stockId, shares) {
    const p = byId(state, playerId);
    if (!p || p.status !== 'active') return fail('玩家状态异常');
    if (state.currentPlayerId !== playerId) return fail('还没轮到你操作');
    if (!D.STOCKS[stockId] || !state.stocks[stockId]) return fail('股票不存在');
    if (!canTradeStock(state, p)) return fail('只能在股票交易所买卖股票');
    if (stockTradeLimitReached(state, p)) return fail('本回合股票交易次数已用完');
    shares = Math.floor(Number(shares) || 0);
    if (shares <= 0) return fail('至少卖出 1 股');
    const held = p.stocks[stockId] || 0;
    if (shares > held) return fail('持股数量不足，当前持有 ' + held + ' 股');
    const s = state.stocks[stockId];
    const proceeds = Math.round(shares * s.price * (1 - R.stockFee));
    p.stocks[stockId] = held - shares;
    if (p.stocks[stockId] <= 0) delete p.stocks[stockId];
    p.cash += proceeds;
    p.tradesThisTurn += 1;
    log(state, '📉 ' + p.name + ' 卖出 ' + D.STOCKS[stockId].name + ' ' + shares + ' 股，获得 ' +
      proceeds + '（含 1% 手续费）', 'stock');
    bump(state);
    return ok({ proceeds: proceeds });
  }

  /* ---------- 玩家交易 ---------- */

  function sanitizeStockMap(map) {
    const out = {};
    if (!map) return out;
    Object.keys(map).forEach(function (k) {
      const n = Math.floor(Number(map[k]) || 0);
      if (n > 0) out[k] = n;
    });
    return out;
  }

  function sanitizeOffer(offer) {
    return {
      fromId: offer.fromId,
      toId: offer.toId,
      giveCash: Math.max(0, Math.floor(Number(offer.giveCash) || 0)),
      getCash: Math.max(0, Math.floor(Number(offer.getCash) || 0)),
      giveProperties: Array.from(new Set(offer.giveProperties || [])),
      getProperties: Array.from(new Set(offer.getProperties || [])),
      giveStocks: sanitizeStockMap(offer.giveStocks),
      getStocks: sanitizeStockMap(offer.getStocks)
    };
  }

  function validateTrade(state, offer) {
    const from = byId(state, offer.fromId);
    const to = byId(state, offer.toId);
    if (!from || !to || from.status !== 'active' || to.status !== 'active') return '交易双方状态异常';
    if (from.id === to.id) return '不能和自己交易';
    if (offer.giveCash > from.cash) return from.name + ' 现金不足';
    if (offer.getCash > to.cash) return to.name + ' 现金不足';
    for (let i = 0; i < offer.giveProperties.length; i++) {
      const id = offer.giveProperties[i];
      const st = state.properties[id];
      if (!st || st.ownerId !== from.id) return '交易包含不属于 ' + from.name + ' 的地产';
      if (st.mortgaged) return '抵押中的地产不能交易';
    }
    for (let i = 0; i < offer.getProperties.length; i++) {
      const id = offer.getProperties[i];
      const st = state.properties[id];
      if (!st || st.ownerId !== to.id) return '交易包含不属于 ' + to.name + ' 的地产';
      if (st.mortgaged) return '抵押中的地产不能交易';
    }
    const overlap = offer.giveProperties.filter(function (id) { return offer.getProperties.indexOf(id) >= 0; });
    if (overlap.length) return '同一地产不能同时被双方给出';
    for (const sid in offer.giveStocks) {
      if (!D.STOCKS[sid]) return '股票不存在';
      if ((from.stocks[sid] || 0) < offer.giveStocks[sid]) return from.name + ' 持股不足';
    }
    for (const sid in offer.getStocks) {
      if (!D.STOCKS[sid]) return '股票不存在';
      if ((to.stocks[sid] || 0) < offer.getStocks[sid]) return to.name + ' 持股不足';
    }
    const nothing = offer.giveCash + offer.giveProperties.length + Object.keys(offer.giveStocks).length +
      offer.getCash + offer.getProperties.length + Object.keys(offer.getStocks).length === 0;
    if (nothing) return '交易内容不能为空';
    return null;
  }

  function proposeTrade(state, offer) {
    if (state.status !== 'playing') return fail('游戏已经结束');
    if (state.phase !== 'action') return fail('请先处理当前事件再发起交易');
    const norm = sanitizeOffer(offer);
    if (norm.fromId !== state.currentPlayerId) return fail('只能由当前玩家发起交易');
    const err = validateTrade(state, norm);
    if (err) return fail(err);
    const from = byId(state, norm.fromId);
    const to = byId(state, norm.toId);
    setPending(state, { type: 'trade', offer: norm, initiatedBy: from.id, targetId: to.id });
    log(state, '🤝 ' + from.name + ' 向 ' + to.name + ' 发起交易，等待确认', 'trade');
    return ok();
  }

  function acceptTrade(state, playerId) {
    const pd = state.pending;
    if (!pd || pd.type !== 'trade') return fail('当前没有待确认的交易');
    const offer = pd.offer;
    if (playerId !== offer.toId) return fail('只有交易对象可以确认');
    const err = validateTrade(state, offer);
    if (err) return fail(err);
    const from = byId(state, offer.fromId);
    const to = byId(state, offer.toId);

    from.cash -= offer.giveCash;
    to.cash += offer.giveCash;
    to.cash -= offer.getCash;
    from.cash += offer.getCash;

    offer.giveProperties.forEach(function (id) { state.properties[id].ownerId = to.id; });
    offer.getProperties.forEach(function (id) { state.properties[id].ownerId = from.id; });

    Object.keys(offer.giveStocks).forEach(function (sid) {
      const n = offer.giveStocks[sid];
      from.stocks[sid] = (from.stocks[sid] || 0) - n;
      if (from.stocks[sid] <= 0) delete from.stocks[sid];
      to.stocks[sid] = (to.stocks[sid] || 0) + n;
    });
    Object.keys(offer.getStocks).forEach(function (sid) {
      const n = offer.getStocks[sid];
      to.stocks[sid] = (to.stocks[sid] || 0) - n;
      if (to.stocks[sid] <= 0) delete to.stocks[sid];
      from.stocks[sid] = (from.stocks[sid] || 0) + n;
    });

    log(state, '🤝 ' + from.name + ' 与 ' + to.name + ' 完成交易', 'trade');
    state.pending = null;
    state.phase = 'action';
    bump(state);
    return ok();
  }

  function rejectTrade(state, playerId) {
    const pd = state.pending;
    if (!pd || pd.type !== 'trade') return fail('当前没有待确认的交易');
    if (playerId && playerId !== pd.offer.toId) return fail('只有交易对象可以拒绝');
    const to = byId(state, pd.offer.toId);
    log(state, '🙅 ' + (to ? to.name : '对方') + ' 拒绝了交易', 'trade');
    state.pending = null;
    state.phase = 'action';
    bump(state);
    return ok();
  }

  /* ---------- 拍卖 ---------- */

  function startAuction(state) {
    const p = currentPlayer(state);
    const pool = D.PROPERTY_LIST.filter(function (conf) { return !state.properties[conf.id].ownerId; });
    if (!pool.length) {
      setInfo(state, '商业拍卖', '城市里已经没有无主地产，拍卖会草草收场。');
      return;
    }
    const conf = pool[Math.floor(rand(state) * pool.length)];
    const order = activePlayers(state).map(function (x) { return x.id; });
    const minBid = Math.max(100, Math.round(conf.price * R.auctionStartRatio / 100) * 100);
    setPending(state, {
      type: 'auction',
      propertyId: conf.id,
      minBid: minBid,
      order: order,
      index: 0,
      bids: {},
      highBid: 0,
      highBidderId: null
    });
    log(state, '🔨 商业拍卖：' + conf.name + '（地价 ' + conf.price + '），起拍价 ' + minBid + '，' + order.length + ' 位玩家参与', 'auction');
  }

  function nextBidMinimum(pd) {
    if (pd.highBid <= 0) return pd.minBid;
    return Math.max(pd.minBid, pd.highBid + R.auctionStep);
  }

  function placeBid(state, playerId, amount) {
    const pd = state.pending;
    if (!pd || pd.type !== 'auction') return fail('当前没有正在进行的拍卖');
    if (pd.order[pd.index] !== playerId) return fail('还没轮到该玩家出价');
    const p = byId(state, playerId);
    amount = Math.floor(Number(amount) || 0);
    if (amount > 0) {
      const min = nextBidMinimum(pd);
      if (amount < min) return fail('出价至少为 ' + min);
      if (amount > p.cash) return fail('现金不足，最多可出 ' + Math.floor(p.cash));
      pd.bids[playerId] = amount;
      if (amount > pd.highBid) {
        pd.highBid = amount;
        pd.highBidderId = playerId;
      }
      log(state, '🔨 ' + p.name + ' 出价 ' + amount, 'auction');
    } else {
      pd.bids[playerId] = 0;
      log(state, '🔨 ' + p.name + ' 放弃出价', 'auction');
    }
    pd.index += 1;
    if (pd.index >= pd.order.length) {
      finalizeAuction(state);
    } else {
      bump(state);
    }
    return ok();
  }

  function finalizeAuction(state) {
    const pd = state.pending;
    const conf = D.PROPERTIES[pd.propertyId];
    if (pd.highBidderId) {
      const winner = byId(state, pd.highBidderId);
      winner.cash -= pd.highBid;
      state.properties[pd.propertyId].ownerId = winner.id;
      state.properties[pd.propertyId].level = 0;
      state.properties[pd.propertyId].mortgaged = false;
      log(state, '🔨 ' + winner.name + ' 以 ' + pd.highBid + ' 拍得 ' + conf.name + '！', 'auction');
      setPending(state, {
        type: 'auctionResult',
        propertyId: pd.propertyId,
        winnerId: winner.id,
        price: pd.highBid,
        text: winner.name + ' 以 ' + pd.highBid + ' 拍得 ' + conf.name + '。'
      });
    } else {
      log(state, '🔨 ' + conf.name + ' 流拍，暂时保留为无主地产。', 'auction');
      setInfo(state, '流拍', conf.name + ' 无人出价，拍卖结束。');
    }
  }

  /* ---------- 随机事件 ---------- */

  function drawEvent(state) {
    const card = D.EVENTS[Math.floor(rand(state) * D.EVENTS.length)];
    applyEvent(state, card);
  }

  function stockIdsBySector(sector) {
    return Object.keys(D.STOCKS).filter(function (sid) {
      return sector === 'all' || D.STOCKS[sid].sector === sector;
    });
  }

  function shockStocks(state, sector, pct) {
    stockIdsBySector(sector).forEach(function (sid) {
      const s = state.stocks[sid];
      const before = s.price;
      s.price = round2(Math.max(1, s.price * (1 + pct)));
      s.change = pct;
      s.history.push(s.price);
      if (s.history.length > R.maxStockHistory) s.history.shift();
      log(state, '💹 ' + D.STOCKS[sid].name + ' ' + before.toFixed(2) + ' → ' + s.price.toFixed(2) +
        '（' + (pct >= 0 ? '+' : '') + (pct * 100).toFixed(1) + '%）', 'stock');
    });
  }

  function applyEvent(state, card) {
    const p = currentPlayer(state);
    const e = card.effect;
    const detail = [];
    let financing = false;

    function gain(n) {
      p.cash += n;
      detail.push('获得 ' + n + ' 现金');
    }
    function spend(n) {
      const paid = charge(state, p, n, null, '事件支出', { type: 'event', card: card, detail: '支付 ' + n + ' 现金' });
      if (paid.ok) detail.push('支付 ' + n + ' 现金');
      else financing = true;
    }

    switch (e.type) {
      case 'cash':
        if (e.amount >= 0) gain(e.amount);
        else spend(-e.amount);
        break;

      case 'cashAll':
        activePlayers(state).forEach(function (x) { x.cash += e.amount; });
        detail.push('全体玩家获得 ' + e.amount + ' 现金');
        break;

      case 'pctCash': {
        const amount = Math.max(e.min || 0, Math.round(p.cash * e.pct));
        spend(amount);
        break;
      }

      case 'perProperty': {
        const count = D.PROPERTY_LIST.filter(function (c) { return state.properties[c.id].ownerId === p.id; }).length;
        const total = Math.abs(e.amount) * count;
        if (count === 0) detail.push('名下暂无地产，躲过一劫');
        else if (e.amount >= 0) {
          p.cash += total;
          detail.push('名下 ' + count + ' 处地产，获得 ' + total + ' 补偿');
        } else {
          const paid = charge(state, p, total, null, '地产维修费',
            { type: 'event', card: card, detail: '名下 ' + count + ' 处地产，支付 ' + total + ' 维修费' });
          if (paid.ok) detail.push('名下 ' + count + ' 处地产，支付 ' + total + ' 维修费');
          else financing = true;
        }
        break;
      }

      case 'dividend': {
        const amount = Math.round(stockValueOf(state, p) * e.pct);
        p.cash += amount;
        detail.push(amount > 0 ? '获得 ' + amount + ' 现金分红' : '没有持股，未获得分红');
        break;
      }

      case 'stock':
        shockStocks(state, e.sector, e.pct);
        detail.push((e.sector === 'all' ? '所有股票' : D.STOCKS[stockIdsBySector(e.sector)[0]].sectorName + '股票') +
          (e.pct >= 0 ? '上涨 ' : '下跌 ') + Math.abs(Math.round(e.pct * 100)) + '%');
        if (e.cash) gain(e.cash);
        if (e.dividend) {
          const amount = Math.round(stockValueOf(state, p) * e.dividend);
          p.cash += amount;
          detail.push('额外获得 ' + amount + ' 分红');
        }
        break;

      case 'rent':
        state.rentModifiers.push({
          scope: e.scope,
          pct: e.pct,
          expiresRound: state.round + e.rounds - 1
        });
        detail.push((e.scope === 'all' ? '所有地产' : D.GROUPS[e.scope].name) + '租金' +
          (e.pct >= 0 ? ' +' : ' ') + Math.round(e.pct * 100) + '%，持续 ' + e.rounds + ' 回合');
        break;

      default:
        detail.push('事件效果未知');
    }

    if (financing) return;

    log(state, '🎴 ' + p.name + ' 抽到「' + card.title + '」：' + detail.join('；'), 'event');
    setPending(state, {
      type: 'event',
      card: card,
      detail: detail.join('；')
    });
  }

  /* ---------- 导出 ---------- */

  const Engine = {
    RULES: R,
    createGame: createGame,
    rand: rand,
    byId: byId,
    currentPlayer: currentPlayer,
    activePlayers: activePlayers,
    log: log,
    bump: bump,
    setPending: setPending,
    setInfo: setInfo,
    closePending: closePending,

    roll: roll,
    endTurn: endTurn,
    advanceTurn: advanceTurn,
    finishGame: finishGame,
    buildRanking: buildRanking,
    settleRound: settleRound,

    buyProperty: buyProperty,
    declineProperty: declineProperty,
    upgradeProperty: upgradeProperty,
    mortgageProperty: mortgageProperty,
    redeemProperty: redeemProperty,

    deposit: deposit,
    withdraw: withdraw,
    takeLoan: takeLoan,
    repayLoan: repayLoan,

    canTradeStock: canTradeStock,
    buyStock: buyStock,
    sellStock: sellStock,

    proposeTrade: proposeTrade,
    acceptTrade: acceptTrade,
    rejectTrade: rejectTrade,
    validateTrade: validateTrade,
    sanitizeOffer: sanitizeOffer,

    startAuction: startAuction,
    placeBid: placeBid,
    nextBidMinimum: nextBidMinimum,

    payFinancing: payFinancing,
    declareBankrupt: declareBankrupt,
    applyEvent: applyEvent,
    drawEvent: drawEvent,

    calcRent: calcRent,
    calcRentDetail: calcRentDetail,
    calcTax: calcTax,
    groupMembers: groupMembers,
    ownsGroup: ownsGroup,
    propertyValueOf: propertyValueOf,
    stockValueOf: stockValueOf,
    grossAssets: grossAssets,
    netWorth: netWorth,
    creditLimit: creditLimit,
    canUseBank: canUseBank
  };

  global.CityTycoonEngine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);