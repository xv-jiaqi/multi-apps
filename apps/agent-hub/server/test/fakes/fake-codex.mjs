#!/usr/bin/env node
/**
 * 按剧本驱动的假 codex app-server（testing.md §3.1）：换行分隔 JSON-RPC，不带 jsonrpc 字段。
 * FAKE_SCENARIO 指向剧本 JSON。剧本 steps 依次执行；always 里的方法任何时候都按固定回复应答
 * （探测与建会话都会调 account/read、model/list）。
 * execCommand 步骤在 thread/start 给的 cwd 里真实执行一条只读命令，并按协议推送
 * item/started → item/commandExecution/outputDelta → item/completed。
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

const scenarioPath = process.env.FAKE_SCENARIO;
if (!scenarioPath) {
  process.stderr.write('FAKE_SCENARIO missing\n');
  process.exit(2);
}
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
if (scenario.echoEnvNames) {
  process.stderr.write(`ENV_NAMES=${Object.keys(process.env).sort().join(',')}\n`);
}

let stepIndex = 0;
let hung = false;
let threadCwd = process.cwd();
let busy = Promise.resolve();
let srvId = 0;
const waitingResponses = new Map();

function write(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function runExec(step) {
  const [cmd, ...args] = step.execCommand;
  const command = step.execCommand.join(' ');
  const base = { threadId: step.threadId, turnId: step.turnId };
  write({
    method: 'item/started',
    params: {
      ...base,
      item: {
        type: 'commandExecution',
        id: step.itemId,
        command,
        cwd: threadCwd,
        status: 'inProgress',
        exitCode: null,
        durationMs: null,
      },
    },
  });
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd: threadCwd, encoding: 'utf8' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (output) {
    write({
      method: 'item/commandExecution/outputDelta',
      params: { ...base, itemId: step.itemId, delta: output },
    });
  }
  const exitCode = r.status ?? 1;
  write({
    method: 'item/completed',
    params: {
      ...base,
      item: {
        type: 'commandExecution',
        id: step.itemId,
        command,
        cwd: threadCwd,
        status: exitCode === 0 ? 'completed' : 'failed',
        exitCode,
        durationMs: Date.now() - started,
      },
    },
  });
}

async function advanceNotifications() {
  while (stepIndex < scenario.steps.length) {
    const step = scenario.steps[stepIndex];
    if (step.notify) {
      write({ method: step.notify, params: step.params });
    } else if (step.request) {
      const id = `srv_${++srvId}`;
      stepIndex += 1;
      const response = await new Promise((r) => {
        waitingResponses.set(id, r);
        write({ id, method: step.request, params: step.params });
      });
      process.stderr.write(`SERVER_REQUEST_RESULT ${JSON.stringify(response)}\n`);
      if (step.writeFileIfAccepted && response?.result?.decision === 'accept') {
        writeFileSync(resolve(threadCwd, step.writeFileIfAccepted), step.content ?? '');
      }
      continue;
    } else if (step.execCommand) {
      runExec(step);
    } else if (step.stderr) {
      process.stderr.write(`${step.stderr}\n`);
    } else if (step.writeRaw) {
      process.stdout.write(step.writeRaw);
    } else if (step.writeFile) {
      // repeat：把 content 重复 n 次（造大文件，测 diff 截断）。
      writeFileSync(
        resolve(threadCwd, step.writeFile),
        (step.content ?? '').repeat(step.repeat ?? 1),
      );
    } else if (step.sleepMs) {
      stepIndex += 1;
      await new Promise((r) => setTimeout(r, step.sleepMs));
      continue;
    } else if (step.exit !== undefined) {
      process.exit(step.exit);
    } else if (step.hang) {
      hung = true;
      stepIndex += 1;
      return;
    } else {
      return; // expect：等请求
    }
    stepIndex += 1;
  }
}

function matches(step, method, params) {
  if (step.expect !== method) return false;
  for (const [k, v] of Object.entries(step.match ?? {})) {
    if (JSON.stringify(params?.[k]) !== JSON.stringify(v)) return false;
  }
  return true;
}

async function handleRequest(msg) {
  // recordRequests：把收到的每个请求追加到这个文件（一行一个 JSON），测试核对参数用。
  if (scenario.recordRequests) appendFileSync(scenario.recordRequests, `${JSON.stringify(msg)}\n`);
  await advanceNotifications();
  const step = scenario.steps[stepIndex];
  if (step?.expect && matches(step, msg.method, msg.params ?? {})) {
    stepIndex += 1;
    if (msg.method === 'thread/start' || msg.method === 'thread/resume')
      threadCwd = msg.params?.cwd ?? threadCwd;
    write(
      step.error ? { id: msg.id, error: step.error } : { id: msg.id, result: step.reply ?? {} },
    );
    await advanceNotifications();
    return;
  }
  const always = scenario.always?.[msg.method];
  if (always !== undefined) {
    write({ id: msg.id, result: always });
    return;
  }
  write({
    id: msg.id,
    error: { code: -32602, message: `expected ${step?.expect ?? '(end)'}, got ${msg.method}` },
  });
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (hung) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id !== undefined && msg.method) busy = busy.then(() => handleRequest(msg));
  else if (msg.id !== undefined && waitingResponses.has(msg.id)) {
    const r = waitingResponses.get(msg.id);
    waitingResponses.delete(msg.id);
    r(msg);
  }
});

if (scenario.exitOnStdinClose) {
  process.stdin.on('end', () => process.exit(0));
}
process.on('SIGTERM', () => {
  if (!scenario.ignoreSigterm) process.exit(0);
});

void advanceNotifications();
