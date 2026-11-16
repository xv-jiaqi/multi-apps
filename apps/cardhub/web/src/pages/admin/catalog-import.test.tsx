import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { CARD_NUMBER_MAX, CATALOG_IMPORT_MAX_ROWS } from '@repo/shared';
import { rootStore } from '../../stores/root-store';
import type { ImportRowResult } from '../../components/admin/catalog-utils';

function parseErrorText(): HTMLElement {
  const node = document.getElementById('import-json-error');
  if (!node) throw new Error('missing #import-json-error');
  // §16/§17-3：解析错误不是 alert，只靠 aria-describedby 随焦点读。
  expect(node).not.toHaveAttribute('role');
  return node;
}

const calls: Array<{ data: unknown; dryRun: boolean }> = [];
const importImpl: {
  current: (input: { data: unknown; dryRun: boolean }) => Promise<unknown>;
} = {
  current: async () => [],
};

vi.mock('../../lib/trpc', () => ({
  trpc: {
    admin: {
      catalog: {
        import: {
          useMutation: () => ({
            isPending: false,
            mutateAsync: (input: { data: unknown; dryRun: boolean }) => {
              calls.push(input);
              return importImpl.current(input);
            },
          }),
        },
      },
    },
    search: {
      global: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
      },
    },
    useUtils: () => ({}),
  },
}));

import { CatalogImportPage } from './catalog-import';
import { AC62_IMPORT, AC62_ROWS } from './catalog-import-fixture';

function row(
  partial: Partial<ImportRowResult> &
    Pick<ImportRowResult, 'status'> & { type?: 'series' | 'card' },
  index: number,
): ImportRowResult {
  return {
    row: {
      row: index,
      type: partial.type ?? 'series',
      slug: partial.row?.slug ?? 'celestial-dawn',
      name: partial.row?.name ?? '天穹黎明',
      seriesSlug: partial.row?.seriesSlug,
    },
    status: partial.status,
    errors: partial.errors ?? [],
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CatalogImportPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
  calls.length = 0;
  importImpl.current = async () => [];
});

