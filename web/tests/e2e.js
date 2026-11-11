/* 联机协议端到端验证：静态服务 + /api/rooms + 两个 WebSocket 客户端
 * 用法：先 `node server.js --port 8099`，再 `node tests/e2e.js 8099`
 */
const PORT = Number(process.argv[2]) || 8099;
const BASE = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}/ws`;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const results = [];
  const ok = (name, cond, extra) => {
    results.push({ name, pass: !!cond, extra: extra || '' });
    console.log(`${cond ? '✅' : '❌'} ${name}${extra ? '  [' + extra + ']' : ''}`);
  };

  // 1) 静态首页
  const idx = await fetch(BASE + '/');
  const idxText = await idx.text();
  ok('首页返回 200', idx.status === 200, 'status=' + idx.status);
  ok('首页含游戏标题', idxText.includes('城市资本家'));

  // 2) 静态资源
  const css = await fetch(BASE + '/css/style.css');
  const js = await fetch(BASE + '/js/engine.js');
  ok('CSS 可访问', css.status === 200);
  ok('JS 引擎可访问', js.status === 200);

  // 3) 越权路径防护
  const bad = await fetch(BASE + '/../package.json');
  ok('越权路径被拒', bad.status === 403 || bad.status === 404, 'status=' + bad.status);

  // 4) 房主连接
  const room = 'E2E' + Math.floor(Math.random() * 1000);
  const host = new WebSocket(`${WS}?room=${room}&name=${encodeURIComponent('房主')}`);
  const hostMsgs = [];
  host.onmessage = e => hostMsgs.push(JSON.parse(e.data));
  await wait(300);
  const welcome = hostMsgs.find(m => m.type === 'welcome');
  ok('房主收到 welcome', !!welcome, welcome ? ('isHost=' + welcome.isHost + ' pid=' + welcome.playerId) : '');
  ok('房主 isHost=true', welcome && welcome.isHost === true);

  // 5) 访客连接
  const guest = new WebSocket(`${WS}?room=${room}&name=${encodeURIComponent('访客')}`);
  const guestMsgs = [];
  guest.onmessage = e => guestMsgs.push(JSON.parse(e.data));
  await wait(300);
  const gw = guestMsgs.find(m => m.type === 'welcome');
  ok('访客收到 welcome', !!gw, gw ? ('isHost=' + gw.isHost) : '');
  ok('访客 isHost=false', gw && gw.isHost === false);
  ok('房主收到 players_update(2人)',
    hostMsgs.some(m => m.type === 'players_update' && m.players.length === 2));

  // 6) /api/rooms 反映房间
  const roomsResp = await (await fetch(BASE + '/api/rooms')).json();
  const found = roomsResp.rooms.find(r => r.id === room);
  ok('/api/rooms 含该房间', !!found, found ? ('players=' + found.playerCount) : '');

  // 7) 房主开局 -> 访客收到 game_started
  const fakeState = { round: 1, status: 'playing', players: [{ id: 'p1', cash: 10000 }] };
  host.send(JSON.stringify({ type: 'start_game', gameState: fakeState }));
  await wait(300);
  const started = guestMsgs.find(m => m.type === 'game_started');
  ok('访客收到 game_started', !!started, started ? ('round=' + (started.state && started.state.round)) : '');

  // 8) 房主同步 -> 访客收到 game_state
  host.send(JSON.stringify({ type: 'game_state', state: { round: 2, status: 'playing' } }));
  await wait(300);
  ok('访客收到 game_state 同步', guestMsgs.some(m => m.type === 'game_state' && m.state && m.state.round === 2));

  // 9) 访客操作转发给房主
  guest.send(JSON.stringify({ type: 'player_action', action: { kind: 'buy', index: 5 } }));
  await wait(300);
  const fwd = hostMsgs.find(m => m.type === 'player_action');
  ok('房主收到转发的 player_action', !!fwd, fwd ? ('from=' + fwd.playerId) : '');

  // 10) 聊天广播
  guest.send(JSON.stringify({ type: 'chat', message: 'hello' }));
  await wait(300);
  ok('房主收到 chat', hostMsgs.some(m => m.type === 'chat' && m.message === 'hello'));

  // 11) 访客中途加入(游戏进行中)应收到 game_state
  const late = new WebSocket(`${WS}?room=${room}&name=${encodeURIComponent('中途')}`);
  const lateMsgs = [];
  late.onmessage = e => lateMsgs.push(JSON.parse(e.data));
  await wait(300);
  ok('中途加入收到 game_state', lateMsgs.some(m => m.type === 'game_state'));

  // 12) 访客断线 -> 房主收到 player_disconnected
  guest.close();
  await wait(400);
  ok('房主收到 player_disconnected', hostMsgs.some(m => m.type === 'player_disconnected'));

  host.close(); late.close();
  await wait(200);

  const failed = results.filter(r => !r.pass);
  console.log('\n=== 汇总：' + (results.length - failed.length) + '/' + results.length + ' 通过 ===');
  if (failed.length) {
    console.log('失败项：', failed.map(f => f.name).join(', '));
    process.exitCode = 1;
  } else {
    process.exit(0);
  }
}

main().catch(e => { console.error('测试异常:', e.message); process.exitCode = 1; });
