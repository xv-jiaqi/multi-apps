import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../../stores/root-store';
import type { ImportRowResult } from '../../components/admin/catalog-utils';

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
    useUtils: () => ({}),
  },
}));

import { CatalogImportPage } from './catalog-import';

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
    expect(screen.getByRole('alert')).toHaveTextContent('第 4 行');
    expect(calls).toHaveLength(0);
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
    expect(screen.getByText('series[0].cards[2].rarity')).toBeInTheDocument();
    expect(screen.getByText(/必须是 common、rare、epic、legendary 之一/)).toBeInTheDocument();
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
    expect(screen.getByText(/Must be common, rare, epic, or legendary/)).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong: 服务端中文说明/)).toBeInTheDocument();
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
});
