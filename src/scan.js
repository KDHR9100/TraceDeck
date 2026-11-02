// scan.js — 扫描一个 profile 的全部留痕数据源 → 结构化模型（全程只读）
import fs from 'node:fs';
import path from 'node:path';
import { parseDiary, parseMilestone, parseIssues, parseLedger, parseChangelog, extractWaiting, dateOf } from './parse.js';

export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function weekdayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
}

/** reports/ 目录下所有日期档 + 根部散件索引 */
function scanReports(reportsDir) {
  const days = [];
  const looseDocs = [];
  let names = [];
  try {
    names = fs.readdirSync(reportsDir);
  } catch {
    return { days, looseDocs, found: false };
  }
  for (const name of names) {
    const full = path.join(reportsDir, name);
    let st = null;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
      const msFile = path.join(full, '里程碑.md');
      const diaryFile = path.join(full, '总日记.md');
      const ms = exists(msFile) ? parseMilestone(readText(msFile) || '') : null;
      const diary = exists(diaryFile) ? parseDiary(readText(diaryFile) || '') : null;
      days.push({
        date: name,
        weekday: weekdayOf(name),
        dir: full,
        milestone: ms,
        diary,
        extras: fs
          .readdirSync(full)
          .filter((f) => /\.(md|json)$/i.test(f) && f !== '里程碑.md' && f !== '总日记.md'),
      });
    } else if (st.isFile() && /\.(md)$/i.test(name) && name !== 'README.md') {
      looseDocs.push({ name, path: full, date: dateOf(name), type: classifyLoose(name) });
    }
  }
  days.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { days, looseDocs, found: true };
}

function classifyLoose(name) {
  if (/^TICKET-/i.test(name)) return '工单往来';
  if (/^EMAIL-/i.test(name)) return '邮件往来';
  if (/^CASE|^case/i.test(name)) return '客服案';
  if (/^VAT-/i.test(name)) return 'VAT 线';
  if (/^weekly-/i.test(name)) return '周报';
  if (/^REPORT-|^STATUS-/i.test(name)) return '对上汇报';
  if (/^HANDOFF-/i.test(name)) return '交接';
  if (/^DS-BRIEF/i.test(name)) return '设计简报';
  if (/daily-/i.test(name)) return '旧版日报';
  return '一手记录';
}

/** 全文检索索引：日期档全文 + 根部散件 + CHANGELOG + ISSUES + 台账 */
function buildDocIndex(scanRoots) {
  const docs = [];
  for (const doc of scanRoots) {
    const text = readText(doc.path);
    if (text == null) continue;
    docs.push({ ...doc, text, lines: text.split(/\r?\n/) });
  }
  return docs;
}

export function scanProfile(cfg, profileKey) {
  const p = cfg.profiles[profileKey];
  if (!p) return { error: `profile 不存在: ${profileKey}` };
  const reports = scanReports(p.reports);
  const issuesText = p.issues ? readText(p.issues) : null;
  const issues = issuesText != null ? parseIssues(issuesText) : [];
  const changelogText = p.changelog ? readText(p.changelog) : null;
  const changelog = changelogText != null ? parseChangelog(changelogText) : [];
  const ledgers = (p.ledgers || []).map((file) => ({
    file,
    name: path.basename(file, '.md'),
    found: exists(file),
    ...(exists(file) ? parseLedger(readText(file) || '') : { threads: [], intro: [] }),
  }));
  const highlights = (p.highlights || [])
    .map((h) => ({ ...h, found: exists(h.path) }));

  // 检索索引：日期档两文档全文 + 散件 + 主文件
  const docFiles = [];
  for (const d of reports.days) {
    docFiles.push({ type: '里程碑', title: `里程碑 ${d.date}`, path: path.join(d.dir, '里程碑.md'), date: d.date });
    docFiles.push({ type: '总日记', title: `总日记 ${d.date}`, path: path.join(d.dir, '总日记.md'), date: d.date });
  }
  for (const l of reports.looseDocs) docFiles.push({ type: l.type, title: l.name, path: l.path, date: l.date });
  if (p.issues && issuesText != null) docFiles.push({ type: 'ISSUES', title: 'ISSUES.md', path: p.issues, date: null });
  if (p.changelog && changelogText != null) docFiles.push({ type: 'CHANGELOG', title: 'CHANGELOG.md', path: p.changelog, date: null });
  for (const l of ledgers) docFiles.push({ type: '台账', title: l.name, path: l.file, date: null });
  const docs = buildDocIndex(docFiles);

  return {
    profile: profileKey,
    name: p.name,
    root: p.root,
    reportsFound: reports.found,
    days: reports.days,
    looseDocs: reports.looseDocs,
    issues,
    changelog,
    ledgers,
    highlights,
    docs: docs.map((d) => ({ type: d.type, title: d.title, path: d.path, date: d.date, lines: d.lines })),
  };
}

