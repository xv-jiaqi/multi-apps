import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Text, Textarea, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import {
  APP_ERROR_CODES,
  fieldErrorMessage,
  reportCreateInput,
  t,
  type ReportCreateInput,
} from '@repo/shared';
import { FocusableButton } from '@repo/ui-mini';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';
import { goLoginIfUnauthorized, goToLogin } from '../../lib/auth-redirect';
import { isWebEnv } from '../../lib/env';
import { readTrpcErrorCodes } from '../../lib/load-error';
import { nextNoticeId, type Notice } from '../../lib/notice';
import { usePendingSubmit } from '../../lib/use-pending-submit';
import { focusWhenSettled } from '../../lib/focus-when-settled';
import './index.scss';

const REASON_IDS = ['spam', 'illegal', 'harassment', 'misinfo', 'other'] as const;
export type ReportReasonId = (typeof REASON_IDS)[number];
export type ReportTargetType = ReportCreateInput['targetType'];

const OTHER_MIN = 4;
const REASON_MAX = 500;
const FORM_ROOT_ID = 'report-form-root';

export interface ReportEntryProps {
  targetType: ReportTargetType;
  targetId: string;
  /** Called after a successful submit so the host can show the green notice. */
  onSuccess?: () => void;
}

let activeCloser: (() => void) | null = null;

function nextReason(current: ReportReasonId, key: string): ReportReasonId | null {
  const index = REASON_IDS.indexOf(current);
  if (key === 'ArrowDown' || key === 'ArrowRight') {
    return REASON_IDS[(index + 1) % REASON_IDS.length]!;
  }
  if (key === 'ArrowUp' || key === 'ArrowLeft') {
    return REASON_IDS[(index - 1 + REASON_IDS.length) % REASON_IDS.length]!;
  }
  return null;
}

function bindInnerLabel(formId: string, detailLabelId: string): void {
  if (typeof document === 'undefined') return;
  const root = document.getElementById(formId);
  if (!root) return;
  const label = document.getElementById(detailLabelId);
  if (label && !label.id) label.id = detailLabelId;
  const nodes = root.querySelectorAll('textarea, taro-textarea-core, .report-entry__textarea');
  nodes.forEach((node) => {
    node.setAttribute('aria-labelledby', detailLabelId);
    const inner = node instanceof HTMLTextAreaElement ? node : node.querySelector('textarea');
    if (inner) inner.setAttribute('aria-labelledby', detailLabelId);
  });
}

/**
 * CH-301 v1.9 §4. Native: ActionSheet then an in-page form with the reason
 * read-only. H5: skip ActionSheet, open a form fixed to the bottom of the
 * current page, reasons in a radiogroup. No new page and no extra stack entry.
 */
