// 从侧车的 hub.db 取出一个任务的落库事件，检查有没有密钥片段：node check-db.mjs <hub.db> <taskId> '<secrets json>'
// hub.db 存的是原文（Hub UI 看原文）；桥接方拿到的是每条事件单独 redact() 之后的样子（local-api.md §3.4）。
// 所以按桥接方的视角检查：每条事件先单独 redact，再看单条、同一路相邻两条拼接、整路拼接里有没有
// 任何密钥主体的 8 字符片段。另外列出原文里密钥是否完整落在同一条事件里。
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
const { redact } = createRequire(import.meta.url)('../../dist/common/redact.js');
const [dbPath, taskId, secretsJson] = process.argv.slice(2);
const { secrets } = JSON.parse(secretsJson);
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db
  .prepare('SELECT seq, type, payload FROM events WHERE task_id = ? ORDER BY seq')
  .all(taskId);
const frags = Object.entries(secrets).flatMap(([name, body]) => {
  const out = new Set();
  for (let i = 0; i + 8 <= body.length; i++) out.add(body.slice(i, i + 8));
  return [...out].map((f) => [name, f]);
});
const hit = (s) => frags.find(([, f]) => s.includes(f));
const streams = new Map();
let leaks = 0;
const counts = {};
for (const r of rows) {
  const raw = JSON.parse(r.payload);
  const ev = typeof raw.text === 'string' ? { ...raw, text: redact(raw.text) } : raw;
  counts[r.type] = (counts[r.type] ?? 0) + 1;
  const all = JSON.stringify(ev);
  for (const [name, body] of Object.entries(secrets))
    if (typeof raw.text === 'string' && raw.text.includes(body))
      console.info(
        `  原文 seq=${r.seq} ${r.type}/${raw.itemId} 完整含 ${name}（单条 redact 后：${ev.text.includes(body) ? '仍在！' : '已脱敏'}）`,
      );
  const h = hit(all);
  if (h) {
    leaks++;
    console.info(`LEAK seq=${r.seq} ${r.type} 单条含 ${h[0]} 片段 ${h[1]}`);
  }
  if (typeof ev.text === 'string' && ev.itemId) {
    const k = `${r.type}/${ev.itemId}`;
    if (!streams.has(k)) streams.set(k, []);
    streams.get(k).push({ seq: r.seq, text: ev.text, truncated: ev.truncated === true });
  }
}
console.info(`events=${rows.length} 各类型条数=${JSON.stringify(counts)}`);
for (const [k, list] of streams) {
  for (let i = 0; i + 1 < list.length; i++) {
    const h = hit(list[i].text + list[i + 1].text);
    if (h) {
      leaks++;
      console.info(`LEAK ${k} seq=${list[i].seq}+${list[i + 1].seq} 拼接含 ${h[0]} 片段 ${h[1]}`);
    }
  }
  const whole = list.map((e) => e.text).join('');
  const h = hit(whole);
  if (h) {
    leaks++;
    console.info(`LEAK ${k} 整路拼接含 ${h[0]} 片段 ${h[1]}`);
  }
  const tail = whole.slice(-60).replace(/\n/g, '\\n');
  console.info(
    `  ${k}: ${list.length} 条，单条脱敏后拼接 ${whole.length} 字符，truncated 标记=${list.some((e) => e.truncated)}，结尾 …${JSON.stringify(tail)}`,
  );
}
for (const r of rows) {
  const ev = JSON.parse(r.payload);
  if (ev.type === 'notice') console.info(`  notice seq=${r.seq} ${ev.code}: ${ev.message}`);
}
console.info(
  leaks === 0 ? 'RESULT 没有任何密钥片段（单条 / 相邻拼接 / 整路拼接）' : `RESULT ${leaks} 处泄漏`,
);
process.exitCode = leaks === 0 ? 0 : 1;
