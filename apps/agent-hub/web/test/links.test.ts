import { installLinkGuard } from '../src/lib/links';

function clickLink(doc: Document, href: string): MouseEvent {
  const anchor = doc.createElement('a');
  anchor.href = href;
  anchor.textContent = href;
  doc.body.append(anchor);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  anchor.dispatchEvent(event);
  anchor.remove();
  return event;
}

describe('外链守卫', () => {
  it('同一文档的 hash 链接不拦截，http 外链交给 open', async () => {
    const open = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
    const onError = vi.fn();
    const uninstall = installLinkGuard(document, open, onError);
    document.body.replaceChildren();

    const internal = clickLink(document, '#/tasks/5f0c2a9e');
    expect(internal.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();

    const external = clickLink(document, 'https://chat.example/room');
    expect(external.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]?.[0]).toBe('https://chat.example/room');

    uninstall();
  });
});