describe('catalog import', () => {
  it('shows a parse error with the line number and does not call the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON 内容' }));
    await user.paste('[\n  {\n    "slug":\n  }\n]');
    await user.click(screen.getByRole('button', { name: '预览' }));
    const alert = parseErrorText();
    expect(alert).toHaveTextContent('第 4 行附近的 JSON 格式有误');
    expect(alert).not.toHaveTextContent('Expected');
    expect(alert).not.toHaveTextContent('Unexpected');
    expect(alert).not.toHaveTextContent('position');
    expect(alert).not.toHaveTextContent('SyntaxError');
    expect(alert).not.toHaveTextContent('is not valid JSON');
    expect(calls).toHaveLength(0);
  });

  it('shows the English parse sentence and never the parser text', async () => {
    rootStore.locale.setLocale('en-US');
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON' }));
    await user.paste('[\n  {\n    "slug":\n  }\n]');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const alert = parseErrorText();
    expect(alert).toHaveTextContent('The JSON near line 4 is not valid.');
    expect(alert).not.toHaveTextContent('Expected');
    expect(alert).not.toHaveTextContent('Unexpected');
    expect(alert).not.toHaveTextContent('position');
    expect(alert).not.toHaveTextContent('SyntaxError');
    expect(calls).toHaveLength(0);
  });

  it('shows mapped Chinese copy when the import procedure returns a zod error', async () => {
    const user = userEvent.setup();
    const raw = '[{"code":"invalid_type","message":"Required"}] VALIDATION';
    importImpl.current = async () => {
      throw { message: raw, data: { code: 'BAD_REQUEST', appCode: 'VALIDATION' } };
    };
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON 内容' }));
    await user.paste('[]');
    await user.click(screen.getByRole('button', { name: '预览' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('填写的内容不符合要求，请修改后再试');
    expect(alert).not.toHaveTextContent('invalid_type');
    expect(alert).not.toHaveTextContent('Required');
    expect(alert).not.toHaveTextContent('VALIDATION');
  });

  it('maps statuses to chips, blocks import while errors remain, and invalidates a stale preview', async () => {
    const user = userEvent.setup();
    const rows = [
      row({ status: 'created', type: 'series' }, 1),
      row(
        {
          status: 'updated',
          type: 'card',
          row: { row: 2, type: 'card', slug: 'aurora', name: '极光', seriesSlug: 'celestial-dawn' },
        },
        2,
      ),
      row(
        {
          status: 'unchanged',
          type: 'card',
          row: { row: 3, type: 'card', slug: 'raven', name: '渡鸦', seriesSlug: 'celestial-dawn' },
        },
        3,
      ),
      row(
        {
          status: 'error',
          type: 'card',
          row: { row: 4, type: 'card', slug: null, name: null, seriesSlug: 'celestial-dawn' },
          errors: [{ path: 'series[0].cards[2].rarity', code: 'INVALID_RARITY' }],
        },
        4,
      ),
    ];
    importImpl.current = async () => rows;
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON 内容' }));
    await user.paste('[]');
    await user.click(screen.getByRole('button', { name: '预览' }));

    expect(screen.getByText('错误')).toBeInTheDocument();
    expect(screen.queryByText('新增')).not.toBeInTheDocument();
    expect(screen.queryByText('无变化')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '只看错误' })).toBeChecked();
    // 375 的问题清单在 jsdom 里也渲染（没有 CSS），问题列断言限定在表格内。
    const table = screen.getByRole('table');
    expect(within(table).getByText('series[0].cards[2].rarity')).toBeInTheDocument();
    expect(
      within(table).getByText(/必须是 common、rare、epic、legendary 之一/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled();
    expect(screen.getByText('有 1 处错误，修正后才能导入')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '全部' }));
    expect(screen.getByText('新增')).toBeInTheDocument();
    expect(screen.getByText('更新')).toBeInTheDocument();
    expect(screen.getByText('无变化')).toBeInTheDocument();
    expect(screen.getByText('错误')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'JSON 内容' }), ' ');
    expect(screen.getByText('内容已修改，请重新预览')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled();
  });

  it('shows the English message for a known code and the server message for an unknown code', async () => {
    const user = userEvent.setup();
    rootStore.locale.setLocale('en-US');
    importImpl.current = async () => [
      row(
        {
          status: 'error',
          errors: [
            { path: 'series[0].cards[0].rarity', code: 'INVALID_RARITY' },
            { path: 'series[0].title', code: 'WAT', message: '服务端中文说明' },
          ],
        },
        1,
      ),
    ];
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON' }));
    await user.paste('[]');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText(/Must be common, rare, epic, or legendary/)).toBeInTheDocument();
    expect(within(table).getByText(/Something went wrong: 服务端中文说明/)).toBeInTheDocument();
    expect(screen.queryByText('WAT')).not.toBeInTheDocument();
  });

  it('imports after confirmation and reports that a failed import changed nothing', async () => {
    const user = userEvent.setup();
    const created = [row({ status: 'created' }, 1)];
    importImpl.current = async (input) => {
      if (!input.dryRun) {
        throw {
          message: '导入数据校验失败',
          data: {
            code: 'BAD_REQUEST',
            adminCatalogError: {
              rows: [
                row(
                  {
                    status: 'error',
                    errors: [{ path: 'series[0].slug', code: 'SLUG_FORMAT' }],
                  },
                  1,
                ),
              ],
            },
          },
        };
      }
      return created;
    };
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON 内容' }));
    await user.paste('[]');
    await user.click(screen.getByRole('button', { name: '预览' }));
    await user.click(screen.getByRole('button', { name: '导入' }));
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '确认导入' }));
    expect(calls.at(-1)?.dryRun).toBe(false);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('导入失败，没有任何记录被修改');
    expect(alert).toHaveTextContent('series[0].slug');
    expect(alert).toHaveTextContent('slug 只能包含小写字母、数字和连字符');
  });

  it('shows a commit-time parallel rejection in the failure box with the preview format', async () => {
    const user = userEvent.setup();
    importImpl.current = async (input) => {
      if (!input.dryRun) {
        throw {
          message: '导入数据校验失败',
          data: {
            code: 'BAD_REQUEST',
            adminCatalogError: {
              rows: [
                row(
                  {
                    status: 'error',
                    errors: [
                      { path: 'series[0].cards[0].parallelName', code: 'parallel_name_required' },
                      { path: 'series[0].cards[0].parallelOfSlug', code: 'parallel_chain' },
                    ],
                  },
                  1,
                ),
              ],
            },
          },
        };
      }
      return [row({ status: 'created' }, 1)];
    };
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON 内容' }));
    await user.paste('[]');
    await user.click(screen.getByRole('button', { name: '预览' }));
    await user.click(screen.getByRole('button', { name: '导入' }));
    await user.click(screen.getByRole('button', { name: '确认导入' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('导入失败，没有任何记录被修改');
    const lines = [...alert.querySelectorAll('p')].slice(1);
    expect(lines[0]).toHaveTextContent('基础卡：');
    expect(lines[0]).toHaveTextContent('series[0].cards[0].parallelOfSlug');
    expect(lines[0]?.querySelector('span')).toHaveClass(
      'font-mono',
      'wrap-anywhere',
      'text-neutral-600',
    );
    expect(lines[1]).toHaveTextContent('平行名称：');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('lists every parallel preview error as field name, copy, then path', async () => {
    const user = userEvent.setup();
    importImpl.current = async () => [
      {
        row: { row: 2, type: 'card', slug: 'foil', name: '金箔', seriesSlug: 'dawn' },
        status: 'error' as const,
        errors: [
          { path: 'series[0].cards[0].printRun', code: 'print_run_min' },
          { path: 'series[0].cards[0].parallelOf', code: 'parallel_cross_series' },
        ],
      },
    ];
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON 内容' }));
    await user.paste(
      JSON.stringify([
        {
          slug: 'dawn',
          title: '黎明',
          cards: [
            { slug: 'foil', name: '金箔', rarity: 'common', parallelOf: 'other', printRun: 0 },
          ],
        },
      ]),
    );
    await user.click(screen.getByRole('button', { name: '预览' }));
    const problem = await within(await screen.findByRole('table')).findByText('基础卡', {
      exact: false,
    });
    const cell = problem.closest('p');
    expect(cell).toHaveTextContent('基础卡：基础卡必须属于同一系列');
    expect(cell).toHaveTextContent('series[0].cards[0].parallelOf');
    expect(cell?.querySelector('span')).toHaveClass(
      'font-mono',
      'wrap-anywhere',
      'text-neutral-600',
    );
    expect(cell).not.toHaveAttribute('role', 'alert');
    const lines = [...(cell?.parentElement?.querySelectorAll('p') ?? [])].map(
      (node) => node.textContent ?? '',
    );
    expect(lines[0]).toContain('基础卡：');
    expect(lines[1]).toContain('限量总数：');
    const run = within(screen.getByRole('table'))
      .getByText('限量总数', { exact: false })
      .closest('p');
    expect(run).toHaveTextContent('限量总数：限量数量至少为 1，不限量请留空');
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled();
    expect(
      // CH-107 v4 §7.4：每条错误算一处，这一行有 2 条。
      screen.getAllByRole('status').some((node) => node.textContent?.includes('2 处错误')),
    ).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the same breadcrumb trail as the other admin pages', () => {
    renderPage();
    const nav = screen.getByRole('navigation', { name: '面包屑导航' });
    expect(nav).toHaveTextContent('首页');
    expect(nav).toHaveTextContent('管理');
    expect(nav).toHaveTextContent('内容管理');
    expect(nav).toHaveTextContent('导入 JSON');
    expect(nav.querySelector('a[href="/admin/catalog"]')).toBeTruthy();
  });

  it('blocks an oversized or over-row import before calling the API', async () => {
    const user = userEvent.setup();
    renderPage();
    const textbox = screen.getByRole('textbox', { name: 'JSON 内容' });
    const cards = Array.from({ length: CATALOG_IMPORT_MAX_ROWS }, (_, index) => ({
      slug: `c${index}`,
    }));
    await user.click(textbox);
    await user.paste(JSON.stringify([{ slug: 's', cards }]));
    await user.click(screen.getByRole('button', { name: '预览' }));
    expect(parseErrorText()).toHaveTextContent(
      `一次最多导入 ${CATALOG_IMPORT_MAX_ROWS} 行，当前 ${CATALOG_IMPORT_MAX_ROWS + 1} 行`,
    );
    expect(calls).toHaveLength(0);

    await user.clear(textbox);
    await user.click(textbox);
    await user.paste(JSON.stringify([{ slug: 's', blob: 'x'.repeat(1024 * 1024) }]));
    await user.click(screen.getByRole('button', { name: '预览' }));
    expect(parseErrorText()).toHaveTextContent('一次最多导入 1MB');
    expect(calls).toHaveLength(0);
  });

  it('disables another import of the same content until the input changes', async () => {
    const user = userEvent.setup();
    const created = [row({ status: 'created' }, 1)];
    importImpl.current = async () => created;
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON 内容' }));
    await user.paste('[]');
    await user.click(screen.getByRole('button', { name: '预览' }));
    await user.click(screen.getByRole('button', { name: '导入' }));
    await user.click(screen.getByRole('button', { name: '确认导入' }));

    expect(await screen.findByText(/导入完成/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled();
    expect(screen.getByRole('link', { name: '返回内容管理' })).toHaveAttribute(
      'href',
      '/admin/catalog',
    );
    expect(screen.getByText('这份内容已经导入过，请修改后再导入')).toBeInTheDocument();
    expect(calls.filter((call) => !call.dryRun)).toHaveLength(1);

    await user.type(screen.getByRole('textbox', { name: 'JSON 内容' }), ' ');
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: '返回内容管理' })).not.toBeInTheDocument();
    expect(screen.queryByText('这份内容已经导入过，请修改后再导入')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '预览' }));
    expect(screen.getByRole('button', { name: '导入' })).toBeEnabled();
  });

  it('stays disabled when the edited text or reselected file matches the imported content', async () => {
    const user = userEvent.setup();
    const created = [row({ status: 'created' }, 1)];
    importImpl.current = async () => created;
    renderPage();
    const textbox = screen.getByRole('textbox', { name: 'JSON 内容' });
    await user.click(textbox);
    await user.paste('[]');
    await user.click(screen.getByRole('button', { name: '预览' }));
    await user.click(screen.getByRole('button', { name: '导入' }));
    await user.click(screen.getByRole('button', { name: '确认导入' }));
    expect(await screen.findByText(/导入完成/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回内容管理' })).toBeInTheDocument();

    await user.type(textbox, 'x');
    expect(screen.queryByRole('link', { name: '返回内容管理' })).not.toBeInTheDocument();
    await user.keyboard('{Backspace}');
    expect(textbox).toHaveValue('[]');
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled();
    expect(screen.getByRole('link', { name: '返回内容管理' })).toBeInTheDocument();
    expect(screen.getByText('这份内容已经导入过，请修改后再导入')).toBeInTheDocument();

    const file = new File(['[]'], 'catalog.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('选择文件'), file);
    await waitFor(() => expect(textbox).toHaveValue('[]'));
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled();
    expect(screen.getByRole('link', { name: '返回内容管理' })).toBeInTheDocument();
    expect(screen.getByText('这份内容已经导入过，请修改后再导入')).toBeInTheDocument();
    expect(calls.filter((call) => !call.dryRun)).toHaveLength(1);
  });
});

describe('catalog import focus and error wiring (CH-213 §17)', () => {
  async function previewWith(text: string) {
    const user = userEvent.setup();
    renderPage();
    const box = screen.getByRole('textbox', { name: 'JSON 内容' });
    await user.click(box);
    await user.paste(text);
    await user.click(screen.getByRole('button', { name: '预览' }));
    return { user, box };
  }

  it('moves focus to the preview title when the preview has no errors', async () => {
    importImpl.current = async () => [row({ status: 'created' }, 1)];
    await previewWith('[]');
    const title = await screen.findByRole('heading', { level: 2, name: '预览结果' });
    await waitFor(() => expect(title).toHaveFocus());
  });

  it('names the preview title in English', async () => {
    rootStore.locale.setLocale('en-US');
    importImpl.current = async () => [row({ status: 'created' }, 1)];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON' }));
    await user.paste('[]');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const title = await screen.findByRole('heading', { level: 2, name: 'Preview results' });
    await waitFor(() => expect(title).toHaveFocus());
  });

  it('moves focus to the summary, not the first error row, when the preview has errors', async () => {
    importImpl.current = async () => [
      row({ status: 'created' }, 1),
      row({ status: 'error', errors: [{ path: 'series[0].slug', code: 'SLUG_FORMAT' }] }, 2),
    ];
    await previewWith('[]');
    const summary = await screen.findByRole('status');
    await waitFor(() => expect(summary).toHaveFocus());
    expect(summary).toHaveTextContent('1 处错误');
  });

  it('marks the textarea invalid, links the parse error, focuses it, and clears both on edit', async () => {
    const { user, box } = await previewWith('{');
    const alert = parseErrorText();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription(alert.textContent ?? '');
    await waitFor(() => expect(box).toHaveFocus());
    await user.type(box, '}');
    expect(box).not.toHaveAttribute('aria-invalid');
    expect(box).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a preview 500 in the failure box, not under the textarea, and focuses the box', async () => {
    importImpl.current = async () => {
      throw { message: 'Internal server error', data: { code: 'INTERNAL_SERVER_ERROR' } };
    };
    const { box } = await previewWith('[]');
    const alert = await screen.findByRole('alert');
    expect(alert.tagName).toBe('DIV');
    expect(alert).not.toHaveTextContent('Internal server error');
    expect(box).not.toHaveAttribute('aria-invalid');
    expect(box).not.toHaveAccessibleDescription();
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('focuses the failure box when the import is rejected at commit time', async () => {
    importImpl.current = async (input) => {
      if (!input.dryRun) throw { message: 'x', data: { code: 'BAD_REQUEST' } };
      return [row({ status: 'created' }, 1)];
    };
    const { user } = await previewWith('[]');
    await user.click(screen.getByRole('button', { name: '导入' }));
    await user.click(screen.getByRole('button', { name: '确认导入' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('导入失败，没有任何记录被修改');
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('skips the sr-only file input in Tab order and lands on the visible file button (WCAG 2.4.7)', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText('选择文件', { selector: 'input' });
    expect(input).toHaveAttribute('tabindex', '-1');
    await user.click(screen.getByRole('textbox', { name: 'JSON 内容' }));
    await user.tab();
    expect(input).not.toHaveFocus();
    expect(screen.getByRole('button', { name: '选择文件' })).toHaveFocus();
  });

  it('does not move focus while the user edits after a preview', async () => {
    importImpl.current = async () => [row({ status: 'created' }, 1)];
    const { user, box } = await previewWith('[]');
    const title = await screen.findByRole('heading', { level: 2, name: '预览结果' });
    await waitFor(() => expect(title).toHaveFocus());
    await user.click(box);
    await user.type(box, ' ');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(box).toHaveFocus();
  });
  it('keeps focus in the textarea when the user goes back to typing while the preview is pending', async () => {
    let resolve: (rows: ImportRowResult[]) => void = () => {};
    importImpl.current = () =>
      new Promise((done) => {
        resolve = done;
      });
    const { user, box } = await previewWith('[]');
    await user.click(box);
    await user.type(box, ' ');
    expect(box).toHaveFocus();
    resolve([row({ status: 'created' }, 1)]);
    await screen.findByRole('heading', { level: 2, name: '预览结果' });
    await new Promise((done) => requestAnimationFrame(done));
    await new Promise((done) => requestAnimationFrame(done));
    expect(box).toHaveFocus();
  });

  it('renders an empty status summary before any preview and uses no alert for parse errors', async () => {
    const first = renderPage();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    first.unmount();
    const { box } = await previewWith('{');
    await waitFor(() => expect(box).toHaveFocus());
    expect(parseErrorText()).toHaveTextContent('JSON');
    expect(screen.queryByRole('alert')).toBeNull();
    // 焦点已移到输入框，describedby 会读，摘要不再重复。
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('does not steal focus the user moved elsewhere and announces the parse error once via the summary', async () => {
    let reject: (error: unknown) => void = () => {};
    importImpl.current = () =>
      new Promise((_, fail) => {
        reject = fail;
      });
    const { user } = await previewWith('[]');
    const file = screen.getByRole('button', { name: /文件/ });
    file.focus();
    reject({
      message: 'x',
      data: { code: 'BAD_REQUEST', adminCatalogError: { code: 'IMPORT_TOO_MANY_ROWS' } },
    });
    await waitFor(() => expect(document.getElementById('import-json-error')).not.toBeNull());
    await new Promise((done) => requestAnimationFrame(done));
    await new Promise((done) => requestAnimationFrame(done));
    expect(file).toHaveFocus();
    const message = parseErrorText().textContent ?? '';
    expect(message).not.toBe('');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(message));
    expect(screen.queryByRole('alert')).toBeNull();
    void user;
  });

  it('marks a stale preview with a hint, keeps import disabled, and does not fade the preview (§17-8)', async () => {
    importImpl.current = async () => [row({ status: 'created' }, 1)];
    const { user, box } = await previewWith('[]');
    await screen.findByRole('heading', { level: 2, name: '预览结果' });
    expect(screen.getByRole('button', { name: '导入' })).toBeEnabled();
    expect(screen.queryByText('内容已修改，请重新预览')).toBeNull();

    await user.type(box, ' ');
    const hint = screen.getByText('内容已修改，请重新预览');
    expect(hint).toHaveClass('text-sm', 'text-neutral-600');
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled();
    // 预览区及其祖先都不变淡（控件内部的 sr 输入框不算）。
    for (let node: Element | null = hint.parentElement; node; node = node.parentElement) {
      expect(node.className).not.toMatch(/opacity-|text-neutral-(400|500)/);
    }
    // 提示不进 live region、不移焦点。
    expect(screen.getByRole('status')).not.toHaveTextContent('内容已修改');
    expect(hint.closest('[role="status"],[role="alert"],[aria-live]')).toBeNull();
    expect(box).toHaveFocus();
  });

  it('shows the stale hint in English', async () => {
    rootStore.locale.setLocale('en-US');
    importImpl.current = async () => [row({ status: 'created' }, 1)];
    const user = userEvent.setup();
    renderPage();
    const box = screen.getByRole('textbox', { name: 'JSON' });
    await user.click(box);
    await user.paste('[]');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('heading', { level: 2, name: 'Preview results' });
    await user.type(box, ' ');
    expect(screen.getByText('Text changed. Preview again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });
});

describe('catalog import taxonomy errors (CH-107 v4 §7.4–§7.8)', () => {
  async function previewAc62(locale: 'zh-CN' | 'en-US') {
    rootStore.locale.setLocale(locale);
    importImpl.current = async () => AC62_ROWS;
    const user = userEvent.setup();
    renderPage();
    const box = screen.getByRole('textbox', { name: locale === 'zh-CN' ? 'JSON 内容' : 'JSON' });
    await user.click(box);
    await user.paste(JSON.stringify(AC62_IMPORT));
    await user.click(screen.getByRole('button', { name: locale === 'zh-CN' ? '预览' : 'Preview' }));
    return { user, box, table: await screen.findByRole('table') };
  }

  it('shows the §7.4 copy for each of the five errors in Chinese, with field and path, never the code', async () => {
    const { table } = await previewAc62('zh-CN');
    const text = table.textContent ?? '';
    expect(text).toContain(
      'categorySlug：没有 slug 为「no-such-category」的品类。先到 内容管理 › 品类 新建，或改成已有品类的 slug。',
    );
    expect(text).toContain(
      'releaseDate：发售日期「2026-13-01」不是有效日期。按 YYYY-MM-DD 写，例如 2026-11-14。',
    );
    expect(text).toContain(
      'subsetSlug：子集「nowhere」不在这个系列里，本文件的 subsets 里也没有。把它加进这个系列的 subsets，或改成已有子集的 slug。',
    );
    expect(text).toContain(
      `cardNumber：卡号「123456789012345678901」有 21 个字符，最多 ${CARD_NUMBER_MAX} 个。删到 ${CARD_NUMBER_MAX} 个以内。`,
    );
    expect(text).toContain(
      'cardNo：不认识字段「cardNo」。对照「查看格式示例」改成正确的字段名，或删掉它。',
    );
    for (const path of [
      'series[0].categorySlug',
      'series[1].releaseDate',
      'series[2].cards[0].subsetSlug',
      'series[2].cards[1].cardNumber',
      'series[2].cards[2].cardNo',
    ]) {
      const node = within(table).getByText(path);
      expect(node).toHaveClass('font-mono', 'text-xs', 'text-muted', 'wrap-anywhere');
    }
    for (const code of [
      'CATEGORY_NOT_FOUND',
      'SUBSET_NOT_FOUND',
      'TOO_LONG',
      'INVALID_DATE',
      'UNKNOWN_FIELD',
    ]) {
      expect(document.body.textContent).not.toContain(code);
    }
    // 行列、汇总与阻断：5 处错误。
    expect(within(table).getByRole('columnheader', { name: '行' })).toBeInTheDocument();
    expect(screen.getByText('有 5 处错误，修正后才能导入')).toHaveAttribute('id', 'import-blocked');
    expect(screen.getByRole('button', { name: '导入' })).toHaveAttribute(
      'aria-describedby',
      'import-blocked',
    );
  });

  it('shows the §7.4 copy in English and lists every problem for 375 under the summary', async () => {
    await previewAc62('en-US');
    const section = screen.getByRole('region', { name: '5 problems to fix' });
    expect(section).toHaveClass('sm:hidden');
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('Row 1 · Series · bad-category');
    expect(items[0]).toHaveTextContent(
      'categorySlug: No category has the slug "no-such-category". Create it in Catalog › Categories first, or use an existing category slug.',
    );
    expect(items[1]).toHaveTextContent(
      'releaseDate: Release date "2026-13-01" is not a valid date. Use YYYY-MM-DD, for example 2026-11-14.',
    );
    expect(items[2]).toHaveTextContent('Row 4 · Card · bad-subset');
    expect(items[2]).toHaveTextContent(
      `subsetSlug: Subset "nowhere" is not in this series or in this file's subsets.`,
    );
    expect(items[3]).toHaveTextContent(
      `cardNumber: Card number "123456789012345678901" has 21 characters. The limit is ${CARD_NUMBER_MAX}. Shorten it.`,
    );
    expect(items[4]).toHaveTextContent(
      'cardNo: Unknown field "cardNo". Rename it to a field from the example, or delete it.',
    );
    // 问题列在 375 隐藏。
    expect(screen.getByRole('columnheader', { name: 'Problem' })).toHaveClass(
      'hidden',
      'sm:table-cell',
    );
  });

  it('keeps the problem list complete when the filter shows every row', async () => {
    const { user } = await previewAc62('zh-CN');
    await user.click(screen.getByRole('radio', { name: '全部' }));
    const section = screen.getByRole('region', { name: '需要修改的 5 处' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(5);
  });

  it('adds import-blocked to the textarea describedby and drops only that id when the preview goes stale', async () => {
    const { user, box } = await previewAc62('zh-CN');
    expect(box).toHaveAttribute('aria-describedby', 'import-blocked');
    await user.type(box, ' ');
    expect(box).not.toHaveAttribute('aria-describedby');
    // 重新预览后 blocked 回来；再改坏 JSON 点预览，只剩解析错误的 id。
    await user.clear(box);
    await user.paste(JSON.stringify(AC62_IMPORT));
    await user.click(screen.getByRole('button', { name: '预览' }));
    expect(box).toHaveAttribute('aria-describedby', 'import-blocked');
    await user.clear(box);
    await user.paste('{');
    await user.click(screen.getByRole('button', { name: '预览' }));
    expect(box).toHaveAttribute('aria-describedby', 'import-json-error');
  });

  it('truncates a long value to 40 characters plus an ellipsis and counts length after trim', async () => {
    const long = `  ${'A'.repeat(45)}  `;
    rootStore.locale.setLocale('zh-CN');
    importImpl.current = async () => [
      {
        row: { row: 1, type: 'card', slug: 'c', name: 'c', seriesSlug: 's' },
        status: 'error',
        errors: [{ path: 'series[0].cards[0].cardNumber', code: 'TOO_LONG' }],
      },
    ];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON 内容' }));
    await user.paste(
      JSON.stringify([
        {
          slug: 's',
          title: 's',
          cards: [{ slug: 'c', name: 'c', rarity: 'common', cardNumber: long }],
        },
      ]),
    );
    await user.click(screen.getByRole('button', { name: '预览' }));
    const table = await screen.findByRole('table');
    const shown = `  ${'A'.repeat(38)}…`;
    expect(table.textContent).toContain(
      `卡号「${shown}」有 45 个字符，最多 ${CARD_NUMBER_MAX} 个。`,
    );
  });

  it('counts {length} in code points like the server, so 21 emoji show 21', async () => {
    const emoji = '😀'.repeat(21);
    rootStore.locale.setLocale('en-US');
    importImpl.current = async () => [
      {
        row: { row: 1, type: 'card', slug: 'c', name: 'c', seriesSlug: 's' },
        status: 'error',
        errors: [{ path: 'series[0].cards[0].cardNumber', code: 'TOO_LONG' }],
      },
    ];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON' }));
    await user.paste(
      JSON.stringify([
        {
          slug: 's',
          title: 's',
          cards: [{ slug: 'c', name: 'c', rarity: 'common', cardNumber: emoji }],
        },
      ]),
    );
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const table = await screen.findByRole('table');
    expect(table.textContent).toContain(
      `Card number "${emoji}" has 21 characters. The limit is ${CARD_NUMBER_MAX}.`,
    );
    expect(table.textContent).not.toContain('has 42 characters');
  });

  it('falls back to the code table, then to the unknown sentence, for codes outside §7.4', async () => {
    rootStore.locale.setLocale('zh-CN');
    importImpl.current = async () => [
      {
        row: { row: 1, type: 'series', slug: 's', name: 's' },
        status: 'error',
        errors: [
          { path: 'series[0].categorySlug', code: 'SLUG_FORMAT' },
          { path: 'series[0].subsets[0].kind', code: 'INVALID_TYPE' },
          { path: 'series[0].subsets[1].slug', code: 'SLUG_DUPLICATE_IN_FILE' },
          { path: 'series[0].title', code: 'SOMETHING_NEW', message: '服务端说明' },
        ],
      },
    ];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'JSON 内容' }));
    await user.paste('[{"slug":"s","title":"s","categorySlug":"Bad Slug"}]');
    await user.click(screen.getByRole('button', { name: '预览' }));
    const table = await screen.findByRole('table');
    const text = table.textContent ?? '';
    expect(text).toContain('categorySlug：slug 只能包含小写字母、数字和连字符');
    expect(text).toContain('kind：');
    expect(text).toContain('series[0].subsets[1].slug');
    expect(text).toContain('title：出错了：服务端说明');
    expect(text).not.toContain('SOMETHING_NEW');
    expect(text).not.toContain('INVALID_TYPE');
  });

  it('shows the locale example with the new fields and the other-fields line', async () => {
    const user = userEvent.setup();
    rootStore.locale.setLocale('zh-CN');
    const view = renderPage();
    const summary = screen.getByText('查看格式示例');
    expect(summary).toHaveClass('py-0.5');
    await user.click(summary);
    const pre = view.container.querySelector('details pre');
    const zh = pre?.textContent ?? '';
    for (const field of [
      '"categorySlug": "ptcg-sc"',
      '"releaseDate": "2026-11-14"',
      '"subsets"',
      '"cardNumber": "001"',
      '"subsetSlug": "base"',
      '"kind": "INSERT"',
    ]) {
      expect(zh).toContain(field);
    }
    expect(zh).toContain('"title": "天穹黎明"');
    expect(JSON.parse(zh)).toHaveLength(1);
    expect(screen.getByText(/其他可选字段：description、coverUrl/)).toHaveClass(
      'text-xs',
      'text-muted',
    );

    view.unmount();
    rootStore.locale.setLocale('en-US');
    const en = renderPage();
    const enText = en.container.querySelector('details pre')?.textContent ?? '';
    expect(enText).toContain('"title": "Celestial Dawn"');
    expect(enText).toContain('"name": "Promos"');
    expect(enText).toContain('"subsetSlug": "base"');
    expect(screen.getByText(/A subset's kind is BASE or INSERT\./)).toBeInTheDocument();
  });
});
