/**
 * 审查 6040751657：增量任意切开后，逐块脱敏的结果拼起来必须等于整段脱敏，且任何一块都不含密钥片段。
 * 测试里的密钥都是运行时拼出来的假值。
 */
import { redact } from '../common/redact';
import {
  HOLDBACK_CHARS,
  MAX_HOLD_CHARS,
  openSecretStart,
  splitForRedaction,
} from './secret-holdback';

const rep = (s: string, n: number) => s.repeat(n);
/** [整段里的写法, 必须消失的敏感部分] */
const SECRETS: Array<[string, string]> = [
  [['sk', rep('Ab3', 14)].join('-'), rep('Ab3', 14)],
  [`${'gh'}p_${rep('Zq9', 9)}`, rep('Zq9', 9)],
  [`github${'_pat_'}${rep('Pt7_', 8)}`, rep('Pt7_', 8)],
  [`ahu${'_'}${rep('Hu5', 14)}x`, `${rep('Hu5', 14)}x`],
  [`AKIA${'QW3RTY7UIOP2ASDF'}`, 'QW3RTY7UIOP2ASDF'],
  [`xoxb${'-'}${rep('Sl4', 6)}`, rep('Sl4', 6)],
  [`eyJ${rep('Jw1', 4)}.${rep('Pl2', 4)}.${rep('Sg3', 4)}`, `${rep('Pl2', 4)}.${rep('Sg3', 4)}`],
  ['https://deploy:' + rep('Pw8', 6) + '@git.example.com/r.git', rep('Pw8', 6)],
  ['ssh://git:' + rep('Ss6', 6) + '@host/r', rep('Ss6', 6)],
  ['Authorization: Bearer ' + rep('Br2', 8), rep('Br2', 8)],
  ['x-access-token:  ' + rep('Xa1', 8), rep('Xa1', 8)],
  [
    `-----BEGIN RSA ${'PRIVATE'} KEY-----\n${rep(rep('Pk4', 20) + '\n', 4)}-----END RSA PRIVATE KEY-----`,
    rep('Pk4', 20),
  ],
];

const TEXT = SECRETS.map(([s], i) => `line ${i} 输出 OPENAI_KEY=${s} 结束\n`).join('');
/** 敏感部分里任意 8 个连续字符。 */
const FRAGMENTS = [
  ...new Set(
    SECRETS.flatMap(([, body]) =>
      Array.from({ length: body.length - 7 }, (_, i) => body.slice(i, i + 8)),
    ),
  ),
];

/** 模拟 EventStore 的一路输出：每块到来时拼上扣住的尾巴再切，最后 final。 */
function stream(chunks: string[]): string[] {
  const out: string[] = [];
  let hold = '';
  for (const c of chunks) {
    const r = splitForRedaction(hold + c);
    if (r.emit) out.push(r.emit);
    hold = r.hold;
  }
  const r = splitForRedaction(hold, true);
  if (r.emit) out.push(r.emit);
  return out;
}

function check(chunks: string[]): void {
  const full = chunks.join('');
  const pieces = stream(chunks);
  expect(pieces.join('')).toBe(full);
  // 拼起来等于整段脱敏，而整段脱敏不含任何敏感片段（第一个用例），所以每一块都不含。
  const red = pieces.map(redact).join('');
  if (red !== redact(full)) expect(red).toBe(redact(full));
}

