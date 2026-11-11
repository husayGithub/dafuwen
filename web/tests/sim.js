/* 无头模拟：验证规则引擎与 AI，并输出经济平衡统计
 * 用法：node tests/sim.js [局数]
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
const Engine = ctx.CityTycoonEngine;
const AI = ctx.CityTycoonAI;

function runGame(opts) {
  const count = opts.count || 4;
  const difficulties = opts.difficulties || ['normal', 'normal', 'normal', 'normal'];
  const players = [];
  for (let i = 0; i < count; i++) {
    players.push({
      name: 'AI' + (i + 1),
      isAI: true,
      difficulty: difficulties[i] || 'normal'
    });
  }
  const state = Engine.createGame({ mode: opts.mode || '40', seed: opts.seed, players: players });
  let steps = 0;
  const guard = 30000;

  while (state.status === 'playing' && steps < guard) {
    const res = AI.step(state, Engine);
    if (res.waiting) {
      throw new Error('全 AI 对局出现等待状态：phase=' + state.phase +
        ' pending=' + (state.pending && state.pending.type) + ' player=' + state.currentPlayerId);
    }
    if (res.done) break;
    if (res.ok === false || res.acted === false) {
      throw new Error('AI 动作失败：' + (res.message || 'unknown') +
        ' phase=' + state.phase + ' pending=' + (state.pending && state.pending.type));
    }
    steps += 1;
  }

  if (state.status !== 'finished') {
    throw new Error('对局未结束，steps=' + steps + ' round=' + state.round +
      ' phase=' + state.phase + ' pending=' + (state.pending && state.pending.type));
  }

  const ranking = state.ranking;
  const active = state.players.filter(function (p) { return p.status === 'active'; }).length;
  const mostProperties = Math.max.apply(null, ranking.map(function (r) { return r.propertyCount; }));
  const stocksValue = ranking.reduce(function (s, r) { return s + r.stockValue; }, 0);
  const propertyValue = ranking.reduce(function (s, r) { return s + r.propertyValue; }, 0);
  const debt = ranking.reduce(function (s, r) { return s + r.debt; }, 0);

  return {
    mode: state.mode,
    rounds: state.round,
    steps: steps,
    winner: ranking[0] ? ranking[0].name : '-',
    winnerNet: ranking[0] ? ranking[0].netWorth : 0,
    winnerProps: ranking[0] ? ranking[0].propertyCount : 0,
    winnerStock: ranking[0] ? ranking[0].stockValue : 0,
    bankruptcies: state.players.length - active,
    mostProperties: mostProperties,
    totalStocks: stocksValue,
    totalProperties: propertyValue,
    totalDebt: debt,
    ranking: ranking,
    state: state
  };
}

function percentile(nums, p) {
  const arr = nums.slice().sort(function (a, b) { return a - b; });
  const idx = Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * p)));
  return arr[idx];
}

function main() {
  const total = Number(process.argv[2]) || 100;
  const mode = process.argv[3] || '40';
  const configs = [
    { name: '4人混战', count: 4, difficulties: ['normal', 'normal', 'normal', 'normal'] },
    { name: '4人三档AI', count: 4, difficulties: ['easy', 'normal', 'hard', 'normal'] },
    { name: '2人对战', count: 2, difficulties: ['normal', 'hard'] }
  ];

  let allOk = true;
  configs.forEach(function (cfg) {
    const results = [];
    const t0 = Date.now();
    for (let i = 0; i < total; i++) {
      try {
        results.push(runGame({
          mode: mode,
          count: cfg.count,
          difficulties: cfg.difficulties,
          seed: 9000 + i * 7919
        }));
      } catch (e) {
        allOk = false;
        console.error('❌ ' + cfg.name + ' 第 ' + (i + 1) + ' 局失败：', e.message);
        if (i === 0) console.error(e.stack);
        break;
      }
    }
    if (!results.length) return;

    const rounds = results.map(function (r) { return r.rounds; });
    const nets = results.map(function (r) { return r.winnerNet; });
    const bks = results.map(function (r) { return r.bankruptcies; });
    const winnerProp = results.map(function (r) { return r.winnerProps; });
    const winnerStock = results.map(function (r) { return r.winnerStock; });
    const totalStock = results.reduce(function (s, r) { return s + r.totalStocks; }, 0);
    const totalProp = results.reduce(function (s, r) { return s + r.totalProperties; }, 0);
    const winsByDiff = {};
    results.forEach(function (r) {
      const w = r.ranking[0];
      if (w) winsByDiff[w.playerId] = (winsByDiff[w.playerId] || 0) + 1;
    });

    console.log('\n=== ' + cfg.name + ' · ' + mode + ' 回合模式 · ' + total + ' 局 ===');
    console.log('用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's，平均步数 ' +
      (results.reduce(function (s, r) { return s + r.steps; }, 0) / results.length).toFixed(0));
    console.log('平均结束回合：' + (rounds.reduce(function (a, b) { return a + b; }, 0) / rounds.length).toFixed(1) +
      '（P10 ' + percentile(rounds, 0.1) + ' / P90 ' + percentile(rounds, 0.9) + '）');
    console.log('平均破产人数：' + (bks.reduce(function (a, b) { return a + b; }, 0) / bks.length).toFixed(2) +
      '，出现破产的局：' + results.filter(function (r) { return r.bankruptcies > 0; }).length + '/' + results.length);
    console.log('冠军总资产：平均 ' + Math.round(nets.reduce(function (a, b) { return a + b; }, 0) / nets.length) +
      '（P10 ' + percentile(nets, 0.1) + ' / P90 ' + percentile(nets, 0.9) + '）');
    console.log('冠军地产数平均 ' + (winnerProp.reduce(function (a, b) { return a + b; }, 0) / winnerProp.length).toFixed(1) +
      '，股票市值平均 ' + Math.round(winnerStock.reduce(function (a, b) { return a + b; }, 0) / winnerStock.length));
    console.log('全场地皮价值 ' + Math.round(totalProp / results.length) + '，股票市值 ' +
      Math.round(totalStock / results.length));
    console.log('各座位获胜次数：' + JSON.stringify(winsByDiff));
  });

  if (!allOk) process.exitCode = 1;
}

main();