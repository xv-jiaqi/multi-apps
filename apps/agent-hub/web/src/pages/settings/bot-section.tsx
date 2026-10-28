import { useMutation } from '@tanstack/react-query';
import { Button } from '@repo/ui-web';
import { useState, type ReactElement } from 'react';
import { botPanel } from '../../desktop/bot-panel';
import { useBotPanelState } from '../../desktop/hooks';
import { errorMessage } from '../../api/client';
import { focusRing } from '../../lib/format';
import { HubAlertDialog } from '../../components/hub-dialog';
import type { SectionProps } from './settings-page';

export function BotSection(props: SectionProps): ReactElement {
  const panel = useBotPanelState();
  const [confirm, setConfirm] = useState(false);
  const clear = useMutation({
    meta: { silentError: true },
    mutationFn: () => botPanel.clearBrowsingData(),
  });
  const bot = props.draft.bot;
  function setBot(patch: Partial<typeof bot>): void {
    props.setDraft({ ...props.draft, bot: { ...bot, ...patch } });
  }
  return (
    <div className="space-y-3 text-sm">
      <label className="block text-neutral-700">
        地址
        <input
          type="url"
          autoComplete="url"
          className={fieldClass}
          value={bot.url ?? ''}
          onChange={(event) => setBot({ url: event.target.value || null })}
        />
      </label>
      <label className="block text-neutral-700">
        允许的 origin，每行一个
        <textarea
          autoComplete="off"
          className={`${fieldClass} min-h-20`}
          value={bot.allowedOrigins.join('\n')}
          onChange={(event) => setBot({ allowedOrigins: lines(event.target.value) })}
        />
      </label>
      <label className="block text-neutral-700">
        登录 origin，每行一个
        <textarea
          autoComplete="off"
          className={`${fieldClass} min-h-20`}
          value={bot.authOrigins.join('\n')}
          onChange={(event) => setBot({ authOrigins: lines(event.target.value) })}
        />
      </label>
      <label className="block text-neutral-700">
        User-Agent
        <input
          autoComplete="off"
          className={fieldClass}
          value={bot.userAgent ?? ''}
          onChange={(event) => setBot({ userAgent: event.target.value || null })}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className={`size-4 ${focusRing}`}
          checked={bot.openExternally}
          onChange={(event) => setBot({ openExternally: event.target.checked })}
        />
        用系统浏览器打开
      </label>
      <p className="text-neutral-600">面板状态：{panel.kind}</p>
      <Button type="button" variant="outline" onClick={() => setConfirm(true)}>
        清除本地郎登录数据
      </Button>
      {clear.isError ? (
        <p className="select-text text-red-700">{errorMessage(clear.error)}</p>
      ) : null}
      <HubAlertDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="清除本地郎登录数据"
        description="会清掉 Bot 页面的 Cookie 和缓存，然后重新加载。"
        confirmText="清除"
        destructive
        onConfirm={() => clear.mutateAsync()}
      />
    </div>
  );
}

const fieldClass = `mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 ${focusRing}`;

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
