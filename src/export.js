// export.js — 静态自包含导出：dist/index.html 双击即看，无需起服务、不联网
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProfile, buildOverview, readText } from './scan.js';
import { readSessions } from './sessions.js';
import { todayLocal } from './server.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function exportStatic(cfg, { profileKeys = null, out = null } = {}) {
  const keys = profileKeys || Object.keys(cfg.profiles);
  const byProfile = {};
  for (const key of keys) {
    const scanned = scanProfile(cfg, key);
    if (scanned.error) continue;
    const changelogByDate = new Map(scanned.changelog.map((c) => [c.date, c]));
    byProfile[key] = {
      overview: buildOverview(scanned, todayLocal()),
      timeline: {
        days: scanned.days.map((d) => ({
          date: d.date,
          weekday: d.weekday,
          milestone: d.milestone ? { items: d.milestone.items, sections: d.milestone.sections } : null,
          diary: d.diary
            ? { done: d.diary.done, blockers: d.diary.blockers, next: d.diary.next, extras: d.diary.extras }
            : null,
          changelog: changelogByDate.get(d.date) || null,
          extras: d.extras,
        })),
        looseDocs: scanned.looseDocs,
      },
      issues: { issues: scanned.issues },
      ledger: { ledgers: scanned.ledgers },
      changelog: { entries: scanned.changelog },
      docs: (scanned.docs || []).map((d) => ({ type: d.type, title: d.title, path: d.path, date: d.date, lines: d.lines })),
    };
  }
  const sessions = cfg.sessions?.db ? readSessions(cfg.sessions.db, { limit: 60 }) : { sessions: [], error: '未配置会话库' };
  const inbox = readText(path.join(ROOT, 'data', 'inbox.md')) || '';
  const html = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'style.css'), 'utf8');
  const embed = {
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
    default: cfg.defaultProfile,
    profiles: Object.entries(cfg.profiles).map(([key, p]) => ({ key, name: p.name, root: p.root || '', reports: p.reports || '', reportsFound: true })),
    sessions,
    inbox,
    byProfile,
  };
  const scriptTag = `<script>window.__TRACE_DATA__=${JSON.stringify(embed)};</script>\n<script>${appJs}</script>`;
  // 用函数式替换：内嵌 JS 里含 `$&` 等序列，字符串替换会被解释而损坏产物
  const doc = html
    .replace('<link rel="stylesheet" href="/style.css" />', () => `<style>${css}</style>`)
    .replace('<script src="/app.js"></script>', () => scriptTag);
  const file = out || path.join(ROOT, 'dist', 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, doc, 'utf8');
  return { file, bytes: Buffer.byteLength(doc), profiles: Object.keys(byProfile) };
}
