import { stopReasonLabel, type TaskDetailDto } from '@agent-hub/contract';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Markdown } from '../../components/markdown';
import { useTaskTimeline } from '../../app/hooks';
import { focusRing, formatDuration, modelLine } from '../../lib/format';
import {
  formatDiffStats,
  formatUsage,
  groupByTurn,
  timelineRows,
  turnDuration,
  type TimelineItem,
} from '../../lib/timeline';
import { ApprovalCard } from './approval-card';

const STICK_PX = 48;
const expanded = new Map<string, boolean>();

export function OutputTab(props: { task: TaskDetailDto }): ReactElement {
  const snapshot = useTaskTimeline(props.task.id);
  const rows = timelineRows(groupByTurn(props.task.turns, snapshot));
  const parentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [, redraw] = useState(0);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 6,
  });

  useEffect(() => {
    if (!stick.current) {
      setShowJump(true);
      return;
    }
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    setShowJump(false);
  }, [rows.length, snapshot.lastSeq, virtualizer]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={parentRef}
        className="h-full overflow-y-auto"
        onScroll={() => {
          const element = parentRef.current;
          if (!element) return;
          const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
          stick.current = distance <= STICK_PX;
          setShowJump(!stick.current);
        }}
      >
        {rows.length === 0 ? <p className="p-4 text-sm text-neutral-600">还没有输出</p> : null}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={row.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div className="px-4 py-2">
                  {row.type === 'item' ? (
                    <ItemRow
                      item={row.item}
                      taskId={props.task.id}
                      onToggle={() => redraw((value) => value + 1)}
                    />
                  ) : row.type === 'turn-head' ? (
                    <div>
                      <p className="text-sm font-medium text-neutral-900">
                        第 {row.section.turn.index} 轮
                      </p>
                      <p className="select-text mt-1 text-sm text-neutral-800">
                        {row.section.turn.prompt}
                      </p>
                      <p className="mt-1 text-sm text-neutral-600">
                        {modelLine(row.section.turn.model, row.section.turn.reasoningEffort)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-neutral-600">
                      {row.section.turn.stopReason
                        ? stopReasonLabel(row.section.turn.stopReason)
                        : ''}
                      {turnDuration(row.section.turn) !== null
                        ? ` · ${formatDuration(turnDuration(row.section.turn) ?? 0)}`
                        : ''}
                      {formatUsage(row.section.usage) ? ` · ${formatUsage(row.section.usage)}` : ''}
                      {formatDiffStats(row.section.turn.turnStats)
                        ? ` · ${formatDiffStats(row.section.turn.turnStats)}`
                        : ''}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {showJump ? (
        <button
          type="button"
          className={`absolute bottom-3 right-3 h-8 rounded-md bg-neutral-900 px-3 text-sm text-white ${focusRing}`}
          onClick={() => {
            stick.current = true;
            virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
            setShowJump(false);
          }}
        >
          回到底部
        </button>
      ) : null}
    </div>
  );
}

function ItemRow(props: {
  item: TimelineItem;
  taskId: string;
  onToggle: () => void;
}): ReactElement | null {
  const item = props.item;
  if (item.kind === 'message') return <Markdown text={item.text} />;
  if (item.kind === 'reasoning' || item.kind === 'tool') {
    const open = expanded.get(item.key) === true;
    const title = item.kind === 'tool' ? item.title || '工具' : '推理';
    return (
      <div>
        <button
          type="button"
          className={`inline-flex h-8 items-center text-sm text-neutral-800 ${focusRing}`}
          aria-expanded={open}
          onClick={() => {
            expanded.set(item.key, !open);
            props.onToggle();
          }}
        >
          {open ? '▾' : '▸'} {title}
          {item.kind === 'tool' && item.command ? (
            <span className="select-text ml-2 font-mono">{item.command}</span>
          ) : null}
        </button>
        {open ? (
          <div className="select-text mt-1 whitespace-pre-wrap font-mono text-sm text-neutral-800">
            {item.kind === 'reasoning' ? <Markdown text={item.text} /> : item.output}
          </div>
        ) : null}
      </div>
    );
  }
  if (item.kind === 'plan') {
    return (
      <ol className="list-decimal pl-5 text-sm text-neutral-800">
        {item.entries.map((entry) => (
          <li key={entry.step}>
            {entry.step} · {entry.status}
          </li>
        ))}
      </ol>
    );
  }
  if (item.kind === 'approval')
    return <ApprovalCard approval={item.approval} taskId={props.taskId} />;
  if (item.kind === 'notice') {
    return (
      <p className={`text-sm ${item.level === 'error' ? 'text-red-700' : 'text-neutral-700'}`}>
        {item.message}
        {item.count > 1 ? ` ×${item.count}` : ''}
      </p>
    );
  }
  if (item.kind === 'remote') {
    return (
      <p className="text-sm text-neutral-700">
        远端提交 {item.branch} {item.headCommit.slice(0, 8)} · 本轮 {item.newCommits} 个新提交
      </p>
    );
  }
  if (item.kind === 'session') {
    return (
      <p className="text-sm text-neutral-600">
        会话 {item.nativeSessionId}
        {item.model ? ` · ${item.model}` : ''}
        {item.resumed ? ' · 已恢复' : ''}
      </p>
    );
  }
  return null;
}
