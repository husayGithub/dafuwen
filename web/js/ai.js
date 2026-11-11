/* 城市资本家 City Tycoon — AI 玩家
 * 规则型评分 AI，三档难度。
 */
(function (global) {
  'use strict';

  const D = global.CityTycoonData;

  function profile(player) {
    return D.AI_PROFILES[player.difficulty] || D.AI_PROFILES.normal;
  }

  function groupOwnedCount(state, playerId, group) {
    return D.PROPERTIES ? D.PROPERTY_LIST.filter(function (p) {
      return p.group === group && state.properties[p.id].ownerId === playerId;
    }).length : 0;
  }

  function countGroup(group) {
    return D.PROPERTY_LIST.filter(function (p) { return p.group === group; }).length;
  }

  /* ---------- 买房 ---------- */

  function decideBuy(state, player, propertyId, Engine) {
    const conf = D.PROPERTIES[propertyId];
    const prof = profile(player);
    const price = conf.price;

    if (player.cash < price) return false;
    const after = player.cash - price;
    if (after < prof.reserve * 0.45) return false;

    const groupSize = countGroup(conf.group);
    const owned = groupOwnedCount(state, player.id, conf.group);
    const completes = owned === groupSize - 1;
    const tier = { res: 1, com: 2, fin: 3, cbd: 4 }[conf.group];

    if (prof.id === 'easy') {
      if (tier >= 3 && !completes) return false;
      if (player.cash < price * 1.6) return false;
    }

    if (completes && after >= prof.reserve * 0.2) return true;
    if (tier === 4 && prof.id !== 'hard' && owned === 0) return false;
    if (after < prof.reserve) return false;

    const yieldScore = (conf.rents[0] * 4) / price; // Lv1 租金 4 次回本比例
    const groupScore = (owned / groupSize) * prof.groupBonus;
    const cashRatio = player.cash > 0 ? price / player.cash : 1;
    const threshold = prof.id === 'easy' ? 0.95 : prof.id === 'hard' ? 0.62 : 0.78;

    if (cashRatio > prof.buyCashRatio) return false;
    return yieldScore + groupScore > threshold;
  }

  /* ---------- 升级 ---------- */

  function planUpgrades(state, player, Engine, limit) {
    const prof = profile(player);
    const max = limit || 2;
    const candidates = [];

    D.PROPERTY_LIST.forEach(function (item) {
      const conf = D.PROPERTIES[item.id];
      const st = state.properties[conf.id];
      if (st.ownerId !== player.id) return;
      if (st.mortgaged || st.level >= D.RULES.maxLevel) return;
      const curRent = st.level > 0 ? conf.rents[st.level - 1] : 0;
      const nextRent = conf.rents[st.level];
      const gain = nextRent - curRent;
      const groupDone = Engine.ownsGroup(state, player.id, conf.group);
      const score = (gain / conf.upgradeCost) * (groupDone ? 2.2 : 1);
      candidates.push({ id: conf.id, cost: conf.upgradeCost, score: score, groupDone: groupDone });
    });

    candidates.sort(function (a, b) { return b.score - a.score; });

    const room = prof.id === 'easy' ? prof.upgradeBuffer * 1.4 : prof.upgradeBuffer;
    const picks = [];
    let cash = player.cash;
    for (let i = 0; i < candidates.length && picks.length < max; i++) {
      const c = candidates[i];
      if (cash - c.cost < room * 0.45) continue;
      // 简单 AI 只升级好地段的低等级地产，避免过早投入
      if (prof.id === 'easy' && !c.groupDone && c.score < 0.35) continue;
      picks.push(c.id);
      cash -= c.cost;
    }
    return picks;
  }

  /* ---------- 银行 ---------- */

  function doBank(state, player, Engine) {
    const prof = profile(player);

    // 先偿还高息负债
    if (player.debt > 0 && player.cash > player.debt + prof.reserve * 1.4) {
      const amount = Math.min(player.debt, Math.floor((player.cash - prof.reserve) / 100) * 100);
      if (amount >= 100) Engine.repayLoan(state, player.id, amount);
    }

    // 现金过少且额度充足时借一点周转
    if (player.cash < prof.reserve * 0.8 && prof.loanAppetite > 0) {
      const limit = Engine.creditLimit(state, player);
      const want = Math.min(Math.floor(limit * prof.loanAppetite / 500) * 500, 4000);
      if (want >= 500) Engine.takeLoan(state, player.id, want);
    }

    // 闲置现金存入银行
    if (player.cash > 9000 && player.debt === 0 && prof.id !== 'easy') {
      const amount = Math.floor((player.cash - 6000) / 1000) * 1000;
      if (amount >= 1000) Engine.deposit(state, player.id, amount);
    }
  }

  /* ---------- 股票 ---------- */

  function average(nums) {
    if (!nums.length) return 0;
    let s = 0;
    for (let i = 0; i < nums.length; i++) s += nums[i];
    return s / nums.length;
  }

  function doStocks(state, player, Engine) {
    const prof = profile(player);
    let trades = 0;

    // 高抛
    Object.keys(player.stocks).forEach(function (sid) {
      if (trades >= D.RULES.maxStockTradesPerTurn) return;
      const held = player.stocks[sid] || 0;
      if (held <= 0) return;
      const s = state.stocks[sid];
      const avg = average(s.history.slice(-10));
      if (avg > 0 && s.price >= avg * (1 + prof.stockSellRise)) {
        const shares = Math.max(1, Math.ceil(held / 2));
        const res = Engine.sellStock(state, player.id, sid, shares);
        if (res.ok) trades += 1;
      }
    });

    // 低吸
    const spendable = Math.max(0, player.cash - prof.reserve * 0.7);
    let budget = spendable * prof.stockCashRatio;
    if (budget < 100) return;

    Object.keys(state.stocks).forEach(function (sid) {
      if (trades >= D.RULES.maxStockTradesPerTurn || budget < 50) return;
      const s = state.stocks[sid];
      const avg = average(s.history.slice(-10));
      if (!avg) return;
      if (s.price > avg * (1 - prof.stockBuyDip)) return;
      const maxShares = Math.floor(budget / s.price);
      if (maxShares < 1) return;
      let shares = maxShares;
      // 困难 AI 会控制单只股票仓位
      if (prof.id === 'hard') shares = Math.min(shares, Math.max(1, Math.floor(maxShares * 0.6)));
      const res = Engine.buyStock(state, player.id, sid, shares);
      if (res.ok) {
        trades += 1;
        budget -= shares * s.price;
      }
    });
  }

  /* ---------- 拍卖 ---------- */

  function chooseBid(state, pending, player, Engine) {
    const conf = D.PROPERTIES[pending.propertyId];
    const prof = profile(player);
    const minNext = Engine.nextBidMinimum(pending);
    const groupSize = countGroup(conf.group);
    const owned = groupOwnedCount(state, player.id, conf.group);
    const completes = owned === groupSize - 1;

    let max = conf.price * prof.auctionRatio;
    if (completes) max *= 1.25;
    if (prof.id === 'easy') max *= 0.75;
    const affordable = Math.min(player.cash - prof.reserve * 0.5, player.cash * 0.95);
    const cap = Math.min(max, affordable);

    if (minNext > cap) return 0;
    // 只比最低加价高一点，保留现金
    const bid = Math.min(cap, Math.max(minNext, pending.highBid + D.RULES.auctionStep));
    return Math.floor(bid / 10) * 10;
  }

  /* ---------- 资金周转 ---------- */

  function handleFinancing(state, player, Engine) {
    const amount = state.pending && state.pending.type === 'financing' ? state.pending.amount : 0;

    if (player.deposit > 0) Engine.withdraw(state, player.id, player.deposit);

    if (player.cash < amount) {
      Object.keys(player.stocks).forEach(function (sid) {
        if (player.cash >= amount) return;
        const held = player.stocks[sid] || 0;
        if (held > 0) Engine.sellStock(state, player.id, sid, held);
      });
    }

    if (player.cash < amount) {
      const props = D.PROPERTY_LIST.filter(function (conf) {
        const st = state.properties[conf.id];
        return st.ownerId === player.id && !st.mortgaged;
      }).sort(function (a, b) { return a.price - b.price; });
      for (let i = 0; i < props.length && player.cash < amount; i++) {
        Engine.mortgageProperty(state, player.id, props[i].id);
      }
    }

    if (player.cash < amount) {
      const limit = Engine.creditLimit(state, player);
      if (limit > 0) {
        const want = Math.ceil((amount - player.cash) / 100) * 100;
        Engine.takeLoan(state, player.id, Math.min(limit, want));
      }
    }

    if (player.cash >= amount) return Engine.payFinancing(state);
    return Engine.declareBankrupt(state, player.id);
  }

  /* ---------- 交易评估 ---------- */

  function propertyTradeValue(state, ids, Engine) {
    let total = 0;
    (ids || []).forEach(function (id) {
      const conf = D.PROPERTIES[id];
      const st = state.properties[id];
      total += conf.price + st.level * conf.upgradeCost;
      if (Engine.ownsGroup(state, st.ownerId, conf.group)) total += conf.price * 0.15;
    });
    return total;
  }

  function stocksTradeValue(state, map) {
    let total = 0;
    Object.keys(map || {}).forEach(function (sid) {
      total += (map[sid] || 0) * state.stocks[sid].price;
    });
    return total;
  }

  function shouldAcceptTrade(state, offer, ai, Engine) {
    const prof = profile(ai);
    const incoming = offer.giveCash + propertyTradeValue(state, offer.giveProperties, Engine) +
      stocksTradeValue(state, offer.giveStocks);
    const outgoing = offer.getCash + propertyTradeValue(state, offer.getProperties, Engine) +
      stocksTradeValue(state, offer.getStocks);

    if (offer.getCash > ai.cash - 100) return false;
    if (outgoing > 0 && incoming <= 0) return false;

    // 收到的地产若能帮 AI 完成垄断，额外加分
    let bonus = 0;
    (offer.giveProperties || []).forEach(function (id) {
      const conf = D.PROPERTIES[id];
      const owned = groupOwnedCount(state, ai.id, conf.group);
      if (owned === countGroup(conf.group) - 1) bonus += conf.price * 0.3;
    });

    const margin = prof.id === 'hard' ? 1.03 : prof.id === 'normal' ? 1.1 : 1.25;
    if (incoming + bonus < outgoing * margin) return false;
    // 不轻易卖出核心资产
    const givesCore = (offer.getProperties || []).some(function (id) {
      return Engine.ownsGroup(state, ai.id, D.PROPERTIES[id].group);
    });
    if (givesCore && incoming < outgoing * 1.5) return false;
    return true;
  }

  /* ---------- 回合驱动 ---------- */

  function resolvePending(state, Engine) {
    const pd = state.pending;
    if (!pd) return { waiting: false, acted: false };

    if (pd.type === 'auction') {
      const bidderId = pd.order[pd.index];
      const bidder = bidderId ? Engine.byId(state, bidderId) : null;
      if (!bidder || !bidder.isAI) return { waiting: true };
      const bid = chooseBid(state, pd, bidder, Engine);
      const res = Engine.placeBid(state, bidder.id, bid);
      return { acted: res.ok, waiting: false, message: res.message };
    }

    if (pd.type === 'trade') {
      const target = Engine.byId(state, pd.offer.toId);
      if (!target || !target.isAI) return { waiting: true };
      if (shouldAcceptTrade(state, pd.offer, target, Engine)) {
        const res = Engine.acceptTrade(state, target.id);
        return { acted: res.ok, waiting: false, message: res.message };
      }
      const res = Engine.rejectTrade(state, target.id);
      return { acted: res.ok, waiting: false, message: res.message };
    }

    if (pd.type === 'financing') {
      const p = Engine.currentPlayer(state);
      if (!p || !p.isAI) return { waiting: true };
      const res = handleFinancing(state, p, Engine);
      return { acted: true, waiting: false, message: res && res.message };
    }

    const p = Engine.currentPlayer(state);
    if (!p || !p.isAI) return { waiting: true };

    switch (pd.type) {
      case 'property': {
        const buy = decideBuy(state, p, pd.propertyId, Engine);
        const res = buy
          ? Engine.buyProperty(state, p.id, pd.propertyId)
          : Engine.declineProperty(state);
        return { acted: res.ok, waiting: false, message: res.message };
      }
      case 'bank':
        doBank(state, p, Engine);
        Engine.closePending(state);
        return { acted: true, waiting: false };
      case 'stock':
        doStocks(state, p, Engine);
        Engine.closePending(state);
        return { acted: true, waiting: false };
      default: {
        const res = Engine.closePending(state);
        return { acted: res.ok, waiting: false, message: res.message };
      }
    }
  }

  function performAction(state, p, Engine) {
    const upgrades = planUpgrades(state, p, Engine, 2);
    upgrades.forEach(function (id) {
      Engine.upgradeProperty(state, p.id, id);
    });
    Engine.endTurn(state);
    return { acted: true };
  }

  // 每次调用推进一个最小动作，方便 UI 做动画节奏
  function step(state, Engine) {
    if (state.status !== 'playing') return { done: true };
    if (state.pending) return resolvePending(state, Engine);

    const p = Engine.currentPlayer(state);
    if (!p || p.status !== 'active' || !p.isAI) return { waiting: true };

    if (state.phase === 'awaiting_roll') {
      const res = Engine.roll(state);
      return { acted: res.ok, waiting: false, dice: res.dice, message: res.message };
    }
    if (state.phase === 'action') {
      return performAction(state, p, Engine);
    }
    return { waiting: true };
  }

  const AI = {
    step: step,
    resolvePending: resolvePending,
    performAction: performAction,
    decideBuy: decideBuy,
    planUpgrades: planUpgrades,
    shouldAcceptTrade: shouldAcceptTrade,
    chooseBid: chooseBid,
    handleFinancing: handleFinancing,
    doBank: doBank,
    doStocks: doStocks,
    groupOwnedCount: groupOwnedCount
  };

  global.CityTycoonAI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})(typeof window !== 'undefined' ? window : globalThis);