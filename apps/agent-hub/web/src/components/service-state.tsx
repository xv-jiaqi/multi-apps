import { useState, type ReactElement } from 'react';
import { Button } from '@repo/ui-web';
import { useSyncExternalStore } from 'react';
import { socket } from '../api/socket';
import { useSidecarState } from '../desktop/hooks';
import { HubDialog } from './hub-dialog';

export function ServiceState(): ReactElement | null {
  const sidecar = useSidecarState();
  const socketStatus = useSyncExternalStore(
    socket.subscribeStatus,
    socket.getStatus,
    socket.getStatus,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (sidecar.kind === 'starting') {
    return <p className="truncate text-sm text-neutral-700">正在重启本地服务…</p>;
  }
  if (sidecar.kind === 'restarting') {
    const seconds = Math.max(1, Math.round(sidecar.delayMs / 1000));
    const stderr = sidecar.exit.lastStderr;
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm text-neutral-800">
        <p className="truncate">本地服务已断开，{seconds} 秒后自动重启</p>
        {stderr ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setDetailsOpen(true)}>
            详情
          </Button>
        ) : null}
        <HubDialog
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          title="本地服务的最后输出"
          description="侧车 stderr 的尾部"
        >
          <pre className="select-text max-h-80 overflow-auto whitespace-pre-wrap font-mono text-sm text-neutral-800">
            {stderr}
          </pre>
        </HubDialog>
      </div>
    );
  }
  if (sidecar.kind !== 'ready') return null;
  if (socketStatus === 'reconnecting') {
    return <p className="truncate text-sm text-neutral-700">实时更新已断开，正在重连…</p>;
  }
  if (socketStatus === 'stopped') {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-800">
        <p>实时更新已停止</p>
        <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
          重新加载界面
        </Button>
      </div>
    );
  }
  return null;
}
