// server.js — TraceDeck 看板服务（零依赖 node:http；只绑 127.0.0.1；对数据源全程只读）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProfile, buildOverview, readText, searchDocs } from './scan.js';
import { readSessions } from './sessions.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UI = path.join(ROOT, 'src', 'ui');

export function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 文件查看白名单：仅允许 reports 目录 + 显式登记的文件。
    注意绝不放行 profile.root 整仓——root 下可能有 config.json 等凭证文件。 */
export function fileAllowed(cfg, profileKey, target) {
  const p = cfg.profiles[profileKey];
  if (!p || !target) return false;
  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    return false;
  }
  const roots = [];
  const push = (x) => {
    if (!x) return;
    try {
      roots.push(fs.realpathSync(x));
    } catch {}
  };
  push(p.reports);
  push(p.changelog);
  push(p.issues);
  for (const l of p.ledgers || []) push(l);
  for (const h of p.highlights || []) push(h.path);
  for (const r of roots) {
    if (real === r || real.startsWith(r + path.sep)) return true;
  }
  return false;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

export function startServer(cfg, { port, openBrowser } = {}) {
  port = port || cfg.port || 7788;
  const server = http.createServer((req, res) => {
    try {
      handle(req, res, cfg);
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${port}`;
      console.log(`[TraceDeck] 看板已启动：${url}（只绑本机；Ctrl+C 退出）`);
      if (openBrowser) {
        import('node:child_process').then(({ exec }) => {
          const cmd = process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
          exec(cmd, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' }, () => {});
        });
      }
      resolve({ server, url, port });
    });
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function staticFile(res, file) {
  const data = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
}

async function handle(req, res, cfg) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const q = u.searchParams;
  const route = u.pathname;

  if (route === '/' || route === '/index.html') return staticFile(res, path.join(UI, 'index.html'));
  if (route === '/app.js') return staticFile(res, path.join(UI, 'app.js'));
  if (route === '/style.css') return staticFile(res, path.join(UI, 'style.css'));

  if (route === '/api/profiles') {
    const profiles = Object.entries(cfg.profiles).map(([key, p]) => ({
      key,
      name: p.name,
      root: p.root || '',
      reports: p.reports || '',
      reportsFound: !!p.reports && fs.existsSync(p.reports),
    }));
    return json(res, 200, { profiles, default: cfg.defaultProfile });
  }

  const profile = q.get('profile') || cfg.defaultProfile;
  if (!cfg.profiles[profile]) return json(res, 404, { error: `未知 profile: ${profile}` });

  if (route === '/api/overview') {
    const scanned = scanProfile(cfg, profile);
    if (scanned.error) return json(res, 404, scanned);
    return json(res, 200, buildOverview(scanned, todayLocal()));
  }

  if (route === '/api/timeline') {
    const scanned = scanProfile(cfg, profile);
    const changelogByDate = new Map(scanned.changelog.map((c) => [c.date, c]));
    const days = scanned.days.map((d) => ({
      date: d.date,
      weekday: d.weekday,
      milestone: d.milestone ? { items: d.milestone.items, sections: d.milestone.sections } : null,
      diary: d.diary
        ? { done: d.diary.done, blockers: d.diary.blockers, next: d.diary.next, extras: d.diary.extras.map((e) => ({ title: e.title, items: e.items })) }
        : null,
      changelog: changelogByDate.get(d.date) || null,
      extras: d.extras,
    }));
    return json(res, 200, { days, looseDocs: scanned.looseDocs });
  }

  if (route === '/api/issues') return json(res, 200, { issues: scanProfile(cfg, profile).issues });
  if (route === '/api/ledger') return json(res, 200, { ledgers: scanProfile(cfg, profile).ledgers });

  if (route === '/api/changelog') return json(res, 200, { entries: scanProfile(cfg, profile).changelog });

  if (route === '/api/sessions') {
    if (!cfg.sessions?.db) return json(res, 200, { sessions: [], error: '未配置会话库' });
    const limit = Math.min(Number(q.get('limit')) || 30, 100);
    const result = readSessions(cfg.sessions.db, { limit });
    return json(res, 200, result);
  }

  if (route === '/api/search') {
    const scanned = scanProfile(cfg, profile);
    return json(res, 200, { results: searchDocs(scanned, q.get('q')) });
  }

  if (route === '/api/file') {
    const target = q.get('path');
    if (!fileAllowed(cfg, profile, target)) return json(res, 403, { error: '路径不在该档案的允许范围内' });
    const text = readText(target);
    if (text == null) return json(res, 404, { error: '读不到该文件' });
    return json(res, 200, { path: target, name: path.basename(target), text });
  }

  if (route === '/api/inbox') {
    const text = readText(path.join(ROOT, 'data', 'inbox.md'));
    return json(res, 200, { text: text || '' });
  }

  json(res, 404, { error: `未知路由 ${route}` });
}
