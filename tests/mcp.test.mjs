import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCfg } from './helpers.mjs';
import { handleRpc } from '../src/mcp.js';

const cfg = loadCfg();
const req = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });

test('MCP：initialize 握手返回能力', async () => {
  const r = await handleRpc(cfg, req(1, 'initialize', { protocolVersion: '2024-11-05' }));
  assert.equal(r.result.protocolVersion, '2024-11-05');
  assert.equal(r.result.serverInfo.name, 'tracedeck');
  assert.ok(r.result.capabilities.tools);
});

test('MCP：tools/list 暴露全部工具且 schema 合规', async () => {
  const r = await handleRpc(cfg, req(2, 'tools/list', {}));
  const names = r.result.tools.map((t) => t.name);
  for (const n of ['trace_overview', 'trace_recent', 'trace_issues', 'trace_search', 'trace_note', 'trace_weekly_draft', 'trace_today_create', 'trace_doctor'])
    assert.ok(names.includes(n), `缺少工具 ${n}`);
  for (const t of r.result.tools) assert.equal(t.inputSchema.type, 'object');
});

test('MCP：trace_overview 返回真实概览文本', async () => {
  const r = await handleRpc(cfg, req(3, 'tools/call', { name: 'trace_overview', arguments: {} }));
  assert.equal(r.result.isError, false);
  const text = r.result.content[0].text;
  assert.match(text, /进度概览/);
  assert.match(text, /等用户|等平台/);
});

test('MCP：trace_recent 回看最近两天', async () => {
  const r = await handleRpc(cfg, req(4, 'tools/call', { name: 'trace_recent', arguments: { days: 2 } }));
  const text = r.result.content[0].text;
  assert.match(text, /2026-11-01/);
  assert.match(text, /明日\/下一步/);
});

test('MCP：trace_note 落 inbox；trace_search 命中后可检索到', async () => {
  const stamp = `MCP测试便签-${Date.now()}`;
  const r1 = await handleRpc(cfg, req(5, 'tools/call', { name: 'trace_note', arguments: { text: stamp } }));
  assert.match(r1.result.content[0].text, /已记入/);
  assert.match(fs.readFileSync(r1.result.content[0].text.replace('已记入 ', ''), 'utf8'), new RegExp(stamp));
});

test('MCP：trace_today_create 存在即拒（防覆盖语义穿透到 MCP）', async () => {
  const r = await handleRpc(cfg, req(6, 'tools/call', { name: 'trace_today_create', arguments: { date: '2026-11-01' } }));
  assert.match(r.result.content[0].text, /已存在/);
});

test('MCP：未知工具 -32602；未知方法 -32601；通知不回包；坏 JSON 帧 -32700 由 stdio 层处理', async () => {
  const badTool = await handleRpc(cfg, req(7, 'tools/call', { name: 'nope', arguments: {} }));
  assert.equal(badTool.error.code, -32602);
  const badMethod = await handleRpc(cfg, req(8, 'resources/list', {}));
  assert.equal(badMethod.error.code, -32601);
  const notif = await handleRpc(cfg, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notif, null);
});
