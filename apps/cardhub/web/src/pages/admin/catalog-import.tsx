import { observer } from 'mobx-react-lite';
import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { catalogImportLimit, t } from '@repo/shared';
import { Button, SegmentedControl } from '@repo/ui-web';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { PageMeta } from '../../components/page-meta';
import { PageShell } from '../../components/page-shell';
import { AdminGate, useReportForbidden } from '../../components/admin/admin-gate';
import {
  AdminStatus,
  AdminTable,
  AdminTableHead,
  AdminTh,
  InlineConfirm,
} from '../../components/admin/admin-table';
import {
  IMPORT_EXAMPLE,
  adminErrorText,
  displayImportNames,
  focusRing,
  isAccessRevoked,
  jsonErrorLine,
  readTrpcFailure,
  summarizeImport,
  type ImportRowResult,
  type ImportStatus,
} from '../../components/admin/catalog-utils';
import { useAdminNotice } from '../../components/admin/use-admin-notice';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';

const RESULT_CLASS: Record<ImportStatus, string> = {
  created: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200',
  updated: 'bg-brand-50 text-brand-700',
  unchanged: 'bg-neutral-100 text-neutral-600',
  error: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
};

const RESULT_KEY: Record<ImportStatus, string> = {
  created: 'admin.import.create',
  updated: 'admin.import.update',
  unchanged: 'admin.import.unchanged',
  error: 'admin.import.error',
};

export const CatalogImportPage = observer(function CatalogImportPage() {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  return (
    <PageShell>
      <PageMeta title={tt('admin.import.title')} />
      <div className="space-y-6">
        <AdminGate>
          <CatalogImportBody />
        </AdminGate>
      </div>
    </PageShell>
  );
});

