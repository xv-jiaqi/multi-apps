/** adapter-interface.md §7.3：JsonRpcConnection 的场景（testing.md §3）。 */
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import {
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_METHOD_NOT_FOUND,
  JsonRpcClosedError,
  JsonRpcConnection,
  JsonRpcError,
  JsonRpcTimeoutError,
  NO_RESPONSE,
  type JsonRpcConnectionOptions,
} from '../../src/adapters/jsonrpc/connection';

function pair(opts: Partial<JsonRpcConnectionOptions> = {}) {
  const toUs = new PassThrough();
  const fromUs = new PassThrough();
  const written: Array<Record<string, unknown>> = [];
  let buf = '';
  fromUs.setEncoding('utf8');
  fromUs.on('data', (c: string) => {
    buf += c;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      written.push(JSON.parse(buf.slice(0, i)) as Record<string, unknown>);
      buf = buf.slice(i + 1);
    }
  });
  const invalid: string[] = [];
  const raw: Array<[string, string]> = [];
  const conn = new JsonRpcConnection(toUs, fromUs, {
    includeJsonrpcField: false,
    onInvalidLine: (l) => invalid.push(l),
    onRaw: (d, l) => raw.push([d, l]),
    ...opts,
  });
  const feed = (obj: unknown) => toUs.write(`${JSON.stringify(obj)}\n`);
  return { conn, toUs, written, invalid, raw, feed };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('JsonRpcConnection', () => {
  it('请求 / 响应；Codex 模式不带 jsonrpc 字段', async () => {
    const { conn, written, feed } = pair();
    const p = conn.request('initialize', { a: 1 });
    await tick();
    expect(written[0]).toEqual({ id: 0, method: 'initialize', params: { a: 1 } });
    feed({ id: 0, result: { ok: true } });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it('ACP 模式写出的帧带 "jsonrpc": "2.0"；通知没有 id', async () => {
    const { conn, written } = pair({ includeJsonrpcField: true });
    conn.notify('initialized');
    void conn.request('x').catch(() => undefined);
    await tick();
    expect(written[0]).toEqual({ jsonrpc: '2.0', method: 'initialized' });
    expect(written[1]).toMatchObject({ jsonrpc: '2.0', id: 0, method: 'x' });
    conn.close();
  });

  it('多字节字符跨 chunk 不乱码', async () => {
    const { conn, toUs } = pair();
    const notes: unknown[] = [];
    conn.onNotification((_m, params) => notes.push(params));
    const line = Buffer.from(`${JSON.stringify({ method: 'n', params: { t: '你好，世界🙂' } })}\n`);
    const cut = line.indexOf(Buffer.from('世')) + 1; // 切在“世”的 UTF-8 中间
    toUs.write(line.subarray(0, cut));
    await tick();
    toUs.write(line.subarray(cut));
    await tick();
    expect(notes).toEqual([{ t: '你好，世界🙂' }]);
  });

  it('对端返回 error → JsonRpcError（code / message / data）', async () => {
    const { conn, feed } = pair();
    const p = conn.request('m');
    feed({ id: 0, error: { code: -32602, message: 'bad', data: { x: 1 } } });
    await expect(p).rejects.toMatchObject({ code: -32602, message: 'bad', data: { x: 1 } });
    await expect(p).rejects.toBeInstanceOf(JsonRpcError);
  });

  it('超时 → JsonRpcTimeoutError；之后迟到的响应被忽略', async () => {
    const { conn, feed } = pair();
    const p = conn.request('slow', undefined, { timeoutMs: 30 });
    await expect(p).rejects.toBeInstanceOf(JsonRpcTimeoutError);
    feed({ id: 0, result: 1 });
    await tick();
    expect(conn.isOpen).toBe(true);
  });

  it('signal 中止 → 以 signal.reason 失败；已中止的 signal 立即失败', async () => {
    const { conn } = pair();
    const ac = new AbortController();
    const p = conn.request('m', undefined, { signal: ac.signal, timeoutMs: null });
    ac.abort(new Error('stop'));
    await expect(p).rejects.toThrow('stop');
    const ac2 = new AbortController();
    ac2.abort(new Error('early'));
    await expect(conn.request('m', undefined, { signal: ac2.signal })).rejects.toThrow('early');
  });

  it('对端请求：处理器返回值作为 result；返回 undefined 回 null', async () => {
    const { conn, written, feed } = pair();
    conn.onRequest((method, params) => (method === 'echo' ? params : undefined));
    feed({ id: 's1', method: 'echo', params: { v: 2 } });
    feed({ id: 's2', method: 'void' });
    await tick();
    await tick();
    expect(written).toEqual([
      { id: 's1', result: { v: 2 } },
      { id: 's2', result: null },
    ]);
  });

  it('对端请求：JsonRpcError 原样回；其他异常回 -32603 且不泄露信息；NO_RESPONSE 不回', async () => {
    const { conn, written, feed } = pair();
    conn.onRequest((method) => {
      if (method === 'a') throw new JsonRpcError(-32001, 'nope', { why: 1 });
      if (method === 'b') throw new Error('secret internal');
      return NO_RESPONSE;
    });
    feed({ id: 1, method: 'a' });
    feed({ id: 2, method: 'b' });
    feed({ id: 3, method: 'c' });
    await tick();
    await tick();
    expect(written).toEqual([
      { id: 1, error: { code: -32001, message: 'nope', data: { why: 1 } } },
      { id: 2, error: { code: JSONRPC_INTERNAL_ERROR, message: 'Internal error' } },
    ]);
  });

  it('没有请求处理器时回 -32601', async () => {
    const { written, feed } = pair();
    feed({ id: 9, method: 'x' });
    await tick();
    expect(written[0]).toMatchObject({ id: 9, error: { code: JSONRPC_METHOD_NOT_FOUND } });
  });

  it('非 JSON 行、非对象、未知 id 的响应：只记 invalid，不中断连接', async () => {
    const { conn, toUs, invalid, feed } = pair();
    toUs.write('hello from stdout\n');
    toUs.write('[1,2]\n');
    feed({ id: 77, result: 1 }); // 没有对应请求：忽略
    feed({ foo: 1 });
    await tick();
    expect(invalid).toEqual(['hello from stdout', '[1,2]', '{"foo":1}']);
    expect(conn.isOpen).toBe(true);
    const p = conn.request('m');
    feed({ id: 0, result: 'ok' });
    await expect(p).resolves.toBe('ok');
  });

  it('关闭：未完成请求以 JsonRpcClosedError 失败；之后 request 立即失败、notify 忽略', async () => {
    const { conn, written, toUs } = pair();
    const p = conn.request('m', undefined, { timeoutMs: null });
    toUs.end();
    await expect(p).rejects.toBeInstanceOf(JsonRpcClosedError);
    await expect(conn.closed).resolves.toBeUndefined();
    await expect(conn.request('later')).rejects.toBeInstanceOf(JsonRpcClosedError);
    const n = written.length;
    conn.notify('ignored');
    await tick();
    expect(written.length).toBe(n);
  });

  it('超长行（没有换行）→ 关闭连接', async () => {
    const { conn, toUs, invalid } = pair({ maxLineLength: 1024 });
    const p = conn.request('m', undefined, { timeoutMs: null });
    toUs.write('x'.repeat(2048));
    await expect(p).rejects.toBeInstanceOf(JsonRpcClosedError);
    expect(conn.isOpen).toBe(false);
    expect(invalid[0]).toContain('单行超过上限');
  });

  it('onRaw 记录进出的原始帧', async () => {
    const { conn, raw, feed } = pair();
    const p = conn.request('m');
    feed({ id: 0, result: 1 });
    await p;
    expect(raw).toEqual([
      ['out', '{"id":0,"method":"m"}'],
      ['in', '{"id":0,"result":1}'],
    ]);
  });

  it('真实子进程 stdin / stdout 往返', async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `require('readline').createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);process.stdout.write(JSON.stringify({id:m.id,result:{echo:m.params,pid:process.pid}})+'\\n')})`,
      ],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    );
    const conn = new JsonRpcConnection(child.stdout, child.stdin, { includeJsonrpcField: true });
    const results = await Promise.all([
      conn.request<{ echo: unknown; pid: number }>('a', { n: '中文' }),
      conn.request<{ echo: unknown; pid: number }>('b', [1, 2]),
    ]);
    expect(results.map((r) => r.echo)).toEqual([{ n: '中文' }, [1, 2]]);
    expect(results[0]!.pid).toBe(child.pid);
    const exited = new Promise((r) => child.once('exit', r));
    child.stdin.end();
    await exited;
    await conn.closed;
    expect(conn.isOpen).toBe(false);
  });
});
