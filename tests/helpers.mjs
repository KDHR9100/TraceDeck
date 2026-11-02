import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, 'fixtures', 'demo-workspace');

/**
 * 测试专用配置：demo 档案路径直接按 fixtures 目录构造，
 * 不依赖本地 config.json（仓库克隆后即可跑测试）。
 * 会话库路径仅从本地 config.json 读取（可选，读不到就留空）。
 */
export function loadCfg() {
  let sessionsDb = '';
  try {
    const full = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    sessionsDb = full.sessions?.db || '';
  } catch {
    // 无本地配置（如全新克隆），会话库相关测试自行降级
  }
  return {
    port: 0,
    defaultProfile: 'demo',
    sessions: { db: sessionsDb },
    profiles: {
      demo: {
        name: '演示数据（合成夹具，非真实业务）',
        root: FIXTURES,
        reports: path.join(FIXTURES, 'reports'),
        changelog: path.join(FIXTURES, 'CHANGELOG.md'),
        issues: path.join(FIXTURES, 'ISSUES.md'),
        ledgers: [path.join(FIXTURES, 'reports', '台账-演示平台往来.md')],
        highlights: [],
      },
    },
  };
}

export const TMP = path.join(ROOT, 'tmp');
export function freshTmp(name) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
