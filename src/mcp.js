// mcp.js — TraceDeck MCP 服务器（零依赖：JSON-RPC 2.0 over stdio，换行分帧）
// 注册方式见 README「MCP 接入」；任何 ZCode 会话可调用工具查询进度/记便签。
// 只读数据源与看板一致；写操作仅 trace_note（TraceDeck 自身 inbox）与
// trace_today_create（业务仓日报档，存在即拒绝）。
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProfile, buildOverview, searchDocs } from './scan.js';
import { readSessions } from './sessions.js';
import { genToday, genWeekly, addNote, todayStr } from './gen.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MAX_OUT = 8000; // 单工具输出上限（字符），防撑爆上下文

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  } catch {
    console.error(
      '[tracedeck-mcp] 读不到 config.json —— 首次使用请复制 config.example.json 为 config.json 并按实际路径修改。'
    );
    process.exit(1);
  }
}

function clip(s, max = MAX_OUT) {
  s = String(s ?? '');
  return s.length > max ? s.slice(0, max) + `\n…（截断，共 ${s.length} 字符）` : s;
}

function resolveProfile(cfg, args = {}) {
  const key = args.profile || cfg.defaultProfile;
  return cfg.profiles[key] ? key : null;
}

/** 通用格式化：bullet 数组 → 文本 */
function fmtItems(items, limit = 12) {
  if (!items || !items.length) return '  （无）';
  return items
    .slice(0, limit)
    .map((b) => `  - ${(b.text || b).replace(/\s+/g, ' ').slice(0, 160)}`)
    .join('\n');
}

