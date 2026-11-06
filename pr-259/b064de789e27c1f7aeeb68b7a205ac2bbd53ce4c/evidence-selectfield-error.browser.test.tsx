// Evidence harness for CH-225 25-3/25-4 error-state screenshots. Not committed.
import '@testing-library/jest-dom/vitest';
import { fieldErrorMessage, t } from '@repo/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
import '../styles/globals.css';

const q = { data: undefined, isLoading: false, isFetching: false, isError: false, isSuccess: false, refetch: () => {} };
vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: () => {},
  trpc: {
    useUtils: () => ({ listings: { list: { invalidate: () => {} }, byCard: { invalidate: () => {} } } }),
    search: { global: { useQuery: () => q } },
    notifications: { unreadCount: { useQuery: () => q } },
    cards: {
      bySlug: {
        useQuery: (input: { slug: string }, o?: { enabled?: boolean }) =>
          o?.enabled && input.slug
            ? { data: { slug: input.slug, name: '极光骑士', rarity: 'rare', imageUrl: null, seriesSlug: 'starter', seriesTitle: '启程' }, isLoading: false, isError: false }
            : { data: undefined, isLoading: false, isError: false },
      },
      search: { useQuery: () => q },
    },
    listings: { publish: { useMutation: () => ({ mutate: () => { throw new Error('publish must not be called'); }, isPending: false }) } },
  },
}));

import { SelectField } from './trade-publish';

function hex(color: string) {
  const c = document.createElement('canvas'); c.width = c.height = 1;
  const x = c.getContext('2d')!; x.fillStyle = color; x.fillRect(0, 0, 1, 1);
  return '#' + [...x.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
const results: unknown[] = [];
afterEach(() => { cleanup(); document.documentElement.classList.remove('dark'); });

describe('ch225 evidence', () => {
  const runs = [375, 1440].flatMap((w) => (['zh-CN', 'en-US'] as const).flatMap((l) => [false, true].map((d) => [w, l, d] as const)));
  it.for(runs)('currency error %i %s dark=%s', async ([w, lang, dark], { task }) => {
    await commands.setViewport(w, 1400);
    rootStore.locale.setLocale(lang);
    rootStore.session.signIn('local-fake', { id: 'u1', username: 'alice', role: 'user' });
    if (dark) document.documentElement.classList.add('dark');
    const err = fieldErrorMessage(lang, 'Invalid option');
    render(
      <div className="bg-background p-4" data-qa="host"><div className="mx-auto max-w-2xl rounded-xl border border-card bg-card p-6"><div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <label className="block space-y-1"><span className="text-xs font-medium text-neutral-600">{t(lang, 'trade.publish.price')}</span><input className="w-full rounded-md border border-input bg-card px-3 py-2" /></label>
        <SelectField label={t(lang, 'trade.publish.currency')} value="CNY" onValueChange={() => {}} options={[{ value: 'CNY', label: 'CNY' }]} invalid error={err} errorId="trade-currency-error" />
      </div></div></div>,
    );
    const trigger = screen.getByRole('combobox', { name: t(lang, 'trade.publish.currency') });
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAccessibleDescription(err);
    const s = getComputedStyle(trigger as HTMLElement);
    const r = { w, lang, dark, ariaInvalid: (trigger as HTMLElement).getAttribute('aria-invalid'), describedby: (trigger as HTMLElement).getAttribute('aria-describedby'), error: document.getElementById('trade-currency-error')!.textContent, errorClass: document.getElementById('trade-currency-error')!.className, errorColor: hex(getComputedStyle(document.getElementById('trade-currency-error')!).color), borderColor: hex(s.borderTopColor), boxShadow: s.boxShadow };
    results.push(r);
    (task.meta as Record<string, unknown>).ch225 = r;
    (trigger as HTMLElement).blur();
    await page.screenshot({ path: `/workspace/ch225-shots/after_error_currency_${w}_${lang.slice(0, 2)}${dark ? '_dark' : ''}.png`, element: document.querySelector('[data-qa=host]')! });
  });
});
