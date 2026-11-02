// gen.js — 留痕写手：wt today（日期档两文档）/ wt weekly（周报草稿）/ wt note（便签）
// 注意：本模块会写文件，只允许作用于用户显式指定的 profile；今晚的自动化测试只打 fixtures。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { weekdayOf } from './scan.js';
import { extractWaiting } from './parse.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const target = new Date(d.getTime());
  const day = (d.getDay() + 6) % 7; // 周一=0
  target.setDate(target.getDate() - day + 3); // 所在周的周四
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target - firstThursday;
  const week = 1 + Math.round((diff / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return { year: target.getFullYear(), week: String(week).padStart(2, '0') };
}

/** wt today：在 profile.reports 下建 YYYY-MM-DD/{里程碑,总日记}.md（存在即拒绝，绝不覆盖） */
export function genToday(cfg, profileKey, dateStr = todayStr()) {
  const p = cfg.profiles[profileKey];
  if (!p) return { error: `profile 不存在: ${profileKey}` };
  if (!p.reports) return { error: '该 profile 未配置 reports 目录' };
  const dir = path.join(p.reports, dateStr);
  if (fs.existsSync(dir)) {
    return { error: `日期档已存在，不覆盖：${dir}`, created: [] };
  }
  fs.mkdirSync(dir, { recursive: true });
  const created = [];
  const weekday = weekdayOf(dateStr);
  const msTpl = fs.readFileSync(path.join(ROOT, 'templates', '里程碑.md'), 'utf8');
  const diaryTpl = fs.readFileSync(path.join(ROOT, 'templates', '总日记.md'), 'utf8');
  const msFile = path.join(dir, '里程碑.md');
  const diaryFile = path.join(dir, '总日记.md');
  fs.writeFileSync(msFile, msTpl.replaceAll('{{DATE}}', dateStr), 'utf8');
  created.push(msFile);
  fs.writeFileSync(diaryFile, diaryTpl.replaceAll('{{DATE}}', dateStr).replaceAll('{{WEEKDAY}}', weekday), 'utf8');
  created.push(diaryFile);
  return { created, date: dateStr, dir };
}

/** wt weekly：归并区间内总日记 → 周报草稿文本（默认只回字符串，由调用方决定 stdout 或 --out） */
export function genWeekly(scanned, fromStr, toStr) {
  const { year, week } = isoWeek(fromStr);
  const days = scanned.days.filter((d) => d.date >= fromStr && d.date <= toStr).sort((a, b) => (a.date > b.date ? 1 : -1));
  const done = [];
  const blockers = [];
  const nexts = [];
  for (const d of days) {
    const diary = d.diary;
    if (!diary) continue;
    for (const b of diary.done) done.push(`- [${d.date}] ${b.text}`);
    for (const b of diary.blockers) blockers.push(`- [${d.date}] ${b.text}`);
    for (const b of diary.next) {
      const w = extractWaiting(b.text);
      nexts.push(`- [${d.date}]${w ? `（${w.label}）` : ''} ${b.text}`);
    }
  }
  const lines = [];
  lines.push(`# 周报 ${year}-W${week}（${fromStr} ~ ${toStr}）`);
  lines.push('');
  lines.push('> 由 TraceDeck 从当周总日记机械归并，草稿仅此；审阅修订后自行落档 reports/。');
  lines.push('');
  lines.push('## 本周汇总');
  lines.push('- （3-6 条，从总日记归并，对外可读——请人工提炼）');
  lines.push('');
  lines.push('## 关键进展与结论');
  lines.push(...(done.length ? dedupePrefix(done) : ['-（本周无总日记记录）']));
  lines.push('');
  lines.push('## 风险与阻塞');
  lines.push(...(blockers.length ? dedupePrefix(blockers) : ['-（无）']));
  lines.push('');
  lines.push('## 下周计划');
  lines.push(...(nexts.length ? dedupePrefix(nexts) : ['-（无）']));
  lines.push('');
  return lines.join('\n');
}

function dedupePrefix(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.replace(/^-\s*\[\d{4}-\d{2}-\d{2}\]\s*/, '').slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** wt note：便签进 TraceDeck 自己的 data/inbox.md（不动任何业务仓） */
export function addNote(text, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
  const dataDir = path.join(ROOT, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'inbox.md');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '# 便签收件箱（wt note）\n\n> 随手记；写日报时消化进总日记后删除对应行。\n', 'utf8');
  }
  fs.appendFileSync(file, `- [${stamp}] ${text}\n`, 'utf8');
  return file;
}