/** 全文检索：返回 [{type,title,path,date,matches:[{line:no,text}]}] */
export function searchDocs(scanned, query, { maxPerDoc = 5, maxDocs = 40 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const doc of scanned.docs || []) {
    const matches = [];
    for (let i = 0; i < doc.lines.length && matches.length < maxPerDoc; i++) {
      if (doc.lines[i].toLowerCase().includes(q)) {
        matches.push({ line: i + 1, text: doc.lines[i].trim().slice(0, 240) });
      }
    }
    if (matches.length) out.push({ type: doc.type, title: doc.title, path: doc.path, date: doc.date, matches });
    if (out.length >= maxDocs) break;
  }
  return out;
}

/** 概览聚合：今天档有无 / 等谁清单 / 统计 */
export function buildOverview(scanned, todayStr) {
  const latest = scanned.days[0] || null;
  const today = scanned.days.find((d) => d.date === todayStr) || null;

  const waiting = { user: [], external: [], ready: [] };
  if (latest?.diary) {
    for (const b of [...latest.diary.next, ...latest.diary.blockers]) {
      const w = extractWaiting(b.text);
      const item = { text: b.text, date: latest.date, source: '总日记' };
      if (w) waiting[w.kind].push(item);
      else waiting.external.push(item);
    }
  }
  const blockedIssues = scanned.issues.filter((i) => i.state === '阻塞');
  const pendingIssues = scanned.issues.filter((i) => i.state === '待验证');

  // 台账近 7 天动态
  const weekAgo = new Date(todayStr + 'T12:00:00');
  weekAgo.setDate(weekAgo.getDate() - 7);
  const recentLedgerRows = [];
  for (const led of scanned.ledgers) {
    for (const th of led.threads) {
      for (const row of th.rows) {
        const d = dateOf(row.join(' '));
        if (!d) continue;
        const dt = new Date(d + 'T12:00:00');
        if (dt >= weekAgo) recentLedgerRows.push({ ledger: led.name, thread: th.title, cells: row, date: d });
      }
    }
  }
  recentLedgerRows.sort((a, b) => (a.date < b.date ? 1 : -1));

  // 无日期台账行（如"待办"）——不进近7天泳道，但属未完结动作，单独列出防漏
  const pendingLedgerRows = [];
  for (const led of scanned.ledgers) {
    for (const th of led.threads) {
      for (const row of th.rows.slice(1)) {
        if (!dateOf(row.join(' ')) && row.join('').trim()) {
          pendingLedgerRows.push({ ledger: led.name, thread: th.title, cells: row });
        }
      }
    }
  }

  const issueStats = {};
  for (const i of scanned.issues) if (i.state) issueStats[i.state] = (issueStats[i.state] || 0) + 1;

  return {
    today: todayStr,
    todayReportExists: !!today,
    latestDay: latest ? { date: latest.date, weekday: latest.weekday } : null,
    dayCount: scanned.days.length,
    waiting,
    blockedIssues,
    pendingIssues,
    issueStats,
    recentLedgerRows: recentLedgerRows.slice(0, 15),
    pendingLedgerRows: pendingLedgerRows.slice(0, 10),
    changelogLatest: scanned.changelog[0] || null,
    highlights: scanned.highlights,
  };
}
