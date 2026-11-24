import { useLayoutEffect, useState } from 'react';
import { Text, Textarea, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import {
  APP_ERROR_CODES,
  fieldErrorMessage,
  reportCreateInput,
  t,
  type ReportCreateInput,
} from '@repo/shared';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';
import { goToLogin } from '../../lib/auth-redirect';
import { isWebEnv } from '../../lib/env';
import { readTrpcErrorCodes } from '../../lib/load-error';
import { nextNoticeId, type Notice } from '../../lib/notice';
import { usePendingSubmit } from '../../lib/use-pending-submit';
import { FocusableButton, focusSelector } from '../focusable-button';
import './index.scss';

const REASON_IDS = ['spam', 'illegal', 'harassment', 'misinfo', 'other'] as const;
export type ReportReasonId = (typeof REASON_IDS)[number];
export type ReportTargetType = ReportCreateInput['targetType'];

const OTHER_MIN = 4;
const REASON_MAX = 500;

export interface ReportEntryProps {
  targetType: ReportTargetType;
  targetId: string;
  /** Called after a successful submit so the host can show the green notice. */
  onSuccess?: () => void;
}

/**
 * CH-301 v1.8 §4 report entry. Native: ActionSheet then an in-page form with
 * the reason read-only. H5: skip ActionSheet, open the in-page form with a
 * radiogroup. No new page and no extra stack entry.
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

  const openForm = (reasonId: ReportReasonId) => {
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
    setForm(null);
    setDetail('');
    setError(null);
    focusSelector(triggerSelector);
  };

  useLayoutEffect(() => {
    if (!form || typeof document === 'undefined') return;
    const root = document.getElementById(formId);
    const target = root?.querySelector<HTMLElement>(
      web ? '.report-entry__reason-option' : 'textarea, .report-entry__textarea, button',
    );
    target?.focus();
    if (typeof root?.scrollIntoView === 'function') root.scrollIntoView({ block: 'nearest' });
  }, [form, formId, web]);

  useLayoutEffect(() => {
    if (!form || typeof document === 'undefined') return;
    const label = document.getElementById(detailLabelId);
    const root = document.getElementById(formId);
    const area = root?.querySelector('textarea, taro-textarea-core, .report-entry__textarea');
    if (label && area) {
      if (!label.id) label.id = detailLabelId;
      area.setAttribute('aria-labelledby', detailLabelId);
    }
  }, [form, formId, detailLabelId]);

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
      setForm(null);
      setDetail('');
      onSuccess?.();
      focusSelector(triggerSelector);
    } catch (err) {
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

  return (
    <View className="report-entry">
      <FocusableButton
        className="report-entry__trigger"
        ariaLabel={tt('report.button')}
        data-report-trigger={targetId}
        onClick={open}
      >
        {tt('report.button')}
      </FocusableButton>
      {form ? (
        <View id={formId} className="report-entry__form">
          <Text className="report-entry__title">{tt('report.title')}</Text>
          <Text className="report-entry__label">{tt('report.reasonLabel')}</Text>
          {web ? (
            <View
              className="report-entry__reasons"
              ariaRole="radiogroup"
              ariaLabel={tt('report.reasonLabel')}
            >
              {REASON_IDS.map((id) => (
                <FocusableButton
                  key={id}
                  className={`report-entry__reason-option${
                    form.reasonId === id ? ' report-entry__reason-option--selected' : ''
                  }`}
                  role="radio"
                  ariaChecked={form.reasonId === id}
                  ariaLabel={tt(`report.reason.${id}`)}
                  onClick={() => setForm({ reasonId: id })}
                >
                  {tt(`report.reason.${id}`)}
                </FocusableButton>
              ))}
            </View>
          ) : (
            <View className="report-entry__reason">
              <Text className="report-entry__reason-text">
                {tt(`report.reason.${form.reasonId}`)}
              </Text>
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
            ariaLabel={tt('report.detailLabel')}
            {...({ 'aria-labelledby': detailLabelId } as Record<string, string>)}
            onInput={(event) => setDetail(event.detail.value)}
          />
          <Text className="report-entry__count">
            {used} / {REASON_MAX}
          </Text>
          {error ? (
            <View key={error.id} className="report-entry__error" ariaRole="alert">
              <Text className="report-entry__error-text">{error.text}</Text>
            </View>
          ) : null}
          <View className="report-entry__footer">
            <FocusableButton
              className={`primary-button${submit.pending ? ' primary-button--disabled' : ''}`}
              ariaLabel={submit.pending ? tt('report.submitting') : tt('report.submit')}
              ariaDisabled={submit.pending}
              onClick={() => void send()}
            >
              {submit.pending ? tt('report.submitting') : tt('report.submit')}
            </FocusableButton>
            <FocusableButton
              className={`report-entry__cancel${submit.pending ? ' report-entry__cancel--disabled' : ''}`}
              ariaLabel={tt('report.cancel')}
              ariaDisabled={submit.pending}
              onClick={closeForm}
            >
              {tt('report.cancel')}
            </FocusableButton>
          </View>
        </View>
      ) : null}
    </View>
  );
}
