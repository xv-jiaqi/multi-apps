export type FakeStep =
  | {
      expect: string;
      match?: Record<string, unknown>;
      reply?: unknown;
      error?: { code: number; message: string };
    }
  | { notify: string; params: unknown }
  | { request: string; params: unknown; expectResult?: Record<string, unknown> }
  | { sleepMs: number }
  | { writeRaw: string }
  | { stderr: string }
  | { writeFile: string; content: string }
  | { exit: number }
  | { hang: true };

export interface FakeScenario {
  name: string;
  protocol: 'codex' | 'acp';
  exitOnStdinClose: boolean;
  ignoreSigterm?: boolean;
  spawnGrandchild?: boolean;
  echoEnvNames?: boolean;
  steps: FakeStep[];
}
