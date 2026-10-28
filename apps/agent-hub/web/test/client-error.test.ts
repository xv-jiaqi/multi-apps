import { ApiError, createClient, errorMessage } from '../src/api/client';

describe('ApiError', () => {
  it('issues 按 path 只留第一条', () => {
    const error = new ApiError('VALIDATION_FAILED', '请求参数不合法', 400, {
      issues: [
        { path: 'prompt', message: '提示词不能为空' },
        { path: 'prompt', message: '第二条' },
        { path: 'title', message: '标题太长' },
        { path: 1, message: '忽略' },
      ],
    });
    expect([...error.issues()]).toEqual([
      ['prompt', '提示词不能为空'],
      ['title', '标题太长'],
    ]);
    expect(errorMessage(error)).toBe('请求参数不合法');
  });

  it('没连上、网络失败、坏响应和未知错误各有说明', async () => {
    const client = createClient();
    await expect(client.request('GET', '/health')).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
      status: 0,
    });
    client.configure({ baseUrl: 'http://127.0.0.1:47821', uiToken: 'token' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    await expect(client.request('GET', '/health')).rejects.toMatchObject({
      code: 'NETWORK',
      status: 0,
    });
    expect(errorMessage(new ApiError('NETWORK', 'ignored', 0, null))).toBe('连不上本地服务');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not-json', { status: 500 })),
    );
    await expect(client.request('GET', '/health')).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
      status: 500,
    });
    expect(errorMessage('nope')).toBe('出现了未知错误');
  });

  it('不发送 Idempotency-Key，契约错误原样变成 ApiError', async () => {
    const client = createClient();
    client.configure({ baseUrl: 'http://127.0.0.1:47821', uiToken: 'token' });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      expect(headers.get('Idempotency-Key')).toBeNull();
      expect(headers.get('Authorization')).toBe('Bearer token');
      return Response.json(
        {
          error: {
            code: 'TASK_BUSY',
            message: '任务正在运行，不能追问',
            details: { status: 'running' },
          },
        },
        { status: 409 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      client.request('POST', '/tasks/abc/turns', { body: { prompt: '继续' } }),
    ).rejects.toMatchObject({
      code: 'TASK_BUSY',
      status: 409,
      message: '任务正在运行，不能追问',
    });
  });
});
