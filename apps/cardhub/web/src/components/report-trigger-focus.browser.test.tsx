import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
import '../styles/globals.css';

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    reports: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import { ReportButton } from './report-button';

function renderReport() {
  render(
    <MemoryRouter>
      <ReportButton targetType="COMMENT" targetId="00000000-0000-4000-8000-000000000001" />
    </MemoryRouter>,
  );
}

function focusRing(element: HTMLElement) {
  element.focus({ focusVisible: true });
  expect(element.matches(':focus-visible')).toBe(true);
  const style = getComputedStyle(element);
  return {
    outlineColor: style.outlineColor,
    outlineStyle: style.outlineStyle,
    boxShadow: style.boxShadow,
  };
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
});

afterEach(() => {
  cleanup();
  rootStore.session.signOut();
});

describe('report trigger focus ring', () => {
  it('paints the same focus-visible outline and ring on the link, report button, and cancel', async () => {
    const user = userEvent.setup();
    renderReport();
    const loggedOut = focusRing(screen.getByRole('link', { name: '举报' }));
    cleanup();

    rootStore.session.signIn('token', { id: 'u1', username: 'qa_user', role: 'user' });
    renderReport();
    await user.click(screen.getByRole('button', { name: '举报' }));
    const report = focusRing(screen.getByRole('button', { name: '举报' }));
    const cancel = focusRing(screen.getByRole('button', { name: '取消' }));

    expect(loggedOut.boxShadow).not.toBe('none');
    expect(report).toEqual(loggedOut);
    expect(cancel).toEqual(loggedOut);
    expect(loggedOut.boxShadow).toMatch(/59[, ]\s*130[, ]\s*246/);
  });
});
