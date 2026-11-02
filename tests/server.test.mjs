import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCfg } from './helpers.mjs';
import { startServer, fileAllowed } from '../src/server.js';
import { exportStatic } from '../src/export.js';

let base;
let server;
before(async () => {
  const cfg = loadCfg();
  ({ server, url: base } = await startServer(cfg, { port: 0, openBrowser: false }));
});
after(() => server.close());

const get = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, body: await r.json() };
};

test('API：profiles / overview / timeline / issues / ledger', async () => {
  const prof = await get('/api/profiles');
  assert.equal(prof.status, 200);
  assert.equal(prof.body.default, 'demo');

  const ov = await get('/api/overview');
  assert.equal(ov.status, 200);
  assert.equal(typeof ov.body.todayReportExists, 'boolean');
  assert.ok(ov.body.waiting);

  const tl = await get('/api/timeline');
  assert.equal(tl.status, 200);
  assert.equal(tl.body.days.length, 3);
  assert.ok(tl.body.days[0].diary);

  const is = await get('/api/issues');
  assert.equal(is.body.issues.length, 5);

  const led = await get('/api/ledger');
  assert.equal(led.body.ledgers[0].threads.length, 3);
});

test('文件白名单：夹具内可读，夹具外（含真实业务仓路径）一律 403', async () => {
  const inside = await get(
    '/api/file?path=' + encodeURIComponent('D:/TraceDeck/fixtures/demo-workspace/CHANGELOG.md') + '&profile=demo'
  );
  assert.equal(inside.status, 200);
  assert.match(inside.body.text, /演示夹具/);

  assert.equal(fileAllowed(loadCfg(), 'demo', 'D:/ziniao-cd/config.json'), false);
  assert.equal(fileAllowed(loadCfg(), 'demo', 'D:/ziniao-cd/reports/2026-11-01/总日记.md'), false);
  const outside = await get('/api/file?path=' + encodeURIComponent('D:/ziniao-cd/config.json') + '&profile=demo');
  assert.equal(outside.status, 403);

  // 回归钉死：root=仓库根的档案（如 ziniao-cd 真实配置）也绝不能放行根下凭证文件
  const riskyCfg = loadCfg();
  riskyCfg.profiles.risky = {
    name: 'root 即仓库根的档案',
    root: 'D:/ziniao-cd',
    reports: 'D:/ziniao-cd/reports',
    changelog: 'D:/ziniao-cd/CHANGELOG.md',
    issues: 'D:/ziniao-cd/ISSUES.md',
    ledgers: ['D:/ziniao-cd/reports/台账-Wayfair往来.md'],
    highlights: [],
  };
  assert.equal(fileAllowed(riskyCfg, 'risky', 'D:/ziniao-cd/config.json'), false, 'config.json 必须被拒');
  assert.equal(fileAllowed(riskyCfg, 'risky', 'D:/ziniao-cd/AGENTS.md'), false, '根下其他文件必须被拒');
  assert.equal(fileAllowed(riskyCfg, 'risky', 'D:/ziniao-cd/CHANGELOG.md'), true, '显式登记文件应放行');
  assert.equal(fileAllowed(riskyCfg, 'risky', 'D:/ziniao-cd/reports/台账-Wayfair往来.md'), true);

  const traversal = await get(
    '/api/file?path=' + encodeURIComponent('D:/TraceDeck/fixtures/demo-workspace/../../config.json') + '&profile=demo'
  );
  assert.equal(traversal.status, 403);
});

test('搜索与会话接口不炸', async () => {
  const s = await get('/api/search?q=DEMO');
  assert.equal(s.status, 200);
  const sess = await get('/api/sessions?limit=5');
  assert.equal(sess.status, 200);
  assert.ok(Array.isArray(sess.body.sessions));
});

test('静态导出：自包含 HTML 且内嵌数据', () => {
  const cfg = loadCfg();
  const r = exportStatic(cfg, { out: path.join(process.cwd().replace(/\\/g, '/'), 'tmp', 'export-test.html') });
  assert.ok(fs.existsSync(r.file));
  const html = fs.readFileSync(r.file, 'utf8');
  assert.ok(html.includes('__TRACE_DATA__'));
  assert.ok(html.includes('总日记 2026-11-01') || html.includes('库存自动循环全程落地'));
  assert.ok(!html.includes('src="/app.js"')); // 无外部依赖
});
