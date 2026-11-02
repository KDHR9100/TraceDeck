import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCfg, freshTmp } from './helpers.mjs';
import { genToday, genWeekly, addNote, isoWeek } from '../src/gen.js';
import { scanProfile } from '../src/scan.js';

test('wt today：建日期档两文档（打在临时目录，非真实仓）', () => {
  const cfg = loadCfg();
  const tmp = freshTmp('today');
  cfg.profiles.demo.reports = tmp; // 指向临时目录
  const r = genToday(cfg, 'demo', '2026-11-02');
  assert.ok(r.created.length === 2);
  assert.ok(fs.existsSync(path.join(tmp, '2026-11-02', '里程碑.md')));
  const diary = fs.readFileSync(path.join(tmp, '2026-11-02', '总日记.md'), 'utf8');
  assert.match(diary, /# 总日记 2026-11-02（周一）/);
  // 第二次拒绝（防覆盖）
  const r2 = genToday(cfg, 'demo', '2026-11-02');
  assert.match(r2.error, /已存在/);
});

test('wt weekly：归并总日记 → 周报草稿四段式', () => {
  const cfg = loadCfg();
  const s = scanProfile(cfg, 'demo');
  const text = genWeekly(s, '2026-10-26', '2026-11-01');
  assert.match(text, /# 周报 \d{4}-W\d{2}（2026-10-26 ~ 2026-11-01）/);
  assert.match(text, /## 关键进展与结论/);
  assert.match(text, /\[2026-11-01\]/);
  assert.match(text, /## 风险与阻塞/);
  assert.match(text, /## 下周计划/);
  assert.match(text, /（等用户）|（等平台\/外部）/);
});

test('isoWeek：跨年边界不自爆', () => {
  const a = isoWeek('2026-01-01');
  assert.ok(/^\d{4}$/.test(String(a.year)));
  assert.ok(Number(a.week) >= 1 && Number(a.week) <= 53);
  const b = isoWeek('2026-11-02'); // 周一
  assert.equal(b.week, '45');
});

test('wt note：便签落 TraceDeck 自己的 data/（gitignore，不碰业务仓）', () => {
  const f = addNote('测试便签-自动化');
  const text = fs.readFileSync(f, 'utf8');
  assert.match(text, /测试便签-自动化/);
});
