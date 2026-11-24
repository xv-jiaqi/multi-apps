// 审查 6042967785 的真侧车复现剧本：node holdback-scenario.mjs <out.json> <a|b|c>
// 输出里的“密钥”都是假的、按固定花样生成，方便在落库事件里找 8 字符片段。
// 打印一行 JSON：{ secrets: { 名字: 密钥主体 } }，给 check-db.mjs 用。
import { writeFileSync } from 'node:fs';
const [out, kind] = process.argv.slice(2);
const MiB = 1024 * 1024;
const init = {
  protocolVersion: 1,
  authMethods: [{ id: 'qodercli-login', name: 'Use qodercli login' }],
  agentInfo: { name: 'qoder-cli', title: 'Qoder CLI', version: '1.1.80' },
  agentCapabilities: { loadSession: true, sessionCapabilities: { close: {}, resume: {} } },
};
const steps = [];
const secrets = {};
const calls = new Map(); // toolCallId -> 已发出的累积文本（ACP 的 tool_call_update 内容是累积的）
const start = (id, title) => {
  calls.set(id, '');
  steps.push({
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: id,
      title,
      kind: 'execute',
      status: 'in_progress',
    },
  });
};
const add = (id, text, status = 'in_progress') => {
  const full = calls.get(id) + text;
  calls.set(id, full);
  steps.push({
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: id,
      status,
      content: [{ type: 'content', content: { type: 'text', text: full } }],
    },
  });
};
const done = (id) =>
  steps.push({
    update: { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed' },
  });
const wait = (ms = 400) => steps.push({ sleepMs: ms }); // 大于 DELTA_FLUSH_MS（200），让每块单独刷出

if (kind === 'a') {
  // 1 MB 截断：跨块的 ahu_ token，截断点落在 token 第 43 / 39 个字符上（总长超过 1 MiB 几个字节）。a1 = 审查原样（第二块里有空白）；a2 = 整段无空白。
  const ahu = `ahu_${'Qw9'.repeat(14)}Q`;
  secrets.ahu = ahu.slice(4);
  start('a1', 'cat big.log');
  add('a1', 'a'.repeat(MiB - 193));
  wait();
  add('a1', `${'y '.repeat(75)}${ahu.slice(0, 44)}`);
  wait();
  add('a1', `${ahu.slice(44)} done\n`);
  done('a1');
  start('a2', 'cat blob.txt');
  add('a2', 'b'.repeat(MiB - 150));
  wait();
  add('a2', `${'x'.repeat(110)}"${ahu.slice(0, 44)}`);
  wait();
  add('a2', `${ahu.slice(44)}" done\n`);
  done('a2');
} else if (kind === 'b') {
  // 任务扣留合计超过 1 MiB：A 扣着半截 JWT，17 路各 64000 无空白，然后 A 写完。
  const jwt = `eyJ${'Hh1'.repeat(10)}.${'Pp2'.repeat(30)}.${'Sg3'.repeat(10)}`;
  secrets.jwt = jwt.slice(3);
  start('A', 'print token');
  add('A', `env: JWT=${jwt.slice(0, 90)}`);
  wait();
  for (let i = 0; i < 17; i++) {
    start(`cmd${i}`, `gen ${i}`);
    add(`cmd${i}`, 'z'.repeat(64_000));
    wait(250);
  }
  add('A', `${jwt.slice(90)} done\n`);
  wait();
  done('A');
  for (let i = 0; i < 17; i++) done(`cmd${i}`);
} else if (kind === 'd') {
  // e2ee818 复审 ②③：没闭合的私钥块（head -c 400 id_rsa）分三块到达后结束；紧贴字母数字的 URL 凭据跨块。
  const pemBody = Array.from({ length: 6 }, () => `${'Kq7'.repeat(21)}K`)
    .join('\n')
    .slice(0, 360);
  secrets.pem = pemBody;
  start('d1', 'head -c 400 id_rsa');
  add('d1', '-----BEGIN RSA PRIVATE KEY-----\n');
  wait();
  add('d1', pemBody.slice(0, 150));
  wait();
  add('d1', pemBody.slice(150));
  wait();
  done('d1');
  const pw = 'Pw8'.repeat(30);
  secrets.urlpw = pw;
  start('d2', 'git remote -v');
  add('d2', `origin\txhttps://deploy:${pw.slice(0, 40)}`);
  wait();
  add('d2', `${pw.slice(40)}@git.example.com/r.git (fetch)\n`);
  done('d2');
} else {
  // continue：超过 64 KiB 的无空白长行，没写完的长 JWT 跨在强切点上。
  // c1 能切出安全前段；c2 没写完的“JWT”本身超过 64 KiB，只能整路丢弃。
  const jwt = `eyJ${'Hh1'.repeat(10)}.${'Pp2'.repeat(60)}.${'S1g'.repeat(20)}`;
  secrets.jwt = jwt.slice(3);
  start('c1', 'dump json');
  add('c1', `{"blob":"${'c'.repeat(70_000)}","jwt":"${jwt.slice(0, 150)}`);
  wait();
  add('c1', `${jwt.slice(150)}"} done\n`);
  done('c1');
  const big = `eyJ${'Bb7'.repeat(23_000)}`;
  secrets.bigjwt = big.slice(3, 3 + 3000);
  start('c2', 'dump token');
  add('c2', `ok "${big.slice(0, 40_000)}`);
  wait();
  add('c2', big.slice(40_000));
  wait();
  add('c2', `.${'Tt5'.repeat(10)}" done\n`);
  done('c2');
  secrets.bigtail = 'Tt5'.repeat(10);
}
steps.push({
  update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '完成。' } },
});
const MODES = ['default', 'yolo'];
const cfg = {
  modes: { currentModeId: 'default', availableModes: MODES.map((id) => ({ id, name: id })) },
  configOptions: [
    {
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: 'default',
      options: MODES.map((value) => ({ value, name: value })),
    },
  ],
};
writeFileSync(
  out,
  JSON.stringify({
    initialize: init,
    handlers: {
      'session/new': { reply: cfg },
      'session/set_config_option': { reply: { configOptions: cfg.configOptions } },
      'session/close': { reply: {} },
      'session/prompt': { then: steps, reply: { stopReason: 'end_turn' } },
    },
  }),
);
console.info(JSON.stringify({ secrets }));
