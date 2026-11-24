import { useState } from 'react';
import { Text, Textarea, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import {
  APP_ERROR_CODES,
  fieldErrorMessage,
  reportCreateInput,
  t,
  type ReportCreateInput,
} from '@repo/shared';
import { PrimaryButton } from '@repo/ui-mini';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';
import { goToLogin } from '../../lib/auth-redirect';
import { mutationErrorMessage, readTrpcErrorCodes } from '../../lib/load-error';
import { nextNoticeId, type Notice } from '../../lib/notice';
import { usePendingSubmit } from '../../lib/use-pending-submit';
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
 * CH-301 §4 report entry: ActionSheet of five reasons, then an in-page form.
 * Reusable for comments now, and for topics / replies / listings after those
 * pages land. Does not open a new page or push the page stack.
 */
export function ReportEntry({ targetType, targetId, onSuccess }: ReportEntryProps) {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [form, setForm] = useState<{ reasonId: ReportReasonId } | null>(null);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<Notice<{ text: string }> | null>(null);
  const submit = usePendingSubmit();

  const openSheet = () => {
    if (!session.isAuthenticated) {
      goToLogin();
      return;
    }
    const itemList = REASON_IDS.map((id) => tt(`report.reason.${id}`));
    void Taro.showActionSheet({
      itemList,
      success: (res) => {
        const reasonId = REASON_IDS[res.tapIndex];
        if (!reasonId) return;
        setForm({ reasonId });
        setDetail('');
        setError(null);
      },
    });
  };

  const closeForm = () => {
    if (submit.pending) return;
    setForm(null);
    setDetail('');
    setError(null);
  };

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
    } catch (err) {
      const codes = readTrpcErrorCodes(err);
      const app = codes.appCode ?? codes.code;
      const text =
        app === 'CONTENT_BLOCKED' || app === APP_ERROR_CODES.CONTENT_BLOCKED
          ? tt('content.blocked')
          : mutationErrorMessage({
              locale: locale.locale,
              error: err,
              copy: {
                [APP_ERROR_CODES.TOO_MANY_REQUESTS]: tt('error.app.TOO_MANY_REQUESTS'),
              },
            }) || tt('report.submitFailed');
      setError({ id: nextNoticeId(), text });
    } finally {
      submit.end();
    }
  };

  return (
    <View className="report-entry">
      <Text className="report-entry__trigger" onClick={openSheet}>
        {tt('report.button')}
      </Text>
      {form ? (
        <View className="report-entry__form">
          <Text className="report-entry__title">{tt('report.title')}</Text>
          <Text className="report-entry__label">{tt('report.reasonLabel')}</Text>
          <View className="report-entry__reason">
            <Text className="report-entry__reason-text">
              {tt(`report.reason.${form.reasonId}`)}
            </Text>
          </View>
          <Text className="report-entry__label">{tt('report.detailLabel')}</Text>
          <Textarea
            className={`report-entry__textarea${error ? ' report-entry__textarea--error' : ''}`}
            value={detail}
            maxlength={REASON_MAX}
            disabled={submit.pending ? true : undefined}
            placeholder={tt('report.reasonPlaceholder')}
            onInput={(event) => setDetail(event.detail.value)}
          />
          <Text className="report-entry__count">
            {detail.length} / {REASON_MAX}
          </Text>
          {error ? (
            <View key={error.id} className="report-entry__error" ariaRole="alert">
              <Text className="report-entry__error-text">{error.text}</Text>
            </View>
          ) : null}
          <View className="report-entry__footer">
            <PrimaryButton
              label={submit.pending ? tt('report.submitting') : tt('report.submit')}
              disabled={submit.pending}
              onClick={() => void send()}
            />
            <Text
              className={`report-entry__cancel${submit.pending ? ' report-entry__cancel--disabled' : ''}`}
              onClick={submit.pending ? undefined : closeForm}
            >
              {tt('report.cancel')}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
