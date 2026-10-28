export function createQuitHandler(deps: {
  countActive(signal: AbortSignal): Promise<number>;
  confirm(message: string): Promise<boolean>;
  showMainWindow(): Promise<void>;
  quitApp(): Promise<void>;
}): () => void {
  let confirming = false;
  return () => {
    if (confirming) return;
    void run();

    async function run(): Promise<void> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3_000);
      let count: number | null;
      try {
        count = await deps.countActive(controller.signal);
      } catch {
        count = null;
      } finally {
        clearTimeout(timer);
      }
      if (count === null || count <= 0) {
        await deps.quitApp();
        return;
      }
      confirming = true;
      try {
        await deps.showMainWindow();
        const ok = await deps.confirm(
          '有排队或正在运行的任务。退出后这些任务会变成“已中断”，之后可以追问继续。',
        );
        if (ok) await deps.quitApp();
      } finally {
        confirming = false;
      }
    }
  };
}
