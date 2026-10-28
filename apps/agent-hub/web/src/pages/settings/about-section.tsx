import type { SettingsResponse } from '@agent-hub/contract';
import { Button } from '@repo/ui-web';
import { useState, type ReactElement } from 'react';
import { sidecar } from '../../desktop/sidecar';
import { useSidecarState } from '../../desktop/hooks';
import { HubAlertDialog } from '../../components/hub-dialog';

export function AboutSection(props: { saved: SettingsResponse }): ReactElement {
  const state = useSidecarState();
  const version =
    state.kind === 'ready' && state.info.serverVersion ? state.info.serverVersion : '未知';
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-3 text-sm">
      <p>版本 {version}</p>
      <p className="select-text">数据目录 {props.saved.dataDir}</p>
      <p className="select-text">桥接 token 文件 {props.saved.bridgeTokenFile}</p>
      <Button type="button" variant="outline" onClick={() => setConfirm(true)}>
        重启本地服务
      </Button>
      <HubAlertDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="重启本地服务"
        description="正在运行的任务会变成“已中断”。"
        confirmText="重启"
        onConfirm={() => sidecar.restartNow()}
      />
    </div>
  );
}