const TOOLS = [
  {
    name: 'trace_overview',
    description:
      'TraceDeck 进度概览：今日日报档状态、等平台/等用户/可直接开工三栏、阻塞与待验证 ISSUE、台账近 7 天动态。开工前调用一次即可掌握全局，不要问用户。',
    inputSchema: {
      type: 'object',
      properties: { profile: { type: 'string', description: '档案 key，默认 ziniao-cd' } },
    },
  },
  {
    name: 'trace_recent',
    description:
      '最近 N 天的工作日报（总日记三段式 + 里程碑），了解"之前干了什么、卡在哪、下一步"。写日报/汇报/续接工作前调用。',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string' },
        days: { type: 'number', description: '回看天数，默认 3' },
      },
    },
  },
  {
    name: 'trace_issues',
    description: 'ISSUES.md 问题登记速览，可按状态过滤（阻塞/待验证/已解决/登记不处理）。',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string' },
        status: { type: 'string', description: '可选：阻塞 | 待验证 | 已解决 | 登记不处理' },
      },
    },
  },
  {
    name: 'trace_search',
    description: '跨全部留痕文档全文检索（日期档/ISSUES/CHANGELOG/台账/工单邮件稿）。',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' }, profile: { type: 'string' } },
      required: ['q'],
    },
  },
  {
    name: 'trace_note',
    description:
      '随手记一条便签进 TraceDeck 收件箱（写日报时消化）。仅写 TraceDeck 自身 data/inbox.md，不碰业务仓。',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'trace_weekly_draft',
    description: '归并区间内总日记生成周报草稿（四段式文本），只返回不落盘。',
    inputSchema: {
      type: 'object',
      properties: { profile: { type: 'string' }, from: { type: 'string', description: 'YYYY-MM-DD，默认近 7 天' } },
    },
  },
  {
    name: 'trace_today_create',
    description:
      '为业务仓建当日日报档（reports/YYYY-MM-DD/里程碑.md+总日记.md，按 AGENTS §7 模板）。仅在用户要求写日报时调用；已存在则拒绝、绝不覆盖。',
    inputSchema: {
      type: 'object',
      properties: { profile: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD，默认今天' } },
    },
  },
  {
    name: 'trace_doctor',
    description: '数据源体检：各档案日期档/ISSUE/CHANGELOG/台账解析计数与会话库可读性。',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function callTool(cfg, name, args = {}) {
  switch (name) {
    case 'trace_overview': {
      const key = resolveProfile(cfg, args);
      if (!key) return `未知 profile: ${args.profile}`;
      const s = scanProfile(cfg, key);
      if (s.error) return s.error;
      const ov = buildOverview(s, todayStr());
      const lines = [];
      lines.push(`【${s.name}】进度概览 ${ov.today}`);
      lines.push(
        `今日档：${ov.todayReportExists ? '已建' : '未建'}；最近活动日：${ov.latestDay ? ov.latestDay.date + ' ' + ov.latestDay.weekday : '—'}；活动日累计 ${ov.dayCount} 天`
      );
      lines.push(`\n== 等平台/外部（${ov.waiting.external.length}）==\n${fmtItems(ov.waiting.external)}`);
      lines.push(`\n== 等用户（${ov.waiting.user.length}）==\n${fmtItems(ov.waiting.user)}`);
      lines.push(`\n== 可直接开工（${ov.waiting.ready.length}）==\n${fmtItems(ov.waiting.ready)}`);
      lines.push(
        `\n== ISSUE ==\n阻塞 ${ov.issueStats['阻塞'] || 0} · 待验证 ${ov.issueStats['待验证'] || 0}`
      );
      for (const i of ov.blockedIssues) lines.push(`  - ${i.id} ${i.title}`);
      if (ov.recentLedgerRows.length) {
        lines.push(`\n== 台账近 7 天（${ov.recentLedgerRows.length} 条）==`);
        for (const r of ov.recentLedgerRows.slice(0, 6))
          lines.push(`  - ${r.date} ${r.thread} · ${String(r.cells[0])} ${String(r.cells[3] || '').replace(/\s+/g, ' ').slice(0, 80)}`);
      }
      if (ov.pendingLedgerRows?.length) {
        lines.push(`\n== 台账待办行（无日期，未完结）==`);
        for (const r of ov.pendingLedgerRows)
          lines.push(`  - ${r.thread} · ${String(r.cells[0])} ${String(r.cells[2] || '')} ${String(r.cells[3] || '').replace(/\s+/g, ' ').slice(0, 80)}`);
      }
      return clip(lines.join('\n'));
    }
    case 'trace_recent': {
      const key = resolveProfile(cfg, args);
      if (!key) return `未知 profile: ${args.profile}`;
      const s = scanProfile(cfg, key);
      if (s.error) return s.error;
      const n = Math.min(Number(args.days) || 3, 14);
      const days = s.days.slice(0, n);
      const out = [];
      for (const d of days) {
        out.push(`\n######## ${d.date} ${d.weekday || ''} ########`);
        if (d.milestone) {
          out.push('— 里程碑 —');
          out.push(fmtItems([...(d.milestone.items || []), ...(d.milestone.sections || []).flatMap((x) => x.items || [])], 10));
        }
        if (d.diary) {
          out.push('— 今日完成 —');
          out.push(fmtItems(d.diary.done, 10));
          out.push('— 问题与阻塞 —');
          out.push(fmtItems(d.diary.blockers, 6));
          out.push('— 明日/下一步 —');
          out.push(fmtItems(d.diary.next, 8));
          for (const e of d.diary.extras || []) {
            out.push(`— ${e.title} —`);
            out.push(fmtItems(e.items, 8));
          }
        }
      }
      return clip(out.join('\n') || '（该档案暂无日期档）');
    }
    case 'trace_issues': {
      const key = resolveProfile(cfg, args);
      if (!key) return `未知 profile: ${args.profile}`;
      const s = scanProfile(cfg, key);
      let list = s.issues;
      if (args.status) list = list.filter((i) => i.state === args.status);
      const out = list.map(
        (i) =>
          `${i.id} [${i.state || '?'}] ${i.title}\n    登记 ${i.date || '?'}${i.statusNote ? ` ｜ ${i.statusNote.slice(0, 100)}` : ''}`
      );
      return clip(out.join('\n') || '（无匹配）');
    }
    case 'trace_search': {
      const key = resolveProfile(cfg, args);
      if (!key) return `未知 profile: ${args.profile}`;
      const s = scanProfile(cfg, key);
      const results = searchDocs(s, args.q);
      const out = results.map(
        (r) =>
          `${r.type} · ${r.title}${r.date ? ` (${r.date})` : ''}\n` +
          r.matches.map((m) => `    L${m.line}: ${m.text}`).join('\n')
      );
      return clip(out.join('\n---\n') || `（无命中：${args.q}）`);
    }
    case 'trace_note': {
      if (!args.text || !String(args.text).trim()) return 'text 不能为空';
      const f = addNote(String(args.text).trim());
      return `已记入 ${f}`;
    }
    case 'trace_weekly_draft': {
      const key = resolveProfile(cfg, args);
      if (!key) return `未知 profile: ${args.profile}`;
      const s = scanProfile(cfg, key);
      const latest = s.days[0]?.date || todayStr();
      let from = args.from;
      if (!from) {
        const d = new Date(latest + 'T12:00:00');
        d.setDate(d.getDate() - 6);
        const p = (x) => String(x).padStart(2, '0');
        from = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      }
      return clip(genWeekly(s, from, latest));
    }
    case 'trace_today_create': {
      const key = resolveProfile(cfg, args);
      if (!key) return `未知 profile: ${args.profile}`;
      const r = genToday(cfg, key, args.date || todayStr());
      if (r.error) return r.error;
      return '已创建：\n' + r.created.join('\n');
    }
    case 'trace_doctor': {
      const out = [];
      for (const [key, p] of Object.entries(cfg.profiles)) {
        const s = scanProfile(cfg, key);
        if (s.error) {
          out.push(`${key}: ✗ ${s.error}`);
          continue;
        }
        const ov = buildOverview(s, todayStr());
        out.push(
          `${key}: 日期档 ${s.days.length}（最近 ${s.days[0]?.date || '—'}）· ISSUES 阻塞${ov.issueStats['阻塞'] || 0}/待验证${ov.issueStats['待验证'] || 0} · CHANGELOG ${s.changelog.length} · 检索文档 ${s.docs.length}`
        );
      }
      if (cfg.sessions?.db) {
        const { sessions, error } = readSessions(cfg.sessions.db, { limit: 1 });
        out.push(`会话库: ${error ? '✗ ' + error : '✓ 可读'}`);
      }
      return clip(out.join('\n'));
    }
    default:
      return null; // 未知工具
  }
}

/** 纯协议处理（可测）：传 cfg 与一条请求对象，返回响应对象或 null（通知不回） */
export async function handleRpc(cfg, msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return null;
  const isNotification = msg.id === undefined || msg.id === null;
  const reply = (result) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, result });
  const error = (code, message) =>
    isNotification ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } };

  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: msg.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'tracedeck', version: '0.1.0' },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      try {
        const text = await callTool(cfg, name, args);
        if (text === null)
          return error(-32602, `未知工具: ${name}（可用：${TOOLS.map((t) => t.name).join(', ')}）`);
        return reply({ content: [{ type: 'text', text }], isError: false });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: '工具执行失败：' + e.message }], isError: true });
      }
    }
    default:
      return isNotification ? null : error(-32601, `方法不存在: ${msg.method}`);
  }
}

/** stdio 入口：换行分帧 JSON-RPC */
export async function startStdio({ stdin = process.stdin, stdout = process.stdout } = {}) {
  const cfg = loadConfig();
  const rl = readline.createInterface({ input: stdin, terminal: false });
  const write = (obj) => stdout.write(JSON.stringify(obj) + '\n');
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } });
      continue;
    }
    const resp = await handleRpc(cfg, msg);
    if (resp) write(resp);
  }
}

// 直接运行才启动 stdio（被 import 时不启动，便于测试）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startStdio().catch((e) => {
    console.error('tracedeck-mcp fatal:', e.message);
    process.exit(1);
  });
}