export function ReportEntry({ targetType, targetId, onSuccess }: ReportEntryProps) {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [form, setForm] = useState<{ reasonId: ReportReasonId } | null>(null);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<Notice<{ text: string }> | null>(null);
  const submit = usePendingSubmit();
  const web = isWebEnv();
  const triggerSelector = `[data-report-trigger="${targetId}"]`;
  const formId = `report-form-${targetId}`;
  const detailLabelId = `report-detail-${targetId}`;
  const openedRef = useRef(false);
  const restoreFocusTo = useRef<(() => HTMLElement | null) | null>(null);

  const openForm = (reasonId: ReportReasonId) => {
    activeCloser?.();
    setForm({ reasonId });
    setDetail('');
    setError(null);
  };

  const open = () => {
    if (!session.isAuthenticated) {
      goToLogin();
      return;
    }
    if (web) {
      openForm('spam');
      return;
    }
    const itemList = REASON_IDS.map((id) => tt(`report.reason.${id}`));
    void Taro.showActionSheet({
      itemList,
      success: (res) => {
        const reasonId = REASON_IDS[res.tapIndex];
        if (!reasonId) return;
        openForm(reasonId);
      },
    });
  };

  const closeForm = () => {
    if (submit.pending) return;
    restoreFocusTo.current = () => document.querySelector<HTMLElement>(triggerSelector);
    setForm(null);
    setDetail('');
    setError(null);
    if (activeCloser) activeCloser = null;
  };

  useLayoutEffect(() => {
    if (!form) {
      openedRef.current = false;
      return;
    }
    const close = () => {
      if (submit.pending) return;
      setForm(null);
      setDetail('');
      setError(null);
    };
    activeCloser = close;
    return () => {
      if (activeCloser === close) activeCloser = null;
    };
  }, [form, submit.pending]);

  useLayoutEffect(() => {
    if (!form) {
      openedRef.current = false;
      const getEl = restoreFocusTo.current;
      if (!getEl) return;
      restoreFocusTo.current = null;
      return focusWhenSettled(getEl);
    }
    if (openedRef.current) return;
    openedRef.current = true;
    const stop = focusWhenSettled(() => {
      const root = document.getElementById(formId);
      if (!root) return null;
      if (web) {
        return root.querySelector<HTMLElement>(
          '.report-entry__reason-option[aria-checked="true"], [role="radio"][aria-checked="true"]',
        );
      }
      return root.querySelector<HTMLElement>('textarea, .report-entry__textarea, button');
    });
    return stop;
  }, [form, formId, web]);

  useLayoutEffect(() => {
    if (!form) return;
    bindInnerLabel(formId, detailLabelId);
    const timer = window.setTimeout(() => bindInnerLabel(formId, detailLabelId), 50);
    return () => window.clearTimeout(timer);
  }, [form, formId, detailLabelId, detail]);

  useLayoutEffect(() => {
    if (!form || typeof document === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || submit.pending) return;
      event.preventDefault();
      closeForm();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [form, submit.pending]);

  const send = async () => {
    if (!form || !submit.begin()) return;
    setError(null);
    const preset = tt(`report.reason.${form.reasonId}`);
    const extra = detail.trim();
    if (form.reasonId === 'other' && extra.length < OTHER_MIN) {
      setError({ id: nextNoticeId(), text: tt('report.detailRequired') });
      submit.end();
      return;
    }
    const reason = extra ? `${preset}\n${extra}` : preset;
    if (reason.length > REASON_MAX) {
      setError({ id: nextNoticeId(), text: fieldErrorMessage(locale.locale, 'reason_too_long') });
      submit.end();
      return;
    }
    const parsed = reportCreateInput.safeParse({ targetType, targetId, reason });
    if (!parsed.success) {
      setError({
        id: nextNoticeId(),
        text: fieldErrorMessage(locale.locale, parsed.error.issues[0]?.message),
      });
      submit.end();
      return;
    }
    try {
      await trpc.reports.create.mutate(parsed.data);
      restoreFocusTo.current = () => document.querySelector<HTMLElement>(triggerSelector);
      setForm(null);
      setDetail('');
      if (activeCloser) activeCloser = null;
      onSuccess?.();
    } catch (err) {
      if (goLoginIfUnauthorized(err)) {
        return;
      }
      const codes = readTrpcErrorCodes(err);
      const app = codes.appCode ?? codes.code;
      const text =
        app === 'CONTENT_BLOCKED' || app === APP_ERROR_CODES.CONTENT_BLOCKED
          ? tt('content.blocked')
          : app === APP_ERROR_CODES.TOO_MANY_REQUESTS
            ? tt('error.app.TOO_MANY_REQUESTS')
            : tt('report.submitFailed');
      setError({ id: nextNoticeId(), text });
    } finally {
      submit.end();
    }
  };

  const preset = form ? tt(`report.reason.${form.reasonId}`) : '';
  const used = detail ? preset.length + 1 + detail.length : preset.length;
  const extraMax = Math.max(0, REASON_MAX - preset.length - 1);

  const onReasonKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!form) return;
    const next = nextReason(form.reasonId, event.key);
    if (!next) return;
    event.preventDefault();
    setForm({ reasonId: next });
    window.setTimeout(() => {
      const root = document.getElementById(formId);
      root
        ?.querySelector<HTMLElement>(
          `.report-entry__reason-option[aria-checked="true"], [role="radio"][aria-checked="true"]`,
        )
        ?.focus();
    }, 0);
  };

  const formNode = form ? (
    <View
      id={formId}
      className={`report-entry__form${web ? ' report-entry__form--docked' : ''}`}
      data-toast-avoid="true"
    >
      <Text className="report-entry__title">{tt('report.title')}</Text>
      <Text className="report-entry__label">{tt('report.reasonLabel')}</Text>
      {web ? (
        <View
          className="report-entry__reasons"
          ariaRole="radiogroup"
          aria-label={tt('report.reasonLabel')}
        >
          {REASON_IDS.map((id) => (
            <FocusableButton
              key={id}
              className={`report-entry__reason-option${
                form.reasonId === id ? ' report-entry__reason-option--selected' : ''
              }`}
              role="radio"
              tabIndex={form.reasonId === id ? 0 : -1}
              aria-checked={form.reasonId === id}
              aria-label={tt(`report.reason.${id}`)}
              onClick={() => setForm({ reasonId: id })}
              onKeyDown={onReasonKeyDown}
            >
              {tt(`report.reason.${id}`)}
            </FocusableButton>
          ))}
        </View>
      ) : (
        <View className="report-entry__reason">
          <Text className="report-entry__reason-text">{tt(`report.reason.${form.reasonId}`)}</Text>
        </View>
      )}
      <Text id={detailLabelId} className="report-entry__label">
        {tt('report.detailLabel')}
      </Text>
      <Textarea
        className={`report-entry__textarea${error ? ' report-entry__textarea--error' : ''}`}
        value={detail}
        maxlength={extraMax}
        disabled={submit.pending ? true : undefined}
        placeholder={tt('report.reasonPlaceholder')}
        onInput={(event) => setDetail(event.detail.value)}
        {...({
          'aria-labelledby': detailLabelId,
          'data-toast-avoid': 'true',
          nativeProps: { 'aria-labelledby': detailLabelId },
        } as Record<string, unknown>)}
      />
      <Text className="report-entry__count">
        {used} / {REASON_MAX}
      </Text>
      {error ? (
        <View key={error.id} className="report-entry__error" ariaRole="alert">
          <Text className="report-entry__error-text">{error.text}</Text>
        </View>
      ) : null}
      <View className="report-entry__footer" data-toast-avoid>
        <FocusableButton
          className={`primary-button${submit.pending ? ' primary-button--disabled' : ''}`}
          aria-label={submit.pending ? tt('report.submitting') : tt('report.submit')}
          aria-disabled={submit.pending}
          onClick={() => void send()}
        >
          {submit.pending ? tt('report.submitting') : tt('report.submit')}
        </FocusableButton>
        <FocusableButton
          className={`report-entry__cancel${submit.pending ? ' report-entry__cancel--disabled' : ''}`}
          aria-label={tt('report.cancel')}
          aria-disabled={submit.pending}
          onClick={closeForm}
        >
          {tt('report.cancel')}
        </FocusableButton>
      </View>
    </View>
  ) : null;

  const docked =
    web && formNode && typeof document !== 'undefined'
      ? createPortal(formNode, document.getElementById(FORM_ROOT_ID) ?? document.body)
      : formNode;

  return (
    <View className="report-entry">
      <FocusableButton
        className="report-entry__trigger"
        aria-label={tt('report.button')}
        data-report-trigger={targetId}
        data-toast-avoid="true"
        onClick={open}
      >
        {tt('report.button')}
      </FocusableButton>
      {docked}
    </View>
  );
}

export { FORM_ROOT_ID };
