import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiary, parseMilestone, parseIssues, parseLedger, parseChangelog, extractWaiting, bullets } from '../src/parse.js';

test('总日记：三段式 + 补记 + 等谁', () => {
  const t = `# 总日记 2026-11-01（周日）

## 今日完成
- **演示：库存自动循环全程落地**：spec→三张工单
  →收尾，测试 339 绿（换行续进同一条）。
- 第二条完成项

## 问题与阻塞
- ISSUE-901：平台故障第 3 天，等工程团队。

## 明日/下一步
- **等平台**：复查结果。
- **可直接开工**：订单只读回流。

## 晚段补记：演示证据重造
- 按对方姿势真提一次留证。
`;
  const d = parseDiary(t);
  assert.equal(d.date, '2026-11-01');
  assert.equal(d.done.length, 2);
  assert.match(d.done[0].text, /收尾，测试 339 绿/);
  assert.equal(d.blockers.length, 1);
  assert.equal(d.next.length, 2);
  assert.equal(d.extras.length, 1);
  assert.equal(d.extras[0].title, '晚段补记：演示证据重造');
  assert.equal(extractWaiting(d.next[0].text).kind, 'external');
  assert.equal(extractWaiting(d.next[1].text).kind, 'ready');
});

test('总日记：小节名变体都进「下一步」泳道（真实仓踩过的缝）', () => {
  const variants = ['## 下一步', '## 明日下一步', '## 明日下一步（等用户）', '## 明日下一步（更新）', '## 明日/下一步'];
  for (const h of variants) {
    const d = parseDiary(`# 总日记 2026-01-01\n## 今日完成\n- 甲\n## 问题与阻塞\n- 乙\n${h}\n- 丙：等平台复查。`);
    assert.equal(d.next.length, 1, `变体未进泳道: ${h}`);
    assert.equal(d.extras.length, 0, `变体被落进补记: ${h}`);
    assert.equal(extractWaiting(d.next[0].text).kind, 'external');
  }
});

test('里程碑：顶层 bullets 去掉详单行，小节保留', () => {
  const t = `# 里程碑 2026-11-01

- 🇫🇷 演示：闭环完成。
- 详单：[总日记](总日记.md)

---

## 午后：演示落地
- 按店开关两站并行。
`;
  const m = parseMilestone(t);
  assert.equal(m.date, '2026-11-01');
  assert.equal(m.items.length, 1);
  assert.equal(m.sections[0].title, '午后：演示落地');
  assert.equal(m.sections[0].items.length, 1);
});

test('ISSUES：四种状态 + 状态备注 + 字段续行', () => {
  const t = `# ISSUES.md

## 阻塞（当前链路卡点）

### ISSUE-901 · 演示：平台侧故障
- 日期：2026-10-29 ｜ 状态：阻塞（等平台工程团队，第 N 天）
- 现象：干跑提交持续报错，
  跨两行的现象描述。
- 原因：平台受理层故障。
- 处理：每日干跑探针盯守。

## 已解决

### ISSUE-900 · 演示：权限未开通
- 日期：2026-10-19 ｜ 状态：已解决（2026-10-19 实测权限开通）
- 教训：先查权限再查代码。

### ISSUE-904 · 演示：某工具集成
- 日期：2026-10-21 ｜ 状态：登记不处理（凭证面风险）
`;
  const issues = parseIssues(t);
  assert.equal(issues.length, 3);
  const a = issues[0];
  assert.equal(a.id, 'ISSUE-901');
  assert.equal(a.state, '阻塞');
  assert.match(a.statusNote, /等平台工程团队/);
  assert.match(a.fields['现象'], /跨两行的现象描述/);
  assert.equal(issues[1].state, '已解决');
  assert.equal(issues[2].state, '登记不处理');
  assert.equal(issues[0].section, '阻塞（当前链路卡点）');
});

test('ISSUES：无内联日期行时从标题抓日期（归档快照条目）', () => {
  const t = `### ISSUE-905 · 状态更新（2026-10-20）：某线归档快照
> 说明：本条已归档，不再追加。
- 现象：历史快照，无"日期｜状态"字段行。
`;
  const [i] = parseIssues(t);
  assert.equal(i.date, '2026-10-20');
  assert.equal(i.state, null); // 归档快照无状态行，前端归"归档/未标注"列
});

test('台账：线程/表行/分隔行/线程状态', () => {
  const t = `# 演示台账

> 说明行

## 工单线程 DEMO-1（主线）

| # | 日期 | 方向 | 概要 |
|---|---|---|---|
| W1 | 2026-10-28 | 我方→平台 | 提交 ✅ |
| W2 | 2026-10-29 | 平台→我方 | 回复 |

**线程状态**：等工程团队。
`;
  const led = parseLedger(t);
  assert.equal(led.threads.length, 1);
  assert.equal(led.threads[0].rows.length, 3); // 表头 + 2 行（分隔行已剔除）
  assert.equal(led.threads[0].rows[1][0], 'W1');
  assert.match(led.threads[0].status, /等工程团队/);
});

test('CHANGELOG：条目 + 分节 + 续行归并', () => {
  const t = `# CHANGELOG

## [2026-11-01] 演示条目

### Added
- 新功能一行
  续行并入。
### Security
- 无新变更。

## [2026-10-31] 另一条
### Fixed
- 修复。
`;
  const entries = parseChangelog(t);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].date, '2026-11-01');
  assert.equal(entries[0].topic, '演示条目');
  assert.match(entries[0].sections['Added'][0], /续行并入/);
  assert.equal(entries[0].sections['Security'].length, 1);
  assert.equal(entries[1].sections['Fixed'].length, 1);
});

test('bullets：空行截断续行', () => {
  const out = bullets(['- 甲', '  续行', '', '- 乙']);
  assert.equal(out.length, 2);
  assert.match(out[0].text, /续行/);
  assert.equal(out[1].text, '乙');
});
