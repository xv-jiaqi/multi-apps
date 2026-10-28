import { useRef, type ReactElement } from 'react';
import { Button } from '@repo/ui-web';
import { Link } from 'react-router';
import type { BotWidth, LayoutPrefs } from '../lib/layout';
import { nextBotWidth } from '../lib/layout';
import { paths } from '../app/paths';
import { botPanel } from '../desktop/bot-panel';
import { openExternal } from '../desktop/external';
import { useBotPanelState, useBotSlot } from '../desktop/hooks';
import { errorMessage } from '../api/client';
import { toast } from '../lib/toast';
import { useQuery } from '@tanstack/react-query';
import { settingsQuery } from '../api/queries';

export function BotColumn(props: {
  prefs: LayoutPrefs;
  onChange: (prefs: LayoutPrefs) => void;
}): ReactElement {
  if (props.prefs.botCollapsed) {
    return (
      <aside
        aria-label="本地郎"
        className="row-start-2 flex h-full flex-col items-center border-r border-neutral-200 bg-white py-2"
      >
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="展开本地郎"
          onClick={() => props.onChange({ ...props.prefs, botCollapsed: false })}
        >
          ⇤
        </Button>
      </aside>
    );
  }
  return <ExpandedColumn prefs={props.prefs} onChange={props.onChange} />;
}

function ExpandedColumn(props: {
  prefs: LayoutPrefs;
  onChange: (prefs: LayoutPrefs) => void;
}): ReactElement {
  const slotRef = useRef<HTMLDivElement>(null);
  useBotSlot(slotRef);
  const panel = useBotPanelState();
  const settings = useQuery(settingsQuery());
  const botUrl = settings.data?.config.bot.url ?? null;

  function cycle(current: BotWidth): void {
    props.onChange({ ...props.prefs, botWidth: nextBotWidth(current) });
  }

  async function openBrowser(): Promise<void> {
    if (!botUrl) return;
    try {
      await openExternal(botUrl);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <aside
      aria-label="本地郎"
      className="row-start-2 flex min-h-0 flex-col border-r border-neutral-200 bg-white"
    >
      <div className="flex h-8 items-center gap-1 border-b border-neutral-200 px-2">
        <span className="mr-auto truncate text-sm text-neutral-800">本地郎</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="刷新本地郎"
          onClick={() => void botPanel.reload()}
        >
          ⟳
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="用浏览器打开"
          disabled={!botUrl}
          onClick={() => void openBrowser()}
        >
          ↗
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="调整宽度"
          onClick={() => cycle(props.prefs.botWidth)}
        >
          ↔
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="收起本地郎"
          onClick={() => props.onChange({ ...props.prefs, botCollapsed: true })}
        >
          ⇤
        </Button>
      </div>
      <div ref={slotRef} className="relative min-h-0 flex-1">
        {panel.kind === 'open' ? null : (
          <BotPlaceholder
            kind={panel.kind}
            url={'url' in panel ? panel.url : botUrl}
            message={'message' in panel ? panel.message : null}
          />
        )}
      </div>
    </aside>
  );
}

function BotPlaceholder(props: {
  kind: 'unsupported' | 'unconfigured' | 'external' | 'opening' | 'error' | 'open';
  url: string | null;
  message: string | null;
}): ReactElement | null {
  if (props.kind === 'unsupported') {
    return <p className="p-4 text-sm text-neutral-700">浏览器开发模式不内嵌本地郎</p>;
  }
  if (props.kind === 'unconfigured') {
    return (
      <div className="space-y-2 p-4 text-sm text-neutral-800">
        <p>设置本地郎地址</p>
        <Link
          to={paths.settings('bot')}
          className="inline-flex h-8 items-center text-brand-700 underline"
        >
          去设置
        </Link>
      </div>
    );
  }
  if (props.kind === 'external') {
    return (
      <div className="space-y-2 p-4 text-sm text-neutral-800">
        <p className="select-text break-all">{props.url}</p>
        <button
          type="button"
          className="inline-flex h-8 items-center text-brand-700 underline"
          onClick={() => {
            if (!props.url) return;
            void openExternal(props.url).catch((error: unknown) =>
              toast.error(errorMessage(error)),
            );
          }}
        >
          用浏览器打开
        </button>
      </div>
    );
  }
  if (props.kind === 'opening')
    return <p className="p-4 text-sm text-neutral-700">正在打开本地郎…</p>;
  if (props.kind === 'error') {
    return <p className="select-text p-4 text-sm text-red-700">{props.message}</p>;
  }
  return null;
}
