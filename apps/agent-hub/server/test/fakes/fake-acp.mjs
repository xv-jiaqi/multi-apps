#!/usr/bin/env node
/**
 * 按剧本驱动的假 ACP Agent（testing.md §3.1）：stdio 上换行分隔的 JSON-RPC 2.0，带 jsonrpc 字段。
 * FAKE_ACP_SCENARIO 指向剧本 JSON：
 *   initialize      initialize 的结果；或 initializeError、hangHandshake、exitBeforeHandshake
 *   handlers        方法 → 处理；处理也可以是数组，按该方法跨进程的第 n 次调用取第 n 项
 *                   （计数存在 <剧本>.count.json，探测进程、任务进程、恢复后的新进程共用）
 *     处理 = { then?: Step[], reply?: unknown, error?: { code, message, data? }, after?: Step[] }
 *     then 在回复前执行，after 在回复后执行；没写的方法回 -32601。
 *   ignoreSigterm   收到 SIGTERM 不退出
 *   exitOnStdinClose  默认 true：stdin 关闭即退出（三个真实 Agent 都这样，adapter-acp.md §8.2）
 * Step：
 *   { update }                         session/update（自动补 sessionId）
 *   { notify: method, params }         任意通知
 *   { request: method, params, id?, writeFileIfSelected? }  向 Hub 发请求并等回复；
 *       writeFileIfSelected { optionId, path, content }：回复选了该选项时在会话 cwd 里写文件
 *   { awaitNotify: method, timeoutMs? } 等 Hub 发来某个通知（例如 session/cancel）
 *   { sleepMs } { writeFile, content } { stderr } { writeRaw } { exit } { hang }
 * 每一帧都追加到 <剧本>.log：“<- ”是收到的，“-> ”是发出的。
 * session/prompt 并发处理（轮内 Hub 还会发 set_config_option 等），其他请求按顺序处理。
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const scenarioPath = process.env.FAKE_ACP_SCENARIO;
if (!scenarioPath) {
  process.stderr.write('FAKE_ACP_SCENARIO missing\n');
  process.exit(2);
}
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const logPath = `${scenarioPath}.log`;
const countPath = `${scenarioPath}.count.json`;

let sessionId = null;
let sessionCwd = process.cwd();
let srvId = 0;
let busy = Promise.resolve();
const waitingResponses = new Map();
const notifyWaiters = [];

if (scenario.exitBeforeHandshake) process.exit(3);
if (scenario.ignoreSigterm) process.on('SIGTERM', () => {});

function write(obj) {
  const line = JSON.stringify({ jsonrpc: '2.0', ...obj });
  appendFileSync(logPath, `-> ${line}\n`);
  process.stdout.write(`${line}\n`);
}

function nextCount(method) {
  const counts = existsSync(countPath) ? JSON.parse(readFileSync(countPath, 'utf8')) : {};
  const n = counts[method] ?? 0;
  counts[method] = n + 1;
  writeFileSync(countPath, JSON.stringify(counts));
  return n;
}

function handlerFor(method) {
  const h = scenario.handlers?.[method];
  if (!Array.isArray(h)) return h;
  const n = nextCount(method);
  return h[Math.min(n, h.length - 1)];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitNotify(method, timeoutMs) {
  return new Promise((res) => {
    const waiter = { method, res };
    notifyWaiters.push(waiter);
    if (timeoutMs) {
      setTimeout(() => {
        const i = notifyWaiters.indexOf(waiter);
        if (i >= 0) notifyWaiters.splice(i, 1);
        res(null);
      }, timeoutMs);
    }
  });
}

async function runSteps(steps) {
  for (const step of steps ?? []) {
    if (step.update) {
      write({ method: 'session/update', params: { sessionId, update: step.update } });
    } else if (step.notify) {
      write({ method: step.notify, params: step.params ?? {} });
    } else if (step.request) {
      srvId += 1;
      const id = step.id ?? `srv_${srvId}`;
      const response = new Promise((res) => waitingResponses.set(id, res));
      write({ id, method: step.request, params: { sessionId, ...(step.params ?? {}) } });
      const msg = await response;
      const w = step.writeFileIfSelected;
      if (w && msg.result?.outcome?.optionId === w.optionId) {
        const target = resolve(sessionCwd, w.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, w.content);
      }
    } else if (step.awaitNotify) {
      await waitNotify(step.awaitNotify, step.timeoutMs);
    } else if (step.sleepMs) {
      await sleep(step.sleepMs);
    } else if (step.writeFile) {
      const target = resolve(sessionCwd, step.writeFile);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, step.content ?? '');
    } else if (step.stderr) {
      process.stderr.write(`${step.stderr}\n`);
    } else if (step.writeRaw) {
      appendFileSync(logPath, `-> ${step.writeRaw}\n`);
      process.stdout.write(`${step.writeRaw}\n`);
    } else if ('exit' in step) {
      process.exit(step.exit);
    } else if (step.hang) {
      await new Promise(() => {});
    }
  }
}

async function handleRequest(msg) {
  if (msg.method === 'initialize') {
    if (scenario.hangHandshake) return;
    if (scenario.initializeError) {
      write({ id: msg.id, error: scenario.initializeError });
      return;
    }
    write({ id: msg.id, result: scenario.initialize });
    return;
  }
  if (['session/new', 'session/resume', 'session/load'].includes(msg.method)) {
    sessionCwd = msg.params?.cwd ?? sessionCwd;
  }
  const h = handlerFor(msg.method);
  if (!h) {
    write({ id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    return;
  }
  if (msg.method === 'session/resume' || msg.method === 'session/load') {
    sessionId = msg.params.sessionId;
  }
  await runSteps(h.then);
  if (h.error) {
    write({ id: msg.id, error: h.error });
  } else {
    const result = h.reply ?? {};
    if (msg.method === 'session/new') {
      sessionId = result.sessionId ?? `sess-${process.pid}`;
      write({ id: msg.id, result: { sessionId, ...result } });
    } else {
      write({ id: msg.id, result });
    }
  }
  await runSteps(h.after);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  appendFileSync(logPath, `<- ${line}\n`);
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method && msg.id !== undefined) {
    if (msg.method === 'session/prompt') void handleRequest(msg);
    else busy = busy.then(() => handleRequest(msg));
  } else if (msg.method) {
    for (const w of [...notifyWaiters]) {
      if (w.method === msg.method) {
        notifyWaiters.splice(notifyWaiters.indexOf(w), 1);
        w.res(msg);
      }
    }
  } else if (msg.id !== undefined) {
    const res = waitingResponses.get(msg.id);
    waitingResponses.delete(msg.id);
    res?.(msg);
  }
});
rl.on('close', () => {
  if (scenario.exitOnStdinClose !== false) process.exit(0);
});
