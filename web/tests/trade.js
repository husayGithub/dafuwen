/* 玩家交易链路无头校验：proposeTrade / acceptTrade / rejectTrade / AI 应答 / 校验拒绝
 * 用法：node tests/trade.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console: console, Date: Date, Math: Math };
vm.createContext(ctx);
['data.js', 'engine.js', 'ai.js'].forEach(function (file) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
  vm.runInContext(code, ctx, { filename: file });
});

const D = ctx.CityTycoonData;
const E = ctx.CityTycoonEngine;
const AI = ctx.CityTycoonAI;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ ' + msg); }
}

function newGame(isAI2) {
  const state = E.createGame({
    mode: '40',
    players: [
      { name: 'Alice', isAI: false },
      { name: 'Bob', isAI: !!isAI2 }
    ]
  });
  state.phase = 'action';
  state.pending = null;
  const alice = state.players[0];
  const bob = state.players[1];
  state.currentPlayerId = alice.id;
  return { state: state, alice: alice, bob: bob };
}

function giveProperty(state, player, propId) {
  const st = state.properties[propId];
  st.ownerId = player.id;
  st.level = 0;
  st.mortgaged = false;
}

const someProp = D.PROPERTY_LIST[0].id;

/* --- 1. 人类发起，对方接受：地产易主 + 现金流转 --- */
(function () {
  const g = newGame(false);
  giveProperty(g.state, g.alice, someProp);
  g.bob.cash = 10000;
  const aliceCashBefore = g.alice.cash;

  const res = E.proposeTrade(g.state, {
    fromId: g.alice.id, toId: g.bob.id,
    giveProperties: [someProp], getCash: 5000
  });
  assert(res.ok, '1: 发起交易应成功 -> ' + res.message);
  assert(g.state.pending && g.state.pending.type === 'trade', '1: 应产生待确认交易');

  const acc = E.acceptTrade(g.state, g.bob.id);
  assert(acc.ok, '1: 接受交易应成功 -> ' + acc.message);
  assert(g.state.properties[someProp].ownerId === g.bob.id, '1: 地产应转给 Bob');
  assert(g.alice.cash === aliceCashBefore + 5000, '1: Alice 应多得 5000');
  assert(g.bob.cash === 5000, '1: Bob 应少付 5000');
  assert(g.state.pending === null, '1: 成交后应清空 pending');
})();

/* --- 2. 只有交易对象可确认 --- */
(function () {
  const g = newGame(false);
  giveProperty(g.state, g.alice, someProp);
  E.proposeTrade(g.state, { fromId: g.alice.id, toId: g.bob.id, giveProperties: [someProp], getCash: 100 });
  const wrong = E.acceptTrade(g.state, g.alice.id);
  assert(!wrong.ok, '2: 非交易对象不应能确认');
})();

/* --- 3. 拒绝交易：状态回滚、无易主 --- */
(function () {
  const g = newGame(false);
  giveProperty(g.state, g.alice, someProp);
  E.proposeTrade(g.state, { fromId: g.alice.id, toId: g.bob.id, giveProperties: [someProp], getCash: 100 });
  const rej = E.rejectTrade(g.state, g.bob.id);
  assert(rej.ok, '3: 拒绝应成功 -> ' + rej.message);
  assert(g.state.properties[someProp].ownerId === g.alice.id, '3: 拒绝后地产仍属 Alice');
  assert(g.state.pending === null, '3: 拒绝后应清空 pending');
})();

/* --- 4. 校验拒绝：空交易 / 现金不足 / 给出他人地产 --- */
(function () {
  const g = newGame(false);
  const empty = E.proposeTrade(g.state, { fromId: g.alice.id, toId: g.bob.id });
  assert(!empty.ok, '4: 空交易应被拒');

  g.alice.cash = 100;
  const tooRich = E.proposeTrade(g.state, { fromId: g.alice.id, toId: g.bob.id, giveCash: 5000 });
  assert(!tooRich.ok, '4: 给出超过自身现金应被拒');

  const notMine = E.proposeTrade(g.state, { fromId: g.alice.id, toId: g.bob.id, giveProperties: [someProp] });
  assert(!notMine.ok, '4: 给出非自己地产应被拒');
})();

/* --- 5. 抵押中的地产不可交易 --- */
(function () {
  const g = newGame(false);
  giveProperty(g.state, g.alice, someProp);
  g.state.properties[someProp].mortgaged = true;
  const r = E.proposeTrade(g.state, { fromId: g.alice.id, toId: g.bob.id, giveProperties: [someProp], getCash: 10 });
  assert(!r.ok, '5: 抵押地产应不可交易');
})();

/* --- 6. AI 应答链路：shouldAcceptTrade 返回布尔且成交/拒绝可执行 --- */
(function () {
  const g = newGame(true);
  giveProperty(g.state, g.alice, someProp);
  g.bob.cash = 500000; // 给 AI 充足现金，倾向接受
  const offer = E.sanitizeOffer({
    fromId: g.alice.id, toId: g.bob.id,
    giveProperties: [someProp], getCash: 100 // Alice 几乎白送 -> AI 应接受
  });
  const accept = AI.shouldAcceptTrade(g.state, offer, g.bob, E);
  assert(typeof accept === 'boolean', '6: shouldAcceptTrade 应返回布尔');
  E.proposeTrade(g.state, offer);
  const res = accept ? E.acceptTrade(g.state, g.bob.id) : E.rejectTrade(g.state, g.bob.id);
  assert(res.ok, '6: AI 应答动作应成功 -> ' + res.message);
  assert(g.state.pending === null, '6: AI 应答后应清空 pending');
  if (accept) assert(g.state.properties[someProp].ownerId === g.bob.id, '6: 接受后地产应易主');
})();

console.log('\n=== 交易链路校验：通过 ' + pass + ' / 失败 ' + fail + ' ===');
process.exit(fail === 0 ? 0 : 1);