const CatalogImportBody = observer(function CatalogImportBody() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const reportForbidden = useReportForbidden();
  const { notice, setNotice, statusRef } = useAdminNotice();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionRows, setActionRows] = useState<ImportRowResult[] | null>(null);
  const [preview, setPreview] = useState<{
    text: string;
    data: unknown;
    rows: ImportRowResult[];
  } | null>(null);
  const [filter, setFilter] = useState<'all' | 'errors'>('errors');
  const [confirming, setConfirming] = useState(false);
  const [importedText, setImportedText] = useState<string | null>(null);
  const [phase, setPhase] = useState<'preview' | 'execute' | null>(null);
  const importCatalog = trpc.admin.catalog.import.useMutation();
  const pending = importCatalog.isPending;
  const stale = preview !== null && preview.text !== text;
  const summary = preview ? summarizeImport(preview.rows) : null;
  const visibleRows =
    preview?.rows.filter((row) => filter === 'all' || row.status === 'error') ?? [];
  const blocked = Boolean(summary && summary.errors > 0);
  const nothing = Boolean(
    summary && summary.errors === 0 && summary.create === 0 && summary.update === 0,
  );
  const sameAsImported = importedText !== null && text === importedText;
  const canImport = Boolean(preview) && !stale && !blocked && !nothing && !sameAsImported;

  const onText = (value: string) => {
    setText(value);
    setParseError(null);
    setConfirming(false);
    setNotice(null);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFileName(file.name);
    const contents = await file.text();
    onText(contents);
  };

  const previewImport = async () => {
    setParseError(null);
    setActionError(null);
    setActionRows(null);
    setNotice(null);
    setConfirming(false);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setParseError(tt('admin.import.parseError', { line: jsonErrorLine(text, message), message }));
      return;
    }
    const previewInput = { data, dryRun: true as const };
    const previewLimit = catalogImportLimit(previewInput);
    if (previewLimit) {
      setParseError(
        previewLimit.reason === 'tooManyRows'
          ? tt('admin.import.tooManyRows', { count: previewLimit.count })
          : tt('admin.import.tooLarge'),
      );
      return;
    }
    setPhase('preview');
    try {
      const rows = await importCatalog.mutateAsync(previewInput);
      const nextRows = rows as ImportRowResult[];
      setPreview({ text, data, rows: nextRows });
      setFilter(nextRows.some((row) => row.status === 'error') ? 'errors' : 'all');
    } catch (error) {
      if (isAccessRevoked(error)) {
        reportForbidden();
        return;
      }
      const failure = readTrpcFailure(error);
      setParseError(
        failure.admin?.code
          ? adminErrorText(locale.locale, failure.admin.code, failure.message)
          : tt('state.error'),
      );
    } finally {
      setPhase(null);
    }
  };

  const executeImport = async () => {
    if (!preview || !canImport) return;
    const executeInput = { data: preview.data, dryRun: false as const };
    const executeLimit = catalogImportLimit(executeInput);
    if (executeLimit) {
      setActionError(
        executeLimit.reason === 'tooManyRows'
          ? tt('admin.import.tooManyRows', { count: executeLimit.count })
          : tt('admin.import.tooLarge'),
      );
      setActionRows(null);
      setConfirming(false);
      return;
    }
    setActionError(null);
    setActionRows(null);
    setPhase('execute');
    try {
      const rows = (await importCatalog.mutateAsync(executeInput)) as ImportRowResult[];
      const counts = summarizeImport(rows);
      setPreview({ ...preview, rows });
      setConfirming(false);
      setImportedText(preview.text);
      setNotice(tt('admin.import.done', { create: counts.create, update: counts.update }));
    } catch (error) {
      if (isAccessRevoked(error)) {
        reportForbidden();
        return;
      }
      const failure = readTrpcFailure(error);
      setActionError(tt('admin.import.failed'));
      setActionRows(failure.admin?.rows ?? null);
      setConfirming(false);
    } finally {
      setPhase(null);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: tt('breadcrumb.home'), to: '/' },
          { label: tt('nav.admin') },
          { label: tt('nav.catalog'), to: '/admin/catalog' },
          { label: tt('admin.import.title') },
        ]}
      />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            {tt('admin.import.title')}
          </h1>
          <p className="text-sm text-neutral-600">{tt('admin.import.subtitle')}</p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <AdminStatus message={notice} statusRef={statusRef} />
        {sameAsImported ? (
          <Link
            to="/admin/catalog"
            className={`text-sm font-medium text-brand-600 hover:underline ${focusRing}`}
          >
            {tt('admin.import.back')}
          </Link>
        ) : null}
      </div>
      <details className="rounded-md border border-neutral-200 bg-white p-3">
        <summary className={`cursor-pointer text-sm font-medium text-neutral-800 ${focusRing}`}>
          {tt('admin.import.example')}
        </summary>
        <pre className="mt-3 max-w-full overflow-x-auto whitespace-pre rounded-md bg-neutral-50 p-3 font-mono text-xs">
          {IMPORT_EXAMPLE}
        </pre>
      </details>
      <div className="space-y-2">
        <label htmlFor="import-json" className="text-sm font-medium text-neutral-800">
          {tt('admin.import.paste')}
        </label>
        <textarea
          id="import-json"
          rows={14}
          spellCheck={false}
          value={text}
          readOnly={phase === 'execute' && pending}
          onChange={(event) => onText(event.target.value)}
          className="flex w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-xs text-neutral-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        />
        {parseError ? (
          <p role="alert" className="text-xs text-red-700">
            {parseError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label={tt('admin.import.file')}
            onChange={(event) => void onFile(event)}
          />
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
            {tt('admin.import.file')}
          </Button>
          {fileName ? <span className="text-sm text-neutral-600">{fileName}</span> : null}
          <Button
            type="button"
            onClick={() => void previewImport()}
            disabled={phase === 'preview' && pending}
            aria-busy={(phase === 'preview' && pending) || undefined}
          >
            {phase === 'preview' && pending
              ? tt('admin.import.previewing')
              : tt('admin.import.preview')}
          </Button>
        </div>
      </div>
      {actionError ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          <p>{actionError}</p>
          {actionRows?.flatMap((row) =>
            row.errors.map((error) => (
              <p key={`${row.row.row}-${error.path}-${error.code}`} className="mt-1 text-xs">
                <span className="font-mono wrap-anywhere">{error.path}</span>
                {locale.locale === 'zh-CN' ? '：' : ': '}
                {adminErrorText(locale.locale, error.code, error.message ?? '')}
              </p>
            )),
          )}
        </div>
      ) : null}
      {preview && summary ? (
        <div className={stale ? 'space-y-3 opacity-60' : 'space-y-3'}>
          {stale ? <p className="text-sm text-neutral-700">{tt('admin.import.stale')}</p> : null}
          <p role="status">
            {tt('admin.import.summary', {
              newSeries: tt('admin.import.summary.series', { count: summary.newSeries }),
              newCards: tt('admin.import.summary.cards', { count: summary.newCards }),
              updSeries: tt('admin.import.summary.updatedSeries', { count: summary.updSeries }),
              updCards: tt('admin.import.summary.updatedCards', { count: summary.updCards }),
              errors: tt('admin.import.summary.errors', { count: summary.errors }),
            })}
          </p>
          {summary.errors > 0 ? (
            <SegmentedControl
              legend={`${tt('admin.import.all')} / ${tt('admin.import.errorsOnly')}`}
              legendSrOnly
              name="import-filter"
              value={filter}
              onValueChange={(value) => setFilter(value === 'all' ? 'all' : 'errors')}
              options={[
                { value: 'all', label: tt('admin.import.all') },
                { value: 'errors', label: tt('admin.import.errorsOnly') },
              ]}
            />
          ) : null}
          <AdminTable caption={tt('admin.import.caption')}>
            <AdminTableHead>
              <AdminTh>{tt('admin.import.colKind')}</AdminTh>
              <AdminTh>{tt('admin.col.slug')}</AdminTh>
              <AdminTh>{tt('admin.col.name')}</AdminTh>
              <AdminTh>{tt('admin.import.colResult')}</AdminTh>
              <AdminTh>{tt('admin.import.colProblem')}</AdminTh>
            </AdminTableHead>
            <tbody className="divide-y divide-neutral-200">
              {visibleRows.map((row) => {
                const names = displayImportNames(preview.data, row.row, row.errors);
                return (
                  <tr
                    key={row.row.row}
                    className={row.status === 'error' ? 'bg-red-50/50' : undefined}
                  >
                    <td
                      className={`px-3 py-2 align-middle ${row.row.type === 'card' ? 'pl-6' : ''}`}
                    >
                      {row.row.type === 'series'
                        ? tt('admin.import.kindSeries')
                        : tt('admin.import.kindCard')}
                    </td>
                    <td className="px-3 py-2 align-middle font-mono text-xs text-neutral-600">
                      {names.slug}
                    </td>
                    <td className="px-3 py-2 align-middle font-medium text-neutral-900">
                      {names.name}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${RESULT_CLASS[row.status]}`}
                      >
                        {tt(RESULT_KEY[row.status])}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-middle text-xs text-red-700">
                      {row.errors.map((error) => (
                        <p key={`${error.path}-${error.code}`}>
                          <span className="font-mono wrap-anywhere">{error.path}</span>
                          {locale.locale === 'zh-CN' ? '：' : ': '}
                          {adminErrorText(locale.locale, error.code, error.message ?? '')}
                        </p>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </AdminTable>
          <div className="space-y-2">
            {blocked && !stale ? (
              <p className="text-sm text-neutral-700">
                {tt('admin.import.blocked', { count: summary.errors })}
              </p>
            ) : null}
            {nothing && !stale ? (
              <p className="text-sm text-neutral-700">{tt('admin.import.nothing')}</p>
            ) : null}
            {sameAsImported && !stale ? (
              <p className="text-sm text-neutral-700">{tt('admin.import.already')}</p>
            ) : null}
            <Button
              type="button"
              disabled={!canImport || pending}
              aria-busy={(phase === 'execute' && pending) || undefined}
              onClick={() => {
                setNotice(null);
                setConfirming(true);
              }}
            >
              {phase === 'execute' && pending
                ? tt('admin.import.executing')
                : tt('admin.import.execute')}
            </Button>
            {confirming && canImport ? (
              <InlineConfirm
                label={tt('admin.import.confirm', {
                  create: summary.create,
                  update: summary.update,
                })}
                confirmLabel={
                  phase === 'execute' && pending
                    ? tt('admin.import.executing')
                    : tt('admin.import.confirmAction')
                }
                cancelLabel={tt('admin.cancel')}
                disabled={phase === 'execute' && pending}
                onConfirm={() => void executeImport()}
                onCancel={() => setConfirming(false)}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
