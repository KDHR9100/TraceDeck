/* TraceDeck 看板前端 —— 零依赖 vanilla JS。
   两种模式：在线（fetch /api/*）与离线快照（window.__TRACE_DATA__，wt export 产物）。 */
'use strict';

const EMBED = window.__TRACE_DATA__ || null;
let PROFILES = [], DEFAULTP = 'ziniao-cd', CUR = null;
let CACHE = {};
let CURRENT_TAB = 'overview';
let CURRENT_SEARCH = '';

const $ = (s) => document.querySelector(s);
const main = $('#main');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const WAIT_RE = { user: /等用户|等老板|等苏总|等拍板|等用户决策/, ready: /可直接开工|不等谁|无需等待/, external: /等平台|等工单|等回复|等复查|等Engineering|等工程|等开通|等放行|等合同|等PDF|等 [Kk]ey|等AI key|等截图|等回函/ };
function waitChip(text) {
  if (WAIT_RE.ready.test(text)) return '<span class="chip ready">可直接开工</span>';
  if (WAIT_RE.user.test(text)) return '<span class="chip user">等用户</span>';
  if (WAIT_RE.external.test(text)) return '<span class="chip external">等平台/外部</span>';
  return '';
}
function stateChip(state) {
  const map = { 阻塞: 's-blocking', 待验证: 's-pending', 已解决: 's-solved', 登记不处理: 's-noop' };
  if (!state) return '';
  return `<span class="chip ${map[state] || ''}">${esc(state)}</span>`;
}
function mdInline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, txt, href) => {
    if (/^https?:/i.test(href)) return `<a href="${href}" target="_blank" rel="noopener">${txt}</a>`;
    return `<a class="linkish" data-md="${esc(href)}">${txt}</a>`;
  });
  return t;
}
function bulletsHtml(items, { waiting = false, marker = '·' } = {}) {
  if (!items || !items.length) return '<div class="muted">（无）</div>';
  return `<ul class="clean">${items
    .map((b) => `<li><span class="muted">${marker}</span><span>${mdInline(b.text || b)}${waiting ? waitChip(b.text || b) : ''}</span></li>`)
    .join('')}</ul>`;
}

/* ---------- 数据层 ---------- */
async function api(route, params = {}) {
  if (EMBED) return apiEmbed(route, params);
  const u = new URL(route, location.origin);
  if (!params.profile && route !== '/api/profiles' && route !== '/api/sessions' && route !== '/api/inbox') params.profile = CUR;
  for (const k in params) if (params[k] !== undefined) u.searchParams.set(k, params[k]);
  const r = await fetch(u);
  return r.json();
}
function apiEmbed(route, params) {
  const profile = params.profile || EMBED.default;
  if (route === '/api/profiles') return { profiles: EMBED.profiles, default: EMBED.default };
  if (route === '/api/sessions') return EMBED.sessions;
  if (route === '/api/inbox') return { text: EMBED.inbox || '' };
  const b = EMBED.byProfile[profile];
  if (!b) return { error: '快照中没有该档案数据' };
  const map = { '/api/overview': 'overview', '/api/timeline': 'timeline', '/api/issues': 'issues', '/api/ledger': 'ledger', '/api/changelog': 'changelog' };
  if (map[route]) return b[map[route]];
  if (route === '/api/search') {
    const q = String(params.q || '').trim().toLowerCase();
    const results = [];
    if (q) for (const doc of b.docs || []) {
      const matches = [];
      for (let i = 0; i < doc.lines.length && matches.length < 5; i++)
        if (doc.lines[i].toLowerCase().includes(q)) matches.push({ line: i + 1, text: doc.lines[i].trim().slice(0, 240) });
      if (matches.length) results.push({ type: doc.type, title: doc.title, path: doc.path, date: doc.date, matches });
      if (results.length >= 40) break;
    }
    return { results };
  }
  if (route === '/api/file') {
    for (const doc of b.docs || []) {
      if (doc.path === params.path || doc.path.replace(/\\/g, '/') === String(params.path).replace(/\\/g, '/'))
        return { path: doc.path, name: doc.title, text: doc.lines.join('\n') };
    }
    return { error: '快照中未包含该文件' };
  }
  return { error: '离线快照不支持该功能' };
}
function cached(route, params = {}) {
  const key = route + JSON.stringify(params);
  if (!CACHE[key]) CACHE[key] = api(route, params);
  return CACHE[key];
}

