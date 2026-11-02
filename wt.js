#!/usr/bin/env node
// wt.js — TraceDeck CLI（零依赖）
// 用法：node wt.js <command> [options]   详见 README.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProfile, buildOverview, searchDocs } from './src/scan.js';
import { startServer, todayLocal } from './src/server.js';
import { exportStatic } from './src/export.js';
import { genToday, genWeekly, addNote, isoWeek } from './src/gen.js';
import { readSessions } from './src/sessions.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function loadConfig() {
  const file = path.join(ROOT, 'config.json');
  if (!fs.existsSync(file)) {
    console.error('缺少 config.json（可从 config.example.json 复制改造）');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

function resolveProfile(cfg, args) {
  const key = args.profile || cfg.defaultProfile;
  if (!cfg.profiles[key]) {
    console.error(`未知档案: ${key}（可选：${Object.keys(cfg.profiles).join(', ')}）`);
    process.exit(1);
  }
  return key;
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;

const HELP = `TraceDeck 痕迹台 — 工作痕迹看板与留痕助手

  node wt.js board   [--profile 档案] [--port 7788] [--no-open]   启动本地看板（只绑 127.0.0.1）
  node wt.js export  [--profile 档案] [--out dist/index.html]     静态自包含快照（双击即看）
  node wt.js today   --profile 档案 [--date YYYY-MM-DD]           建今日日期档（里程碑+总日记，存在即拒绝）
  node wt.js weekly  --profile 档案 [--from 周一日期] [--out 文件]  归并总日记→周报草稿（默认打到 stdout）
  node wt.js issues  [--profile 档案] [--status 阻塞|待验证|已解决|登记不处理]
  node wt.js ledger  [--profile 档案]                             台账速览
  node wt.js sessions [--limit 30]                                最近 ZCode 会话（只读元数据）
  node wt.js note    "随手记一条……"                                便签进 data/inbox.md（写日报时消化）
  node wt.js doctor                                               体检：各数据源可读性+解析计数
`;

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);
  const cfg = loadConfig();

  switch (cmd) {
    case 'board': {
      const profile = resolveProfile(cfg, args);
      if (args.profile) cfg.defaultProfile = profile;
      const { url } = await startServer(cfg, { port: Number(args.port) || cfg.port, openBrowser: !args['no-open'] });
      console.log(dim(`数据源均为只读；静态快照可用 node wt.js export 生成。`));
      process.stdin.resume();
      process.on('SIGINT', () => { console.log('\nbye'); process.exit(0); });
      void url;
      break;
    }
    case 'export': {
      const profile = args.profile ? resolveProfile(cfg, args) : null;
      const r = exportStatic(cfg, { profileKeys: profile ? [profile] : null, out: args.out });
      console.log(`${ok('✓')} 快照已生成：${r.file}（${(r.bytes / 1024).toFixed(0)} KB，档案：${r.profiles.join(', ')}）`);
      break;
    }
    case 'today': {
      if (!args.profile) { console.error('请用 --profile 指定档案（今晚的自动化测试只允许打 demo 夹具）'); process.exit(1); }
      const key = resolveProfile(cfg, args);
      const r = genToday(cfg, key, args.date || todayLocal());
      if (r.error) console.log(bad('✗ ') + r.error);
      else r.created.forEach((f) => console.log(`${ok('✓')} 已建 ${f}`));
      break;
    }
    case 'weekly': {
      const key = resolveProfile(cfg, args);
      const scanned = scanProfile(cfg, key);
      if (scanned.error) { console.error(scanned.error); process.exit(1); }
      const to = args.to || scanned.days[0]?.date || todayLocal();
      let from = args.from;
      if (!from) {
        const d = new Date(to + 'T12:00:00');
        d.setDate(d.getDate() - 6);
        const p = (n) => String(n).padStart(2, '0');
        from = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      }
      const text = genWeekly(scanned, from, to);
      if (args.out) {
        fs.writeFileSync(args.out, text, 'utf8');
        console.log(`${ok('✓')} 周报草稿已写：${args.out}（${isoWeek(from).year}-W${isoWeek(from).week}）`);
      } else {
        console.log(text);
      }
      break;
    }
    case 'issues': {
      const key = resolveProfile(cfg, args);
      const { issues } = scanProfile(cfg, key);
      const list = args.status ? issues.filter((i) => i.state === args.status) : issues;
      if (!list.length) console.log(dim('（无匹配）'));
      for (const i of list) {
        console.log(`${i.state === '阻塞' ? bad('●') : i.state === '待验证' ? '\x1b[33m●\x1b[0m' : dim('●')} ${i.id} [${i.state || '?'}] ${i.title}`);
        if (i.fields['处理']) console.log(dim(`    处理：${i.fields['处理'].slice(0, 100)}`));
      }
      break;
    }
    case 'ledger': {
      const key = resolveProfile(cfg, args);
      const { ledgers } = scanProfile(cfg, key);
      for (const led of ledgers) {
        console.log(`\n== ${led.name} ${led.found ? '' : bad('(文件缺失)')}`);
        for (const th of led.threads) {
          if (!th.rows.length) continue;
          console.log(dim(`-- ${th.title}`));
          for (const r of th.rows.slice(1)) console.log(`  ${String(r[0]).padEnd(4)} ${r[1]}  ${r[2]}  ${String(r[3]).slice(0, 80)}`);
          if (th.status) console.log(dim(`   状态：${th.status.slice(0, 90)}`));
        }
      }
      break;
    }
    case 'sessions': {
      if (!cfg.sessions?.db) { console.error('config.json 未配置 sessions.db'); process.exit(1); }
      const { sessions, error } = readSessions(cfg.sessions.db, { limit: Number(args.limit) || 30 });
      if (error) console.log(bad('✗ ') + error);
      for (const s of sessions) {
        console.log(`${new Date(s.updated).toLocaleString('zh-CN', { hour12: false })}  ${s.title}  ${dim(s.directory)}`);
      }
      break;
    }
    case 'note': {
      const text = args._.join(' ') || args.text;
      if (!text) { console.error('用法：node wt.js note "内容"'); process.exit(1); }
      const f = addNote(text);
      console.log(`${ok('✓')} 便签已记入 ${f}`);
      break;
    }
    case 'doctor': {
      console.log('TraceDeck 体检\n');
      for (const [key, p] of Object.entries(cfg.profiles)) {
        console.log(`■ ${key} — ${p.name}`);
        const scanned = scanProfile(cfg, key);
        if (scanned.error) { console.log(bad('  ✗ ') + scanned.error); continue; }
        const ov = buildOverview(scanned, todayLocal());
        console.log(`  日期档 ${scanned.days.length} 天（最近 ${scanned.days[0]?.date || '—'}）· 今日档 ${ov.todayReportExists ? '有' : '无'}`);
        const st = ov.issueStats;
        console.log(`  ISSUES：阻塞 ${st['阻塞'] || 0} · 待验证 ${st['待验证'] || 0} · 已解决 ${st['已解决'] || 0} · 不处理 ${st['登记不处理'] || 0}`);
        console.log(`  CHANGELOG ${scanned.changelog.length} 条 · 台账 ${scanned.ledgers.map((l) => `${l.name}${l.found ? '' : '(缺失)'}`).join('、') || '未配置'}`);
        console.log(`  检索索引 ${scanned.docs.length} 个文档`);
      }
      if (cfg.sessions?.db) {
        const { sessions, error } = readSessions(cfg.sessions.db, { limit: 3 });
        console.log(`\n■ 会话库：${error ? bad('✗ ' + error) : ok('✓ 可读，最近 ' + sessions.length + ' 条示例')}`);
      }
      console.log(`\n今日：${todayLocal()}`);
      break;
    }
    case 'search': {
      const key = resolveProfile(cfg, args);
      const q = args._.join(' ');
      const scanned = scanProfile(cfg, key);
      const results = searchDocs(scanned, q);
      for (const r of results) {
        console.log(`\n${r.type} · ${r.title}`);
        r.matches.forEach((m) => console.log(dim(`  L${m.line}  `) + m.text));
      }
      if (!results.length) console.log(dim('（无命中）'));
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error('\x1b[31m出错：\x1b[0m' + e.message);
  process.exit(1);
});
