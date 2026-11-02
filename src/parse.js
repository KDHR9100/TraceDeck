// parse.js — 约定式 Markdown 解析（对齐 AGENTS §7 留痕格式）
// 容错优先：任何一段不符合约定就整体跳过，绝不让解析器抛错导致看板打不开。

export const ISSUE_STATES = ['已解决', '阻塞', '待验证', '登记不处理'];

/** 把一段文本按 `- `/`* `/`1. ` 切成 bullet，连续缩进行并入上一条 */
export function bullets(lines) {
  const out = [];
  const start = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;
  let cur = null;
  for (const raw of lines) {
    const m = raw.match(start);
    if (m) {
      cur = { text: m[3].trim() };
      out.push(cur);
    } else if (cur && raw.trim() && !/^(#{1,6}\s|\|)/.test(raw.trim())) {
      cur.text += ' ' + raw.trim();
    } else if (!raw.trim()) {
      cur = null;
    }
  }
  return out.filter((b) => b.text);
}

/** 按二级标题切块；返回 [{title, lines}]，标题前的内容 title 为 null */
export function splitH2(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const sections = [{ title: null, lines: [] }];
  for (const line of lines) {
    const m = line.match(/^##\s+(?!#)(.*)$/);
    if (m) sections.push({ title: m[1].trim(), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }
  return sections;
}

/** 从行文本里识别"等谁"：返回 {kind, label} | null */
export function extractWaiting(text) {
  if (/可直接开工|不等谁|无需等待/.test(text)) return { kind: 'ready', label: '可直接开工' };
  if (/等用户|等老板|等苏总|等拍板|等确认（用户）|等用户决策/.test(text)) return { kind: 'user', label: '等用户' };
  if (/等平台|等工单|等回复|等复查|等Engineering|等工程|等开通|等放行|等合同|等PDF|等 [Kk]ey|等AI key|等截图|等回函/.test(text))
    return { kind: 'external', label: '等平台/外部' };
  return null;
}

const FIELD_LABELS =
  '日期|状态|现象|原因|处理|教训|依赖|备注|行为|结论修正|结论|影响|下一步|背景|标题';

function applyStatus(value, cur) {
  const st = value.match(new RegExp(`(${ISSUE_STATES.join('|')})`));
  cur.state = st ? st[1] : '待验证';
  cur.statusNote = value
    .replace(new RegExp(`^${cur.state}\\s*`), '')
    .replace(/^[（(]|[）)]$/g, '')
    .trim();
}

/** 总日记：# 总日记 YYYY-MM-DD + 今日完成/问题与阻塞/明日(下一步) 三段式 + 任意补记段 */
export function parseDiary(text) {
  const diary = { date: null, done: [], blockers: [], next: [], extras: [], raw: text };
  const h1 = text.match(/^#\s*总日记\s*(\d{4}-\d{2}-\d{2})?/m);
  if (h1) diary.date = h1[1] || null;
  for (const sec of splitH2(text)) {
    const t = sec.title || '';
    const norm = t.replace(/\s/g, '');
    const items = bullets(sec.lines);
    if (/^今日完成/.test(norm)) diary.done = items;
    else if (/^问题与阻塞/.test(norm)) diary.blockers = items;
    else if (/^(明日)?[\/、与]?下一步/.test(norm)) diary.next = items;
    else if (t) diary.extras.push({ title: t, items });
  }
  return diary;
}

/** 里程碑：# 里程碑 YYYY-MM-DD + 顶层 bullets + 任意小节 */
export function parseMilestone(text) {
  const ms = { date: null, items: [], sections: [], raw: text };
  const h1 = text.match(/^#\s*里程碑\s*(\d{4}-\d{2}-\d{2})?/m);
  if (h1) ms.date = h1[1] || null;
  const sections = splitH2(text);
  ms.items = bullets(sections[0].lines).filter((b) => !/^详单[:：]/.test(b.text));
  for (const sec of sections.slice(1)) {
    if (sec.title) ms.sections.push({ title: sec.title, items: bullets(sec.lines) });
  }
  return ms;
}

/** ISSUES.md → [{id, title, section, date, state, statusNote, fields:{}}] */
export function parseIssues(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const issues = [];
  let cur = null;
  let curField = null;
  let section = null;
  const heading = /^#{3,4}\s+ISSUE-(\d+)\s*[·•\-—–]\s*(.+)$/;
  const field = new RegExp(`^-\\s*(${FIELD_LABELS})\\s*[：:]\\s*(.*)$`);
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h2 = line.match(/^##\s+(?!#)(.+)$/);
    if (h2 && !heading.test(line)) {
      section = h2[1].trim();
      cur = null;
      continue;
    }
    const h = line.match(heading);
    if (h) {
      cur = {
        id: `ISSUE-${h[1]}`,
        num: Number(h[1]),
        title: h[2].trim(),
        section,
        date: null,
        state: null,
        statusNote: '',
        fields: {},
      };
      issues.push(cur);
      curField = null;
      continue;
    }
    if (!cur) continue;
    // 标题内嵌日期（如"状态更新（2026-10-20）：…"）兜底
    if (!cur.date) cur.date = (cur.title.match(/(\d{4}-\d{2}-\d{2})/) || [null])[0];
    const fm = line.match(field);
    if (fm) {
      const label = fm[1];
      let value = fm[2].trim();
      curField = label;
      if (label === '日期') {
        cur.date = (value.match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
        // 实际格式常把日期与状态写在同一行：`- 日期：… ｜ 状态：已解决（…）`
        const inlineStatus = value.match(/[状态狀態]\s*[：:]\s*(.*)$/);
        if (inlineStatus) applyStatus(inlineStatus[1].trim(), cur);
      } else if (label === '状态') {
        applyStatus(value, cur);
      } else cur.fields[label] = value;
    } else if (line.trim() && curField && cur.fields[curField] !== undefined && !/^\s*[-*#|]/.test(line)) {
      cur.fields[curField] += ' ' + line.trim(); // 多行字段续行
    }
  }
  return issues;
}

/** 台账 → {threads:[{title, rows:[[cell]], status}], intro} */
export function parseLedger(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = { threads: [], intro: [] };
  let cur = null;
  let inTable = false;
  for (const line of lines) {
    const h2 = line.match(/^##\s+(?!#)(.+)$/);
    if (h2) {
      cur = { title: h2[1].trim(), rows: [], status: '' };
      out.threads.push(cur);
      inTable = false;
      continue;
    }
    if (/^\s*\|/.test(line) && cur) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue; // 分隔行
      cur.rows.push(cells);
      inTable = true;
      continue;
    }
    const st = line.match(/\*\*线程状态\*\*\s*[：:]\s*(.*)/);
    if (st && cur) {
      cur.status = st[1].trim();
      continue;
    }
    if (line.trim() && !inTable && !cur) out.intro.push(line.trim());
  }
  return out;
}

/** CHANGELOG → [{date, topic, sections:{name:[items]}}]（按原文顺序） */
export function parseChangelog(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const entries = [];
  let cur = null;
  let curSec = null;
  for (const line of lines) {
    const m = line.match(/^##\s+\[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/);
    if (m) {
      cur = { date: m[1], topic: m[2].trim(), sections: {} };
      entries.push(cur);
      curSec = null;
      continue;
    }
    if (!cur) continue;
    const s = line.match(/^###\s+(.+)$/);
    if (s) {
      curSec = s[1].trim();
      cur.sections[curSec] = [];
      continue;
    }
    if (curSec) {
      const items = bullets([line]);
      if (items.length) cur.sections[curSec].push(items[0].text);
      else if (line.trim() && cur.sections[curSec].length && !/^\s*[-*#|]/.test(line))
        cur.sections[curSec][cur.sections[curSec].length - 1] += ' ' + line.trim();
    }
  }
  return entries;
}

/** 从路径或内容里抓日期（YYYY-MM-DD） */
export function dateOf(str) {
  const m = String(str).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