/* ---------- 各页渲染 ---------- */
async function renderOverview() {
  const [ov, inboxRes, sessRes] = await Promise.all([cached('/api/overview'), cached('/api/inbox'), cached('/api/sessions', { limit: 12 })]);
  const todayCard = `
    <div class="card"><h3>今日档</h3>
      <div class="stat-line"><span>${esc(ov.today)}</span>
      <span class="v">${ov.todayReportExists ? '✅ 已建' : '（未建）'}</span></div>
      <div class="stat-line"><span>最近活动日</span><span class="v">${ov.latestDay ? esc(ov.latestDay.date + ' ' + ov.latestDay.weekday) : '—'}</span></div>
      <div class="stat-line"><span>活动日累计</span><span class="v">${ov.dayCount} 天</span></div>
    </div>`;
  const stat = (label, val, color) =>
    `<div class="card"><h3>${label}<span class="num" style="color:${color || 'var(--tx)'}">${val}</span></h3></div>`;
  const waitCol = (title, items, cls) => `
    <div class="card"><h3>${title}<span class="num">${items.length}</span></h3>
      ${items.length
        ? `<ul class="clean">${items.slice(0, 8).map((w) => `<li><span class="chip ${cls}">${title === '可直接开工' ? '可开工' : title}</span><span>${mdInline(w.text)}</span></li>`).join('')}</ul>`
        : '<div class="empty">无</div>'}</div>`;
  const issuesCard = `
    <div class="card"><h3>阻塞中的 ISSUE<span class="num" style="color:var(--bad)">${ov.blockedIssues.length}</span></h3>
      ${ov.blockedIssues.length
        ? `<ul class="clean">${ov.blockedIssues.map((i) => `<li><code class="inline-id" data-issue="${esc(i.id)}">${esc(i.id)}</code><span>${esc(i.title)}</span></li>`).join('')}</ul>`
        : '<div class="empty">无阻塞 🎉</div>'}</div>`;
  const ledgerCard = `
    <div class="card"><h3>台账近 7 天动态</h3>
      ${ov.recentLedgerRows.length
        ? `<ul class="clean">${ov.recentLedgerRows.slice(0, 8).map((r) => `<li><span class="muted">${esc(r.date)}</span><span>${esc(r.thread)} · <b>${esc(r.cells[0])}</b> ${mdInline((r.cells[3] || '').slice(0, 60))}</span></li>`).join('')}</ul>`
        : '<div class="empty">近 7 天无台账动态</div>'}
      ${(ov.pendingLedgerRows || []).length ? `<h3 style="margin-top:12px">台账待办行（无日期）<span class="num">${ov.pendingLedgerRows.length}</span></h3>
      <ul class="clean">${ov.pendingLedgerRows.map((r) => `<li><span class="chip user">待办</span><span>${esc(r.thread)} · <b>${esc(r.cells[0])}</b> ${mdInline((r.cells[3] || '').slice(0, 60))}</span></li>`).join('')}</ul>` : ''}</div>`;
  const hlCard = `
    <div class="card"><h3>快捷入口</h3>
      ${(ov.highlights || []).length
        ? `<ul class="clean">${ov.highlights.map((h) => `<li><a class="linkish" data-file="${esc(h.path)}">${esc(h.title)}</a>${h.found ? '' : ' <span class="muted">（文件缺失）</span>'}</li>`).join('')}</ul>`
        : '<div class="muted">未配置</div>'}
      <h3 style="margin-top:12px">便签收件箱</h3>
      <div class="muted">${esc((inboxRes.text || '（空）— wt note "随手记" 添加').split('\n').filter((l) => l.startsWith('- ')).length)} 条待消化</div>
    </div>`;
  const sess = sessRes.sessions || [];
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const todaySess = sess.filter((s) => s.updated && s.updated >= today0.getTime());
  const sessCard = `
    <div class="card"><h3>今日会话<span class="num">${todaySess.length}</span></h3>
      ${todaySess.length
        ? `<ul class="clean">${todaySess.map((s) => `<li><span>${esc(s.title)}</span><span class="muted">${new Date(s.updated).toTimeString().slice(0, 5)}</span></li>`).join('')}</ul>`
        : `<div class="muted">今天暂无会话；最近一次：${sess[0] ? esc(sess[0].title) : '—'}${sessRes.error ? '（' + esc(sessRes.error) + '）' : ''}</div>`}</div>`;
  main.innerHTML = `
    <div class="grid cols-4">${todayCard}${stat('ISSUE 阻塞', ov.issueStats['阻塞'] || 0, 'var(--bad)')}${stat('待验证', ov.issueStats['待验证'] || 0, 'var(--warn)')}${stat('台账动态(7d)', ov.recentLedgerRows.length)}</div>
    <div class="grid cols-3" style="margin-top:12px">${waitCol('等平台/外部', ov.waiting.external, 'external')}${waitCol('等用户', ov.waiting.user, 'user')}${waitCol('可直接开工', ov.waiting.ready, 'ready')}</div>
    <div class="grid cols-2" style="margin-top:12px">${issuesCard}${ledgerCard}</div>
    <div class="grid cols-2" style="margin-top:12px">${hlCard}${sessCard}</div>`;
  bindIssueLinks(); bindFileLinks();
}

