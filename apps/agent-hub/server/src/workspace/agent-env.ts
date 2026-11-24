const BASE_KEYS = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TERM', 'TMPDIR', 'TZ'] as const;

export interface AgentEnvInput {
  parent: Readonly<Record<string, string | undefined>>;
  /** 登录 shell 解析出的 PATH（adapter-interface.md §8.1）。 */
  loginPath: string;
  passthrough: readonly string[];
  hooksPath: string;
  askpassPath: string;
  ghConfigDir: string;
}

/** 按白名单构造 Agent 子进程环境，再盖上 git 守卫变量。不从父进程继承其余变量。 */
export function agentEnv(input: AgentEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of BASE_KEYS) {
    const value = input.parent[key];
    if (value) env[key] = value;
  }
  for (const [key, value] of Object.entries(input.parent)) {
    if (key.startsWith('LC_') && value) env[key] = value;
  }
  env.PATH = input.loginPath;
  for (const name of input.passthrough) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) continue;
    const value = input.parent[name];
    if (value !== undefined) env[name] = value;
  }
  env.GIT_ALLOW_PROTOCOL = 'file';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_ASKPASS = input.askpassPath;
  env.SSH_ASKPASS = input.askpassPath;
  env.GIT_CONFIG_COUNT = '1';
  env.GIT_CONFIG_KEY_0 = 'core.hooksPath';
  env.GIT_CONFIG_VALUE_0 = input.hooksPath;
  env.GH_CONFIG_DIR = input.ghConfigDir;
  delete env.SSH_AUTH_SOCK;
  return env;
}