/** 固定种子的伪随机数，失败可复现。 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

describe('secret-holdback', () => {
  it('前提：整段脱敏能去掉全部敏感部分', () => {
    const red = redact(TEXT);
    for (const f of FRAGMENTS) expect(red).not.toContain(f);
  });

  it('HOLDBACK_CHARS 不小于 redact.ts 各模式最短匹配的最大值（ahu_ token 47）', () => {
    expect(HOLDBACK_CHARS).toBeGreaterThanOrEqual(4 + 43);
  });

  it('切成两块：任意位置', () => {
    for (let p = 0; p <= TEXT.length; p++) check([TEXT.slice(0, p), TEXT.slice(p)]);
  });

  it('每个密钥单独切成三块：任意两个位置', () => {
    for (const [s] of SECRETS) {
      const t = `前缀 KEY=${s} 后缀`;
      for (let a = 0; a <= t.length; a++)
        for (let b = a; b <= t.length; b++) check([t.slice(0, a), t.slice(a, b), t.slice(b)]);
    }
  });

  it('切成很多块：随机位置 500 次，含逐字符', () => {
    check([...TEXT]);
    const r = rng(6040751657);
    for (let n = 0; n < 500; n++) {
      const cuts = Array.from({ length: 1 + Math.floor(r() * 30) }, () =>
        Math.floor(r() * TEXT.length),
      ).sort((x, y) => x - y);
      const chunks: string[] = [];
      let prev = 0;
      for (const c of [...cuts, TEXT.length]) {
        chunks.push(TEXT.slice(prev, c));
        prev = c;
      }
      check(chunks);
    }
  });

  it('结束时 final 把扣住的全部放出', () => {
    expect(splitForRedaction('OPENAI_KEY=sk-abc')).toEqual({ emit: '', hold: 'OPENAI_KEY=sk-abc' });
    expect(splitForRedaction('OPENAI_KEY=sk-abc', true)).toEqual({
      emit: 'OPENAI_KEY=sk-abc',
      hold: '',
    });
  });

  it('只切在空白之后，且末尾至少扣 HOLDBACK_CHARS 个字符', () => {
    const t = rep('word ', 100);
    const { emit, hold } = splitForRedaction(t);
    expect(emit.endsWith(' ')).toBe(true);
    expect(hold.length).toBeGreaterThanOrEqual(HOLDBACK_CHARS);
  });

  it('不切在 Authorization / Bearer 前缀后面', () => {
    const t = `curl -H "Authorization: Bearer ${rep(' ', 1)}`;
    const padded = rep('x ', 40) + t + rep('y', 70);
    const { emit } = splitForRedaction(padded);
    expect(emit).not.toMatch(/authorization/i);
  });

  it('没闭合的 PEM 私钥块整块扣住（含 BEGIN 行写了一半）', () => {
    const begin = `-----BEGIN OPENSSH ${'PRIVATE'} KEY-----\n`;
    const body = rep(`${rep('Ok9', 20)}\n`, 10);
    const { emit } = splitForRedaction(`intro text here ${rep('a ', 40)}${begin}${body}`);
    expect(emit).not.toContain('-----BEGIN');
    expect(emit).not.toContain('Ok9');
  });

  it('超过 MAX_HOLD_CHARS 的无空白长串才强行切，且不切开代理对', () => {
    const long = rep('a', MAX_HOLD_CHARS + 100);
    expect(splitForRedaction(long).emit.length).toBe(long.length - HOLDBACK_CHARS);
    expect(splitForRedaction(rep('a', 1000)).emit).toBe('');
    const emoji = rep('😀', MAX_HOLD_CHARS);
    const { emit, hold } = splitForRedaction(emoji);
    expect(emit + hold).toBe(emoji);
    expect(emit.length % 2).toBe(0);
  });

  describe('PR3 回归（审查 6041423500 第 1、5 条）', () => {
    /** 只看密钥：拼回原文 + 逐块脱敏后没有 body 的任何 8 字符片段。 */
    function noLeak(chunks: string[], body: string): void {
      const pieces = stream(chunks);
      expect(pieces.join('')).toBe(chunks.join(''));
      for (const piece of pieces.map(redact))
        for (let i = 0; i + 8 <= body.length; i++)
          if (piece.includes(body.slice(i, i + 8)))
            expect(piece).not.toContain(body.slice(i, i + 8));
    }

    it('超过 64 KiB 的无空白文本（紧凑 JSON）后面跟密钥：强切点附近逐位都不切开密钥', () => {
      const body = rep('Jx5', 14);
      const json = `{"blob":"${rep('a', 70_000)}","key":"${['sk', body].join('-')}","pad":"${rep('b', 200)}"}`;
      const k = json.indexOf('sk-');
      for (let p = k; p <= k + body.length + HOLDBACK_CHARS + 8; p++) {
        noLeak([json.slice(0, p), json.slice(p)], body);
      }
    });

    it('超长无空白文本里的 JWT / ahu_ token 也不被强切', () => {
      for (const [secret, body] of [
        [
          `eyJ${rep('Aa1', 4)}.${rep('Bb2', 6)}.${rep('Cc3', 6)}`,
          `${rep('Bb2', 6)}.${rep('Cc3', 6)}`,
        ],
        [`ahu_${rep('Hh7', 14)}q`, `${rep('Hh7', 14)}q`],
      ] as const) {
        const t = `${rep('z', MAX_HOLD_CHARS + 10)},${secret},${rep('t', 200)}`;
        const k = t.indexOf(secret);
        for (let p = k; p <= k + secret.length + HOLDBACK_CHARS + 4; p++)
          noLeak([t.slice(0, p), t.slice(p)], body);
      }
    });

    it('Authorization: 后面隔了 300 个空白再跟 token：每个切点都不漏', () => {
      const body = rep('Tk3', 10);
      const t = `${rep('x ', 40)}Authorization:${rep(' ', 300)}Bearer ${body}\nnext\n`;
      for (let p = 0; p <= t.length; p++) noLeak([t.slice(0, p), t.slice(p)], body);
    });

    // scheme 紧贴冒号（authorization:bearer）时，原来的 SCHEME 要求前面是空白，认不出前缀；
    // 后面再跟 ≥64 个空白、token 下一块才到，就会把前缀放出去（#319 审查 6044795708 非阻塞 ①）。
    it.each([
      ['authorization:bearer', 'authorization:bearer'],
      ['Authorization=Basic', 'Authorization=Basic'],
      ['x-access-token:token', 'x-access-token:token'],
    ])('%s 后跟 100 个空白、token 下一块才到：不漏', (_n, head) => {
      const body = rep('Tk7', 10);
      const t = `${rep('x ', 40)}${head}${rep(' ', 100)}${body}\nnext\n`;
      const cut = t.indexOf(body);
      noLeak([t.slice(0, cut), t.slice(cut)], body);
      for (let p = 0; p <= t.length; p++) noLeak([t.slice(0, p), t.slice(p)], body);
    });
  });

  describe('线性时间（#315 之后自查）', () => {
    // 原来的 `…\S*$` 正则在 1 MiB 重复的 “authorization:” 上要跑 4 分多钟。
    it.each([
      ['authorization:', `${'authorization:'.repeat(75_000)} x`],
      ['x-access-token=', `${'x-access-token='.repeat(70_000)} x`],
      ['sk-', `${'sk-'.repeat(350_000)} x`],
      ['ahu_', `${'ahu_'.repeat(260_000)} x`],
      ['-----BEGIN', '-----BEGIN '.repeat(95_000)],
      ['-----END', '-----END A'.repeat(100_000)],
    ])('%s 重复 1 MiB：splitForRedaction 在 2 秒内返回', (_n, text) => {
      const t0 = Date.now();
      splitForRedaction(text, 'continue');
      splitForRedaction(text, 'truncate', text.length - 100);
      expect(Date.now() - t0).toBeLessThan(2000);
    });
  });

  describe('长行强切不切开没写完的密钥（审查 6042967785 第 6 条）', () => {
    const tokens: Array<[string, string]> = [
      ['ahu', `ahu_${'Qw9'.repeat(14)}Q`],
      ['github_pat', `github_pat_${'Ab3'.repeat(30)}`],
      ['gho', `gho_${'Zq9'.repeat(30)}`],
      ['sk', `sk-${'Ab3'.repeat(40)}`],
      ['xoxb', `xoxb-${'123-'.repeat(20)}abc`],
      ['AKIA', `AKIA${'QW3RTY7UIOP2ASDF'.repeat(6)}`],
      ['jwt', `eyJ${'Hh1'.repeat(30)}.${'Pp2'.repeat(60)}.${'Sg3'.repeat(20)}`],
      ['url', `https://deploy:${'Pw8'.repeat(40)}@git.example.com/r.git`],
      ['ssh', `ssh://deploy:${'Pw8'.repeat(40)}@git.example.com/r.git`],
      ['header', `Authorization:${' '.repeat(40)}Bearer${' '.repeat(30)}${'Tk5'.repeat(40)}`],
      ['xhttps', `xhttps://deploy:${'Pw8'.repeat(40)}@git.example.com/r.git`],
      ['pem', `-----BEGIN RSA PRIVATE KEY-----\n${'Kq7'.repeat(21)}K\n${'Kq7'.repeat(21)}K`],
    ];

    // xhttps：紧贴的 x 不是密钥的一部分，密钥从 https 开始。
    const lead = (tok: string) => (tok.startsWith('x') && !tok.startsWith('xox') ? 1 : 0);

    it.each(tokens)('%s：每个长于 64 的前缀都被认成没写完的密钥', (_n, tok) => {
      const pre = `${'c'.repeat(100)}"`;
      // URL / ssh 到 @ 为止才是密钥部分，过了 @ 就已经成形（由 guardCut 负责）。
      // 认证头写出值以后，当前文字里已经有完整匹配（由 guardCut 负责），这里只查值还没出现的前缀。
      const end = tok.includes('@')
        ? tok.indexOf('@')
        : tok.startsWith('Authorization')
          ? tok.indexOf('Bearer') + 'Bearer '.length
          : tok.length;
      for (let k = HOLDBACK_CHARS + 1; k <= end; k++) {
        expect(openSecretStart(pre + tok.slice(0, k))).toBeLessThanOrEqual(pre.length + lead(tok));
      }
    });

    it.each(tokens)(
      '%s：64 KiB 以上无空白前缀 + 跨在强切点上的半截密钥，emit 不含密钥的任何部分',
      (_n, tok) => {
        const pre = `${'c'.repeat(MAX_HOLD_CHARS + 10)}"`;
        for (const k of [HOLDBACK_CHARS + 1, Math.floor(tok.length / 2) + 40, tok.length - 1]) {
          const text = pre + tok.slice(0, Math.min(k, tok.length - 1));
          const { emit, hold, seal } = splitForRedaction(text, 'continue');
          expect(emit + hold).toBe(text);
          expect(emit.length).toBeLessThanOrEqual(pre.length + lead(tok));
          expect(emit.length).toBeGreaterThan(0);
          expect(seal).toBeUndefined();
        }
      },
    );

    it('没写完的“密钥”本身超过 MAX_HOLD_CHARS：放出安全前段，返回 seal，不在里面切', () => {
      const pre = `${'c'.repeat(1000)}"`;
      const text = `${pre}eyJ${'A'.repeat(MAX_HOLD_CHARS + 10)}`;
      for (const mode of ['continue', 'force'] as const) {
        const r = splitForRedaction(text, mode);
        expect(r.seal).toBe(true);
        expect(r.emit).toBe(pre);
      }
    });

    it('超过 MAX_HOLD_CHARS 的未闭合 PEM 块不再被切开，返回 seal', () => {
      const text = `x\n-----BEGIN RSA PRIVATE KEY-----\n${'A'.repeat(MAX_HOLD_CHARS + 10)}`;
      const r = splitForRedaction(text, 'continue');
      expect(r.seal).toBe(true);
      expect(r.emit).toBe('x\n');
    });

    it('没有密钥前缀的无空白长串照旧在离末尾 64 处切，不 seal', () => {
      const text = 'a'.repeat(MAX_HOLD_CHARS + 100);
      const r = splitForRedaction(text, 'continue');
      expect(r.emit.length).toBe(text.length - HOLDBACK_CHARS);
      expect(r.seal).toBeUndefined();
    });
  });

  describe('放出模式（审查 6042967785）', () => {
    it('truncate：往回找空白没有下限；整段没有空白就整段丢掉', () => {
      const t = `start ${rep('a', MAX_HOLD_CHARS * 3)}ahu_${rep('Qw9', 10)}`;
      expect(splitForRedaction(t, 'truncate', t.length - 5)).toEqual({
        emit: 'start ',
        hold: t.slice(6),
      });
      const noWs = `${rep('a', MAX_HOLD_CHARS * 3)}ahu_${rep('Qw9', 10)}`;
      expect(splitForRedaction(noWs, 'truncate', noWs.length - 5).emit).toBe('');
    });

    it('truncate：没闭合的 PEM 块一律退到 BEGIN 前', () => {
      const begin = `-----BEGIN RSA ${'PRIVATE'} KEY-----\n`;
      const t = `intro ${begin}${rep(`${rep('Pk4', 20)}\n`, 2000)}`;
      expect(splitForRedaction(t, 'truncate', t.length - 10).emit).toBe('intro ');
    });

    it('force 与 continue 同一规则：不在末尾那段无空白文字中间切', () => {
      const jwtPart = `X=eyJ${rep('Hh1', 6)}.${rep('Pp2', 30)}`;
      for (const t of [jwtPart, `w ${rep('x ', 10)}${jwtPart}`, rep('a', MAX_HOLD_CHARS + 100)])
        expect(splitForRedaction(t, 'force')).toEqual(splitForRedaction(t, 'continue'));
      expect(splitForRedaction(jwtPart, 'force').emit).toBe('');
    });
  });
});
