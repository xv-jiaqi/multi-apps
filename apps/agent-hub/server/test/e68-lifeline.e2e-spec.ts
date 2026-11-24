import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { freePort } from './helpers/ports';

const SERVER_ENTRY = join(__dirname, '..', 'dist', 'main.js');

describe('E68 lifeline stdin', () => {
  it('E68 stdin close exits within 10s', async () => {
    // Requires build; skip gracefully if dist missing in pure unit runs
    const fs = await import('node:fs');
    if (!fs.existsSync(SERVER_ENTRY)) {
      console.warn('skip E68: dist/main.js missing — run build first');
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'ah-e68-'));
    // 端口由系统分配；子进程监听前别人抢先占了就换一个重试（PORT_IN_USE），最多 3 次。
    const start = async () => {
      const port = await freePort();
      const child = spawn(process.execPath, [SERVER_ENTRY, '--lifeline', 'stdin'], {
        env: {
          ...process.env,
          AGENT_HUB_HOME: dir,
          AGENT_HUB_PORT: String(port),
          NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const ready = await new Promise<string>((resolve, reject) => {
        let buf = '';
        const timer = setTimeout(() => reject(new Error('ready timeout')), 15000);
        child.stdout.on('data', (chunk: Buffer) => {
          buf += chunk.toString('utf8');
          const line = buf.split('\n').find((l) => l.includes('"event":"ready"'));
          if (line) {
            clearTimeout(timer);
            resolve(line);
          }
          const fatal = buf.split('\n').find((l) => l.includes('"event":"fatal"'));
          if (fatal) {
            clearTimeout(timer);
            reject(new Error(fatal));
          }
        });
        child.stderr.on('data', () => undefined);
        child.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`exited early ${code}`));
        });
      });
      return { child, ready };
    };
    let started: Awaited<ReturnType<typeof start>> | undefined;
    for (let attempt = 1; !started; attempt++) {
      try {
        started = await start();
      } catch (e) {
        if (attempt >= 3 || !String(e).includes('PORT_IN_USE')) throw e;
      }
    }
    const { child, ready } = started;

    expect(ready).toContain('"event":"ready"');
    child.stdin.end();

    const exited = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, 10000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    rmSync(dir, { recursive: true, force: true });
    expect(exited).toBe(0);
  });
});
