// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { resolveFocusAfterCommentHide } from './comment-hide-focus';

function row(id: string, { report = true, del = false, reply = false } = {}) {
  const cls = reply ? 'card-comment card-comment--reply' : 'card-comment comment-item';
  const reportBtn = report
    ? `<button type="button" data-report-trigger="${id}" class="report-entry__trigger">举报</button>`
    : '';
  const delBtn = del
    ? `<button type="button" data-delete-trigger="${id}" class="card-comment__action">删除</button>`
    : '';
  return `<div class="${cls}"><div class="card-comment__actions">${reportBtn}${delBtn}</div></div>`;
}

function mount(html: string) {
  document.body.innerHTML = `<div class="section-card"><span data-comments-heading="true" tabindex="-1">评论区</span>${html}</div>`;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('resolveFocusAfterCommentHide', () => {
  it("prefers the next comment's Report button", () => {
    mount(row('a', { del: true, report: false }) + row('b', { report: true }));
    const getEl = resolveFocusAfterCommentHide('a');
    document.querySelector('[data-delete-trigger="a"]')?.closest('.card-comment')?.remove();
    const el = getEl();
    expect(el?.getAttribute('data-report-trigger')).toBe('b');
  });

  it("falls back to the previous comment's Report when there is no next Report", () => {
    mount(row('b', { report: true }) + row('a', { del: true, report: false }));
    const getEl = resolveFocusAfterCommentHide('a');
    document.querySelector('[data-delete-trigger="a"]')?.closest('.card-comment')?.remove();
    const el = getEl();
    expect(el?.getAttribute('data-report-trigger')).toBe('b');
  });

  it('falls back to the list heading when the list will be empty', () => {
    mount(row('a', { del: true, report: false }));
    const getEl = resolveFocusAfterCommentHide('a');
    document.querySelector('[data-delete-trigger="a"]')?.closest('.card-comment')?.remove();
    const el = getEl();
    expect(el?.getAttribute('data-comments-heading')).toBe('true');
    expect(el?.textContent).toBe('评论区');
  });

  it('does not pick a Report inside a deleted parent thread', () => {
    mount(
      `<div class="card-comment comment-item"><div class="card-comment__actions"><button type="button" data-delete-trigger="parent" class="card-comment__action">删除</button></div><div class="card-comment__replies">${row('child', { report: true, reply: true })}</div></div>` +
        row('next', { report: true }),
    );
    const getEl = resolveFocusAfterCommentHide('parent');
    document.querySelector('[data-delete-trigger="parent"]')?.closest('.comment-item')?.remove();
    const el = getEl();
    expect(el?.getAttribute('data-report-trigger')).toBe('next');
  });
});