async function renderTimeline() {
  const { days, looseDocs } = await cached('/api/timeline');
  if (!days.length) return (main.innerHTML = '<div class="empty">该档案暂无日期档</div>');
  main.innerHTML = days
    .map((d) => {
      const diaryHtml = d.diary
        ? `<div class="sec-title">✅ 今日完成</div>${bulletsHtml(d.diary.done, { marker: '✔' })}
           <div class="sec-title">⛔ 问题与阻塞</div>${bulletsHtml(d.diary.blockers, { marker: '✗' })}
           <div class="sec-title">➡ 明日/下一步</div>${bulletsHtml(d.diary.next, { waiting: true, marker: '→' })}
           ${(d.diary.extras || []).map((e) => `<div class="sec-title">📎 ${esc(e.title)}</div>${bulletsHtml(e.items)}`).join('')}`
        : '<div class="muted">无总日记</div>';
      const msHtml = d.milestone
        ? `${bulletsHtml(d.milestone.items)}${(d.milestone.sections || []).map((s) => `<div class="sec-title">${esc(s.title)}</div>${bulletsHtml(s.items)}`).join('')}`
        : '<div class="muted">无里程碑</div>';
      const ch = d.changelog;
      const chHtml = ch
        ? `<div class="sec-title">CHANGELOG：${esc(ch.topic)}</div>${Object.entries(ch.sections)
            .map(([k, v]) => `<div class="sec-title">${esc(k)}</div>${bulletsHtml(v)}`)
            .join('')}`
        : '';
      const extras = (d.extras || []).map((f) => `<span class="chip click" data-dir="${esc(d.date)}" data-f="${esc(f)}">📎 ${esc(f)}</span>`).join(' ');
      return `<div class="day">
        <div class="day-head" data-day="${esc(d.date)}"><span class="date">${esc(d.date)}</span><span class="muted">${esc(d.weekday)}</span>
        <span style="flex:1"></span>${d.milestone ? '<span class="chip">里程碑</span>' : ''}${d.diary ? '<span class="chip">总日记</span>' : ''}${ch ? '<span class="chip">CHANGELOG</span>' : ''}</div>
        <div class="day-body"><div class="sec-title">🏁 里程碑</div>${msHtml}${diaryHtml}${chHtml}
        ${extras ? `<div class="sec-title">档内其他文件</div><div>${extras}</div>` : ''}</div></div>`;
    })
    .join('') + looseDocsHtml(looseDocs);
  bindDayToggles(); bindFileLinks();
}
function looseDocsHtml(looseDocs) {
  if (!looseDocs || !looseDocs.length) return '';
  const byType = {};
  for (const l of looseDocs) (byType[l.type] = byType[l.type] || []).push(l);
  return (
    '<div class="card" style="margin-top:8px"><h3>reports/ 根部一手记录（工单/邮件/报告等）</h3>' +
    Object.entries(byType)
      .map(
        ([t, ls]) =>
          `<div class="sec-title">${esc(t)}（${ls.length}）</div><div>${ls
            .map((l) => `<span class="chip click" data-file="${esc(l.path)}">${esc(l.name)}</span>`)
            .join(' ')}</div>`
      )
      .join('') +
    '</div>'
  );
}

