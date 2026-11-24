import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:net';

/** 已经在监听的服务器的实际端口（listen(0) 之后读）。 */
export function listeningPort(server: Pick<Server, 'address'>): number {
  const addr = server.address() as AddressInfo | string | null;
  if (!addr || typeof addr === 'string') throw new Error('server is not listening on a TCP port');
  return addr.port;
}

/**
 * 给子进程用的空闲端口：先 listen(0) 让系统分配，读出端口再关掉。子进程自己监听前有极短的窗口，
 * 调用方遇到 PORT_IN_USE 要换一个端口重试（见 e68-lifeline）。同进程里起服务直接 listen(0)。
 */
export async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', resolve);
  });
  const port = listeningPort(srv);
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}
