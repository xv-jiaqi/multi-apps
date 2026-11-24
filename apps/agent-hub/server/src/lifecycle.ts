import { Injectable } from '@nestjs/common';

@Injectable()
export class Lifecycle {
  private shuttingDown = false;
  private readonly onShutdown: Array<() => void | Promise<void>> = [];

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  addShutdownHook(fn: () => void | Promise<void>): void {
    this.onShutdown.push(fn);
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    for (const fn of this.onShutdown) {
      try {
        await fn();
      } catch {
        // ignore individual hook failures
      }
    }
  }
}
