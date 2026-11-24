export interface PushPolicy {
  allowedHosts: readonly string[];
  blockedHosts: readonly string[];
  allowLocal: boolean;
}

export interface PushTarget {
  protocol: string;
  host: string | null;
}

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;

/** 支持 https、ssh、scp 写法（含 IPv6）和本机路径。host 为小写，本机路径的 host 为 null。 */
export function parsePushTarget(url: string): PushTarget {
  const raw = url.trim();
  const scheme = SCHEME.exec(raw);
  if (scheme) {
    const protocol = scheme[1]!.toLowerCase();
    if (protocol === 'file') return { protocol, host: null };
    const rest = raw.slice(scheme[0].length);
    const slash = rest.indexOf('/');
    const auth = slash === -1 ? rest : rest.slice(0, slash);
    const at = auth.lastIndexOf('@');
    const afterAuth = at === -1 ? rest : rest.slice(at + 1);
    if (afterAuth.startsWith('[')) {
      const end = afterAuth.indexOf(']');
      const host = end === -1 ? '' : afterAuth.slice(1, end);
      return { protocol, host: host === '' ? null : host.toLowerCase() };
    }
    const hostport = (slash === -1 ? afterAuth : afterAuth.slice(0, afterAuth.indexOf('/'))).split(
      ':',
    )[0];
    return {
      protocol,
      host: hostport === '' || hostport === undefined ? null : hostport.toLowerCase(),
    };
  }
  if (
    raw.startsWith('/') ||
    raw.startsWith('~/') ||
    raw.startsWith('./') ||
    raw.startsWith('../')
  ) {
    return { protocol: 'file', host: null };
  }
  const ipv6 = /^[^@\s]+@\[([^\]]+)\]:/.exec(raw);
  if (ipv6) return { protocol: 'ssh', host: ipv6[1]!.toLowerCase() };
  const scp = /^[^@\s]+@([^:\s]+):/.exec(raw);
  if (scp) return { protocol: 'ssh', host: scp[1]!.toLowerCase() };
  return { protocol: 'file', host: null };
}

function blocked(host: string, list: readonly string[]): boolean {
  for (const item of list) {
    const name = item.toLowerCase();
    if (host === name || host.endsWith(`.${name}`)) return true;
  }
  return false;
}

/** null = 允许。黑名单（含子域名）优先于白名单；白名单只做整主机匹配。 */
export function checkPushTarget(url: string, policy: PushPolicy): string | null {
  const target = parsePushTarget(url);
  if (target.host === null) {
    return policy.allowLocal ? null : '没有主机名，拒绝推送到本机路径';
  }
  if (blocked(target.host, policy.blockedHosts)) return `主机 ${target.host} 在推送黑名单里`;
  const allowed = new Set(policy.allowedHosts.map((host) => host.toLowerCase()));
  if (!allowed.has(target.host)) return `主机 ${target.host} 不在允许的推送主机里`;
  return null;
}

/** https 去掉整个 userinfo；ssh 只去掉密码，保留用户名。 */
export function stripUserinfo(url: string): string {
  const raw = url.trim();
  const scheme = SCHEME.exec(raw);
  if (scheme) {
    const protocol = scheme[1]!.toLowerCase();
    const rest = raw.slice(scheme[0].length);
    const slash = rest.indexOf('/');
    const auth = slash === -1 ? rest : rest.slice(0, slash);
    const path = slash === -1 ? '' : rest.slice(slash);
    const at = auth.lastIndexOf('@');
    if (at === -1) return raw;
    const userinfo = auth.slice(0, at);
    const host = auth.slice(at + 1);
    if (protocol === 'http' || protocol === 'https') return `${scheme[1]}://${host}${path}`;
    const colon = userinfo.indexOf(':');
    if (colon === -1) return raw;
    return `${scheme[1]}://${userinfo.slice(0, colon)}@${host}${path}`;
  }
  const withPassword = /^([^@/\s]+):([^@/\s]+)@([^:\s]+):(.+)$/.exec(raw);
  if (withPassword) return `${withPassword[1]}@${withPassword[3]}:${withPassword[4]}`;
  return raw;
}
