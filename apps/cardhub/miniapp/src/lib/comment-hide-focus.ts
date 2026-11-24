/**
 * After a successful (or 404) comment delete, restore focus to a target that
 * will still be mounted: the next comment's Report control, else the previous
 * comment's Report, else the comments heading.
 *
 * Selectors are captured while the doomed row is still in the DOM.
 */
export function resolveFocusAfterCommentHide(hiddenId: string): () => HTMLElement | null {
  const { nextSel, prevSel } = captureNeighborReportSelectors(hiddenId);
  return () => {
    if (nextSel) {
      const next = document.querySelector<HTMLElement>(nextSel);
      if (next) return next;
    }
    if (prevSel) {
      const prev = document.querySelector<HTMLElement>(prevSel);
      if (prev) return prev;
    }
    return document.querySelector<HTMLElement>('[data-comments-heading]');
  };
}

function commentRoot(): ParentNode | null {
  if (typeof document === 'undefined') return null;
  const heading = document.querySelector('[data-comments-heading]');
  if (!heading) return document;
  return heading.closest('.section-card') ?? heading.parentElement ?? document;
}

function commentRow(id: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const trigger = document.querySelector(
    `[data-delete-trigger="${id}"], [data-report-trigger="${id}"]`,
  );
  return trigger?.closest('.card-comment') ?? null;
}

function ownReport(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(':scope > .card-comment__actions [data-report-trigger]');
}

function reportSelector(row: HTMLElement | undefined): string | null {
  if (!row) return null;
  const id = ownReport(row)?.getAttribute('data-report-trigger');
  return id ? `[data-report-trigger="${id}"]` : null;
}

export function captureNeighborReportSelectors(hiddenId: string): {
  nextSel: string | null;
  prevSel: string | null;
} {
  if (typeof document === 'undefined') return { nextSel: null, prevSel: null };
  const current = commentRow(hiddenId);
  const root = commentRoot();
  const all = root ? [...root.querySelectorAll<HTMLElement>('.card-comment')] : [];
  const survivors = all.filter((row) => row !== current && !(current && current.contains(row)));
  const next = current
    ? survivors.find(
        (row) => (current.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      )
    : survivors[0];
  const prev = current
    ? [...survivors]
        .reverse()
        .find(
          (row) => (current.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING) !== 0,
        )
    : undefined;
  return { nextSel: reportSelector(next), prevSel: reportSelector(prev) };
}