async function renderMilestones() {
  const { days } = await cached('/api/timeline');
  const rows = days
    .filter((d) => d.milestone)
    .map((d) => {
      const all = [...(d.milestone.items || [])];
      for (const s of d.milestone.sections || []) all.push(...s.items);
      return `<div class="card"><h3>${esc(d.date)} ${esc(d.weekday)}</h3>${bulletsHtml(all, { marker: '🏁' })}</div>`;
    });
  main.innerHTML = `<div class="grid cols-2">${rows.join('') || '<div class="empty">暂无里程碑档</div>'}</div>`;
}

const ISSUE_COLS = ['阻塞', '待验证', '已解决', '登记不处理'];
async function renderIssues() {
  const { issues } = await cached('/api/issues');
  const cols = ISSUE_COLS.map((st) => {
    const list = issues.filter((i) => i.state === st);
    return `<div class="issue-col"><h4>${st}（${list.length}）</h4>${list
      .map(
        (i) => `<div class="issue-card" data-issue="${esc(i.id)}" style="border-left-color:var(--${
          st === '阻塞' ? 'bad' : st === '待验证' ? 'warn' : st === '已解决' ? 'good' : 'dim'
        })"><div class="t">${esc(i.title)}</div><div class="muted">${esc(i.id)} · ${esc(i.date || '?')}</div></div>`
      )
      .join('')}</div>`;
  });
  const unsorted = issues.filter((i) => !ISSUE_COLS.includes(i.state));
  main.innerHTML = `<div class="kanban">${cols.join('')}<div class="issue-col"><h4>归档/未标注（${unsorted.length}）</h4>${unsorted
    .map((i) => `<div class="issue-card" data-issue="${esc(i.id)}"><div class="t">${esc(i.title)}</div><div class="muted">${esc(i.id)} · ${esc(i.date || '?')}</div></div>`)
    .join('')}</div></div>`;
  bindIssueLinks();
}

async function renderLedger() {
  const { ledgers } = await cached('/api/ledger');
  if (!ledgers.length) return (main.innerHTML = '<div class="empty">该档案未配置台账</div>');
  main.innerHTML = ledgers
    .map((led) => {
      if (!led.found) return `<div class="card"><h3>${esc(led.name)}</h3><div class="empty">文件缺失</div></div>`;
      return `<div class="card" style="margin-bottom:14px"><h3>${esc(led.name)}</h3>${led.threads
        .map((th) => {
          if (!th.rows.length) return '';
          const head = th.rows[0].map((c) => esc(c));
          const body = th.rows
            .slice(1)
            .map((r) => {
              const dir = (r[2] || '').includes('平台→') || (r[2] || '').includes('对方');
              return `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td><span class="chip ${dir ? 'in' : 'out'}">${esc(r[2])}</span></td><td>${mdInline(r[3] || '')}</td></tr>`;
            })
            .join('');
          return `<div class="sec-title">${esc(th.title)}</div><table class="tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>${
            th.status ? `<div class="muted">线程状态：${mdInline(th.status)}</div>` : ''
          }`;
        })
        .join('')}</div>`;
    })
    .join('');
}

async function renderChangelog() {
  const { entries } = await cached('/api/changelog');
  if (!entries.length) return (main.innerHTML = '<div class="empty">无 CHANGELOG</div>');
  const colors = { Added: 'var(--good)', Changed: 'var(--accent)', Fixed: 'var(--warn)', Security: 'var(--bad)', Removed: 'var(--dim)', Verified: 'var(--good)' };
  main.innerHTML = entries
    .map(
      (e) => `<div class="day"><div class="day-head"><span class="date">${esc(e.date)}</span><span class="muted">${esc(e.topic)}</span></div>
      <div class="day-body">${Object.entries(e.sections)
        .map(([k, v]) => `<div class="sec-title" style="color:${colors[k] || 'var(--tx2)'}">${esc(k)}（${v.length}）</div>${bulletsHtml(v)}`)
        .join('')}</div></div>`
    )
    .join('');
}

async function renderSessions() {
  const { sessions, error } = await cached('/api/sessions', { limit: 60 });
  if (error && !sessions.length) return (main.innerHTML = `<div class="empty">会话库不可读：${esc(error)}</div>`);
  const profileRoots = PROFILES.map((p) => ({ key: p.key, root: (p.root || '').toLowerCase() }));
  const rows = sessions
    .map((s) => {
      const dirL = (s.directory || '').toLowerCase();
      const pk = (profileRoots.find((p) => p.root && dirL.startsWith(p.root)) || {}).key;
      const dur = s.durationMin != null ? (s.durationMin >= 60 ? Math.floor(s.durationMin / 60) + 'h' + (s.durationMin % 60) + 'm' : s.durationMin + 'm') : '';
      return `<tr><td><b>${esc(s.title)}</b><div class="muted">${esc((s.firstInput || '').slice(0, 90))}</div></td>
      <td>${pk ? `<span class="chip">${esc(pk)}</span>` : '<span class="muted">其他</span>'}</td>
      <td>${new Date(s.updated).toLocaleString('zh-CN', { hour12: false })}</td><td>${dur}</td></tr>`;
    })
    .join('');
  main.innerHTML = `<div class="card"><h3>最近会话（ZCode 会话库，只读元数据）</h3>
  <table class="tbl"><thead><tr><th>标题 / 首条输入</th><th>档案</th><th>最近活动</th><th>时长</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function renderSearch() {
  if (!CURRENT_SEARCH) return (main.innerHTML = '<div class="empty">输入关键词后 Enter 检索（覆盖日期档全文/ISSUES/CHANGELOG/台账/一手记录）</div>');
  const { results } = await api('/api/search', { q: CURRENT_SEARCH });
  main.innerHTML = results.length
    ? `<div class="muted" style="margin-bottom:10px">“${esc(CURRENT_SEARCH)}” 命中 ${results.length} 个文件</div>` +
      results
        .map(
          (r) => `<div class="card search-hit" style="margin-bottom:10px"><h3><a class="linkish" data-file="${esc(r.path)}">${esc(r.title)}</a>
          <span class="chip">${esc(r.type)}</span>${r.date ? `<span class="muted">${esc(r.date)}</span>` : ''}</h3>
          ${r.matches.map((m) => `<div class="muted">L${m.line}：${hl(m.text, CURRENT_SEARCH)}</div>`).join('')}</div>`
        )
        .join('')
    : '<div class="empty">无命中</div>';
  bindFileLinks();
}
function hl(text, q) {
  const t = esc(text);
  const eq = esc(q);
  return t.replace(new RegExp(eq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<span class="hl">${m}</span>`);
}

/* ---------- 弹窗：文件查看 / ISSUE 详情 ---------- */
let MODAL_RAW = false;
let MODAL_DATA = null;
async function openFile(path) {
  const res = await api('/api/file', { path });
  if (res.error) return alert(res.error);
  MODAL_DATA = res;
  MODAL_RAW = false;
  $('#modalTitle').textContent = res.name;
  renderModal();
  $('#modal').classList.remove('hidden');
}
function renderModal() {
  const body = $('#modalBody');
  if (MODAL_RAW) {
    body.innerHTML = `<pre style="white-space:pre-wrap;font-size:12px">${esc(MODAL_DATA.text)}</pre>`;
  } else {
    body.innerHTML = `<div class="md">${miniMd(MODAL_DATA.text)}</div>`;
  }
}
function miniMd(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|/.test(line)) {
      const tbl = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) tbl.push(lines[i++]);
      const rows = tbl.map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      const isSep = (r) => r.every((c) => /^:?-{2,}:?$/.test(c) || c === '');
      const head = rows[0];
      const bodyRows = rows.slice(1).filter((r) => !isSep(r));
      out.push(`<table><thead><tr>${head.map((h) => `<th>${mdInline(h)}</th>`).join('')}</tr></thead><tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) { out.push(`<blockquote>${mdInline(line.replace(/^>\s?/, ''))}</blockquote>`); i++; continue; }
    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ''));
        i++;
        while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) && !/^(#{1,6}\s|\s*\|)/.test(lines[i])) {
          items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
      }
      out.push(`<ul>${items.map((t) => `<li>${mdInline(t)}</li>`).join('')}</ul>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*\||>\s?|\s*([-*]|\d+[.)])\s+)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
    out.push(`<p>${mdInline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}
function openIssue(id) {
  cached('/api/issues').then(({ issues }) => {
    const i = issues.find((x) => x.id === id);
    if (!i) return;
    $('#modalTitle').textContent = `${i.id} · ${i.title}`;
    $('#modalBody').innerHTML = `<div class="md">
      <p>${stateChip(i.state)} ${i.statusNote ? `<span class="muted">${esc(i.statusNote)}</span>` : ''}</p>
      <p class="muted">${esc(i.section || '')} · 登记：${esc(i.date || '?')}</p>
      ${Object.entries(i.fields).map(([k, v]) => `<div class="sec-title">${esc(k)}</div><p>${mdInline(v)}</p>`).join('')}</div>`;
    MODAL_DATA = null;
    $('#modal').classList.remove('hidden');
  });
}

/* ---------- 绑定与启动 ---------- */
function bindDayToggles() {
  document.querySelectorAll('.day-head[data-day]').forEach((el) => {
    el.addEventListener('click', () => {
      const body = el.nextElementSibling;
      body.style.display = body.style.display === 'none' ? '' : 'none';
    });
  });
}
function bindIssueLinks() {
  document.querySelectorAll('[data-issue]').forEach((el) => el.addEventListener('click', () => openIssue(el.dataset.issue)));
}
function bindFileLinks() {
  document.querySelectorAll('[data-file]').forEach((el) => el.addEventListener('click', () => openFile(el.dataset.file)));
  document.querySelectorAll('[data-f]').forEach((el) =>
    el.addEventListener('click', () => {
      const date = el.dataset.dir;
      const profileRoot = PROFILES.find((p) => p.key === CUR)?.reports;
      if (profileRoot) openFile(profileRoot.replace(/\/$/, '') + '/' + date + '/' + el.dataset.f);
    })
  );
  $('#modalBody').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-md]');
    if (!a || !MODAL_DATA) return;
    e.preventDefault();
    const base = MODAL_DATA.path.replace(/[\\/][^\\/]*$/, '');
    openFile(base + '/' + a.dataset.md);
  });
}
const TABS = { overview: renderOverview, timeline: renderTimeline, milestones: renderMilestones, issues: renderIssues, ledger: renderLedger, changelog: renderChangelog, sessions: renderSessions, search: renderSearch };
async function go(tab) {
  CURRENT_TAB = tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  main.innerHTML = '<div class="loading">加载中…</div>';
  try {
    await TABS[tab]();
  } catch (e) {
    main.innerHTML = `<div class="empty">渲染失败：${esc(e.message)}</div>`;
  }
}
async function init() {
  const theme = localStorage.getItem('td-theme');
  if (theme) document.documentElement.dataset.theme = theme;
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme === 'light' ? '' : 'light';
    document.documentElement.dataset.theme = cur;
    localStorage.setItem('td-theme', cur);
    $('#themeBtn').textContent = cur === 'light' ? '☾' : '☀';
  });
  if (document.documentElement.dataset.theme === 'light') $('#themeBtn').textContent = '☾';
  if (EMBED) $('#modeBadge').textContent = '离线快照 ' + EMBED.generatedAt;

  const prof = await api('/api/profiles');
  PROFILES = prof.profiles;
  DEFAULTP = prof.default;
  const sel = $('#profileSel');
  for (const p of PROFILES) {
    const o = document.createElement('option');
    o.value = p.key;
    o.textContent = (p.reportsFound === false ? '⚠ ' : '') + p.name;
    sel.appendChild(o);
  }
  CUR = EMBED ? EMBED.default : DEFAULTP;
  if (EMBED) sel.value = CUR;
  sel.addEventListener('change', () => { CUR = sel.value; CACHE = {}; go(CURRENT_TAB === 'search' ? 'overview' : CURRENT_TAB); });
  $('#refreshBtn').addEventListener('click', () => { CACHE = {}; go(CURRENT_TAB); });
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  $('#modalClose').addEventListener('click', () => $('#modal').classList.add('hidden'));
  $('#rawToggle').addEventListener('click', () => { if (MODAL_DATA) { MODAL_RAW = !MODAL_RAW; renderModal(); } });
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) $('#modal').classList.add('hidden'); });
  $('#searchBox').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { CURRENT_SEARCH = e.target.value.trim(); go('search'); }
  });
  go('overview');
}
init();
