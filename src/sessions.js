// sessions.js — ZCode 会话痕迹（node:sqlite 只读；读不到就优雅降级）
import { DatabaseSync } from 'node:sqlite';

/**
 * 读最近 N 条会话：title / 目录 / 起止时间 / 首条输入摘要。
 * db 结构（实测 v24）：session(id,title,directory,time_created,time_updated,last_outcome)
 *                    input_history(session_id,text,kind,time_created)
 */
export function readSessions(dbPath, { limit = 30, rootHint = null } = {}) {
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (e) {
    return { error: `会话库打不开（只读模式）：${e.message}`, sessions: [] };
  }
  try {
    const rows = db
      .prepare(
        'select id, title, directory, time_created, time_updated, last_outcome from session order by time_updated desc limit ?'
      )
      .all(limit);
    const firstInputs = new Map();
    let inputs;
    try {
      inputs = db
        .prepare("select session_id, text, time_created from input_history where kind='prompt' order by time_created asc")
        .all();
    } catch {
      inputs = [];
    }
    for (const r of inputs) {
      if (!firstInputs.has(r.session_id)) {
        firstInputs.set(r.session_id, String(r.text || '').replace(/\s+/g, ' ').slice(0, 120));
      }
    }
    const sessions = rows.map((r) => ({
      id: r.id,
      title: r.title || '(未命名会话)',
      directory: r.directory || '',
      profile: rootHint && r.directory && r.directory.toLowerCase().startsWith(String(rootHint).toLowerCase()) ? rootHint : null,
      created: r.time_created,
      updated: r.time_updated,
      durationMin: r.time_created ? Math.max(0, Math.round((r.time_updated - r.time_created) / 60000)) : null,
      outcome: r.last_outcome || '',
      firstInput: firstInputs.get(r.id) || '',
    }));
    return { sessions, error: null };
  } catch (e) {
    return { sessions: [], error: `会话查询失败：${e.message}` };
  } finally {
    try {
      db.close();
    } catch {}
  }
}
