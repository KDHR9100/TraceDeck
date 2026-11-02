import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCfg } from './helpers.mjs';
import { scanProfile, buildOverview, searchDocs } from '../src/scan.js';

const cfg = loadCfg();

test('扫描 demo 夹具：日期档/ISSUES/台账/CHANGELOG 全部解析', () => {
  const s = scanProfile(cfg, 'demo');
  assert.equal(s.error, undefined);
  assert.equal(s.days.length, 3);
  assert.equal(s.days[0].date, '2026-11-01'); // 倒序
  assert.equal(s.days[0].diary.done.length, 3);
  assert.equal(s.issues.length, 5);
  const states = Object.fromEntries(s.issues.map((i) => [i.id, i.state]));
  assert.equal(states['ISSUE-901'], '阻塞');
  assert.equal(states['ISSUE-902'], '待验证');
  assert.equal(states['ISSUE-900'], '已解决');
  assert.equal(states['ISSUE-904'], '登记不处理');
  assert.equal(s.ledgers[0].threads.length, 3); // 两工单线程 + 待办事项
  assert.equal(s.changelog.length, 2);
});

test('概览聚合：等谁分组与统计（today=2026-11-02，昨日档存在判断）', () => {
  const s = scanProfile(cfg, 'demo');
  const ov = buildOverview(s, '2026-11-02');
  assert.equal(ov.todayReportExists, false);
  assert.equal(ov.latestDay.date, '2026-11-01');
  assert.ok(ov.waiting.external.some((w) => /等平台/.test(w.text)));
  assert.ok(ov.waiting.user.some((w) => /等用户|AI key/.test(w.text)));
  assert.ok(ov.waiting.ready.some((w) => /订单只读回流/.test(w.text)));
  assert.equal(ov.issueStats['阻塞'], 2);
  assert.equal(ov.issueStats['已解决'], 1);
  assert.ok(ov.recentLedgerRows.length >= 5); // 台账近 7 天（相对 11-02 覆盖 10-28~11-01 行）
});

test('检索：命中台账与总日记', () => {
  const s = scanProfile(cfg, 'demo');
  const r = searchDocs(s, 'requestId');
  assert.ok(r.length >= 1);
  assert.ok(r.some((x) => x.type === '总日记' || x.type === '工单往来'));
});

test('未知 profile 报错优雅', () => {
  assert.ok(scanProfile(cfg, 'nope').error);
});
