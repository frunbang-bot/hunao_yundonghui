import { ROLES, ROLE_BY_ID, RULESET } from './roles.js';

const app = document.querySelector('#app');
const colors = ['#d9ed8c', '#efb693', '#b3cde1'];
const diceFaces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
let credentials = null;
try { credentials = JSON.parse(sessionStorage.getItem('race-seat')); } catch {}
let room = null, busy = false, polling = false, connected = true, toastTimer;
const keys = new Map();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pcolor = i => colors[i % colors.length];
const roleInfo = id => ROLE_BY_ID[id] ?? { name: '待选角色', icon: '·', text: '' };
function toast(text) {
  const el = document.querySelector('#notice'); el.textContent = text; el.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 5000);
}
async function api(path, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (credentials) headers.Authorization = `Bearer ${credentials.token}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
      const result = await response.json();
      if (!response.ok) { const e = new Error(result.error || '请求失败'); e.status = response.status; throw e; }
      return result;
    } catch (e) { if (e.status || attempt === 1) throw e; }
  }
}
function preview(r) { return `<div class="preview-item"><div class="role-symbol" aria-hidden="true">${r.icon}</div><strong>${r.name}</strong><small>${r.tag}</small></div>`; }
function renderEntry() {
  const code = new URLSearchParams(location.search).get('room') || '';
  app.innerHTML = `<section class="hero"><div><p class="eyebrow">A LITTLE CHAOS. A LOT OF FUN.</p><h1>认真比赛，<br><span>随时胡闹。</span></h1><p class="intro">组一支不太靠谱的队伍，用一点运气和一点小聪明，跑过四场意想不到的比赛。</p><div class="tags"><span class="tag">2—3 人</span><span class="tag">12 个独特能力</span><span class="tag">4 场争夺</span></div></div><section class="entry-card"><h2>下一场，和谁一起？</h2><div class="subtle">创建一个本地房间，或输入朋友的房间码。</div><form id="entry-form"><label class="form-field" for="nickname">你的昵称</label><input id="nickname" name="nickname" placeholder="起个好玩的名字" maxlength="16" required autocomplete="nickname"><button class="primary wide" type="submit">创建房间 ↗</button><div class="divider">已有房间</div><div class="join-row"><input id="room-input" aria-label="房间码" placeholder="6 位房间码" maxlength="6" value="${esc(code)}" autocapitalize="characters" spellcheck="false"><button type="button" class="secondary" id="join-button">加入</button></div></form><p class="small-note">当前服务仅在这台电脑运行。可以打开多个窗口模拟多人，尚未开通异地访问。</p></section></section><section class="roster-section"><div class="section-heading"><h2>各凭本事，各有招数</h2><span>首批参赛选手 / 12</span></div><div class="role-preview">${ROLES.slice(0, 6).map(preview).join('')}</div><details class="rules-toggle"><summary>查看另外 6 名选手与测试规则</summary><div class="role-preview">${ROLES.slice(6).map(preview).join('')}</div><p>每人随机获得四名选手，每场使用一个且不能重复。第二名冲线后本场结束；四场总分决定胜负。赛道长度、特殊格、奖分均为测试参数。两人模式暂按每人一个选手进行。</p></details></section>`;
  document.querySelector('#entry-form').addEventListener('submit', e => { e.preventDefault(); enter(false); });
  document.querySelector('#join-button').addEventListener('click', () => enter(true));
}
async function enter(join) {
  if (busy) return;
  const name = document.querySelector('#nickname').value.trim();
  const code = document.querySelector('#room-input').value.trim().toUpperCase();
  if (!name) { toast('先给自己起个名字吧'); document.querySelector('#nickname').focus(); return; }
  if (join && !/^[A-Z0-9]{6}$/.test(code)) { toast('请输入 6 位房间码'); return; }
  busy = true; document.querySelectorAll('button').forEach(b => b.disabled = true);
  const signature = `${join}:${code}:${name}`;
  if (!keys.has(signature)) keys.set(signature, crypto.randomUUID());
  try {
    credentials = await api(join ? `/api/rooms/${code}/join` : '/api/rooms', 'POST', { name, requestId: keys.get(signature) });
    sessionStorage.setItem('race-seat', JSON.stringify(credentials));
    history.replaceState({}, '', `/?room=${credentials.code}`);
    room = await api(`/api/rooms/${credentials.code}`); connected = true;
  } catch (e) { toast(e.status ? e.message : '连接失败，请确认本地服务仍在运行后重试'); }
  finally { busy = false; if (room) renderRoom(); else document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
function header() {
  const g = room.game;
  const title = !g ? '集合啦，准备出发' : g.phase === 'finished' ? '终点是下一次开始' : `第 ${g.round} 场，${g.round % 2 ? '轻松起跑' : '小心脚下'}`;
  return `<div class="room-header"><div><div class="room-label">${g ? 'THE RACE IS ON' : 'GATHER YOUR TEAM'}</div><h1>${title}</h1></div><div><div class="room-code">房间 ${room.code}</div><div class="connection ${connected ? '' : 'offline'}"><i class="status-dot"></i>${connected ? '已同步' : '连接中断，正在重连'}</div></div></div>`;
}
const steps = g => `<div class="round-steps" aria-label="第 ${g.round} 场，共 4 场">${[1, 2, 3, 4].map(n => `<div class="round-step ${n === g.round ? 'current' : n < g.round ? 'done' : ''}"></div>`).join('')}</div>`;
function scorePanel(g) {
  return `<section class="panel"><h2>参赛队伍</h2>${g.players.map((p, i) => `<div class="score-row ${g.players[g.turn]?.id === p.id && ['turn', 'decision'].includes(g.phase) ? 'active' : ''}"><span class="avatar" style="--pcolor:${pcolor(i)}">${i + 1}</span><div class="score-data"><strong>${esc(p.name)}${p.id === room.me ? ' · 你' : ''}</strong><small>${esc(roleInfo(p.role).name)}${p.finish ? ` · 第 ${p.finish} 名` : p.tripped ? ' · 已摔倒' : ''}</small><small>${g.phase === 'select' ? (g.chosen.includes(p.id) ? '已锁定角色' : '正在选角色') : `剩余 ${p.handCount} 名选手`}</small></div><div class="score-points">${p.score}<small>分</small></div></div>`).join('')}</section>`;
}
function logs(g) {
  return `<section class="panel"><h2>赛场速递</h2><div class="log-list">${[...g.events].reverse().map(e => `<div class="log-line ${esc(e.kind)}">${esc(e.text)}</div>`).join('')}</div></section>`;
}
function selectPanel(g) {
  const me = g.players.find(p => p.id === room.me);
  if (g.mySelection) return `<section class="panel">${steps(g)}<div class="waiting"><div class="waiting-symbol">${roleInfo(g.mySelection).icon}</div><h2>已锁定 ${roleInfo(g.mySelection).name}</h2><p>选手准备中：${g.chosen.length} / ${g.players.length}<br>全部选好后同时亮相。</p></div></section>`;
  return `<section class="panel">${steps(g)}<h2>这一场，派谁上？</h2><p class="subtle">每个角色只能使用一次。你的选择将在所有人准备后公开。</p><div class="select-grid">${me.hand.map(id => { const r = roleInfo(id); return `<button class="select-role" data-action="select" data-role="${id}"><span class="role-symbol" aria-hidden="true">${r.icon}</span><strong>${r.name}</strong><span class="tiny">${r.english}</span><p>${r.text}</p></button>`; }).join('')}</div></section>`;
}
function board(g) {
  const cells = Array.from({ length: g.config.finish + 1 }, (_, i) => {
    const feature = g.round % 2 === 0 ? g.config.special[i] : null;
    const type = i === 0 ? 'start' : i === g.config.finish ? 'end' : feature?.type || '';
    const label = i === 0 ? '起点 ↗' : i === g.config.finish ? '终点 ⚑' : feature?.type === 'star' ? '★ +1 分' : feature?.type === 'trip' ? '摔倒' : feature?.type === 'arrow' ? `${feature.amount > 0 ? '+' : ''}${feature.amount} 格` : '';
    const tokens = g.players.map((p, n) => p.position === i ? `<span title="${esc(p.name)}${p.tripped ? ' · 已摔倒' : ''}" class="token ${p.tripped ? 'fallen' : ''}" style="--pcolor:${pcolor(n)}">${n + 1}</span>` : '').join('');
    return `<div class="cell ${type}"><span class="cell-number">${String(i).padStart(2, '0')}</span><span class="cell-label">${label}</span><div class="tokens">${tokens}</div></div>`;
  });
  return `<section class="panel board-panel">${steps(g)}<div class="board-heading"><h2>${g.round % 2 ? '普通赛道' : '特殊赛道'}</h2><small>TEST TRACK · 30 格</small></div><div class="track">${cells.join('')}</div><div class="legend"><span>按编号从 00 跑向 30</span><span>虚线棋子 = 摔倒</span><span>本场奖分 ${g.config.prizes[g.round - 1].join(' / ')}</span></div>${actionPanel(g)}</section>`;
}
const button = (action, text, variant = 'primary', option = '') => `<button class="${variant}" data-action="${action}" ${option ? `data-option="${option}"` : ''}>${text}</button>`;
function actionPanel(g) {
  const current = g.players[g.turn]; const r = roleInfo(current.role);
  const mine = current.id === room.me;
  if (!mine) return `<div class="action-panel"><div class="action-title">轮到 ${esc(current.name)} · ${r.name}</div><div class="action-desc">${r.text}<br>等待对方${g.phase === 'decision' ? '选择保留骰子或使用能力' : '行动'}，赛场会自动更新。</div></div>`;
  if (g.skipReason) return `<div class="action-panel"><div class="action-title">这一回合，休息一下</div><div class="action-desc">${esc(g.skipReason)}：跳过主移动。其他选手的回合结束能力仍会结算。</div><div class="actions">${button('skip', '确认并结束回合')}</div></div>`;
  if (g.phase === 'decision') {
    let extra = '';
    if (current.role === 'magician' && g.pending.rerolls < 2) extra += button('reroll', `再掷一次 · 剩 ${2 - g.pending.rerolls}`, 'secondary');
    if (current.role === 'alchemist' && g.pending.roll <= 2) extra += button('accept', '炼成 4 格', 'secondary', 'transmute');
    if (current.role === 'rocket') extra += button('accept', '翻倍冲刺，会摔倒', 'secondary', 'double');
    return `<div class="action-panel"><div class="dice-row"><div class="dice" aria-label="骰子 ${g.pending.roll} 点">${diceFaces[g.pending.roll]}</div><div><div class="action-title">${g.pending.roll} 点，要怎么走？</div><div class="action-desc">确认后结算场上能力与移动加成。</div></div></div><div class="actions">${button('accept', '保留点数，出发')}${extra}</div></div>`;
  }
  return `<div class="action-panel"><div class="action-title">到你了 · ${r.name}</div><div class="action-desc">${r.text}</div><div class="actions">${button('roll', '掷骰子 ↗')}${current.role === 'legs' ? button('fixed', '直接走 5 格', 'secondary') : ''}</div></div>`;
}
function resultsPanel(g) {
  const done = g.phase === 'finished';
  const ranking = [...g.players].sort((a, b) => b.score - a.score);
  const winners = ranking.filter(p => p.score === ranking[0].score);
  const rows = done ? ranking : g.finishers.map(id => g.players.find(p => p.id === id));
  return `<section class="panel">${steps(g)}<div class="big-result"><div class="trophy">⚑</div><h2>${done ? winners.map(p => esc(p.name)).join('、') + (winners.length > 1 ? ' 并列获胜！' : ' 获胜！') : `第 ${g.round} 场，漂亮收官`}</h2><p class="subtle">${done ? '四场欢笑，下一次再比个高下。' : '名次奖励已经计入总分。'}</p></div>${rows.map((p, i) => `<div class="race-result"><div class="rank">${done ? ranking.findIndex(q => q.score === p.score) + 1 : i + 1}</div><div><strong>${esc(p.name)}</strong><div class="tiny">${roleInfo(p.role).name}</div></div><span class="points">${done ? p.score + ' 分' : '+' + g.config.prizes[g.round - 1][i]}</span></div>`).join('')}${done ? '<button class="primary wide" id="new-game">返回入口，再来一局</button>' : g.ready.includes(room.me) ? `<p class="subtle">已确认，等待其他选手（${g.ready.length}/${g.players.length}）</p>` : `<div class="actions">${button('ready', g.round === 4 ? '查看最终成绩' : '准备下一场 ↗')}</div>`}</section>`;
}
function renderRoom() {
  if (!room) return;
  const g = room.game;
  let content;
  if (!g) content = `<section class="panel lobby"><h2>朋友到齐，就可以出发</h2><p class="subtle">${room.players.length} / ${room.capacity} 个座位 · 至少 2 人开始</p>${room.players.map((p, i) => `<div class="seat"><span class="avatar" style="--pcolor:${pcolor(i)}">${i + 1}</span><div class="seat-info"><div class="seat-name">${esc(p.name)}${p.id === room.me ? ' · 你' : ''}</div><div class="tiny">已进入房间</div></div>${p.id === room.host ? '<span class="badge">房主</span>' : ''}</div>`).join('')}<div class="lobby-actions"><button class="ghost" id="copy-room">复制房间链接</button><button class="secondary" id="another-seat">新窗口模拟朋友</button></div>${room.me === room.host ? `<button class="primary wide" data-action="start" ${room.players.length < 2 ? 'disabled' : ''}>开始四场比赛 ↗</button>` : '<p class="subtle">等待房主开始比赛。</p>'}<p class="small-note">12 个角色随机分发，每人 4 个。当前仅限本机多个窗口测试。</p></section>`;
  else content = `<div class="layout"><div>${g.phase === 'select' ? selectPanel(g) : ['roundEnd', 'finished'].includes(g.phase) ? resultsPanel(g) : board(g)}</div><aside class="sidebar">${scorePanel(g)}${logs(g)}</aside></div>`;
  app.innerHTML = `${header()}<div class="test-banner">本地规则原型 · ${g ? '普通／特殊赛道交替，奖分 3/1、4/2、5/3、6/4 均为测试设置。' : '不公开发布；两人模式也按每人一个选手进行。'}</div>${content}<button class="text-button" id="leave-page">离开此座位（比赛不会暂停或删除）</button>`;
  if (g?.completionReason && ['roundEnd', 'finished'].includes(g.phase)) {
    const explanation = document.createElement('p');
    explanation.className = 'test-banner'; explanation.textContent = g.completionReason;
    document.querySelector('.big-result').append(explanation);
  }
  document.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => action(b.dataset.action, b.dataset.role ? { role: b.dataset.role } : b.dataset.option ? { option: b.dataset.option } : {})));
  document.querySelector('#copy-room')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/?room=${room.code}`); toast('已复制，仅能在本机访问'); } catch { toast(`房间码：${room.code}`); }
  });
  document.querySelector('#another-seat')?.addEventListener('click', () => window.open(`/?room=${room.code}`, '_blank', 'noopener'));
  document.querySelector('#new-game')?.addEventListener('click', leave);
  document.querySelector('#leave-page')?.addEventListener('click', () => { if (confirm('离开后此座位不会自动托管，也无法通过昵称找回。确定离开？')) leave(); });
  document.querySelector('#leave-page').disabled = busy;
  if (busy || !connected) document.querySelectorAll('[data-action]').forEach(b => b.disabled = true);
}
function leave() { sessionStorage.removeItem('race-seat'); credentials = null; room = null; history.replaceState({}, '', '/'); renderEntry(); }
async function action(name, data) {
  if (busy || !connected) return;
  busy = true; renderRoom();
  try {
    room = await api(`/api/rooms/${credentials.code}/actions`, 'POST', { requestId: crypto.randomUUID(), version: room.version, action: name, data });
  } catch (e) {
    toast(e.status ? e.message : '未收到确认，正在同步结果，请勿连续点击');
    try { room = await api(`/api/rooms/${credentials.code}`); } catch { connected = false; }
  } finally { busy = false; renderRoom(); }
}
async function poll() {
  if (!credentials || busy || polling) return;
  polling = true;
  const seat = credentials;
  try {
    const fresh = await api(`/api/rooms/${seat.code}`);
    if (credentials !== seat) return;
    if (room && fresh.version < room.version) return;
    const changed = !room || fresh.version !== room.version || !connected;
    room = fresh; connected = true; if (changed) renderRoom();
  } catch (e) {
    if (credentials !== seat) return;
    if (e.status === 401 || e.status === 404) { toast('原房间或座位已失效，请重新加入'); leave(); }
    else { const wasConnected = connected; connected = false; if (wasConnected && room) renderRoom(); }
  } finally { polling = false; }
}
if (credentials) { app.innerHTML = '<div class="waiting"><h2>正在恢复你的座位…</h2><p>请确认本地服务已启动。</p><button id="reset-seat" class="ghost">返回入口</button></div>'; document.querySelector('#reset-seat').addEventListener('click', leave); poll(); }
else renderEntry();
setInterval(poll, 1000);
