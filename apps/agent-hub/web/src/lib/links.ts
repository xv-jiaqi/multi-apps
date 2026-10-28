/**
 * 捕获阶段拦截链接。
 * http/https 且不是当前文档的 hash 路由时交给 open；
 * javascript: 和其他协议直接拦住，不打开。
 * 同一文档的 hash 链接留给 createHashRouter。
 */
export function installLinkGuard(
  doc: Document,
  open: (url: string) => Promise<void>,
  onError: (error: unknown) => void,
): () => void {
  const onClick = (event: Event): void => {
    if (!(event instanceof MouseEvent)) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    if (event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.target === '_blank') return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href, doc.baseURI);
    } catch {
      event.preventDefault();
      return;
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (isHashRoute(url, doc)) return;
      event.preventDefault();
      void open(url.href).catch(onError);
      return;
    }
    event.preventDefault();
  };
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}

function isHashRoute(url: URL, doc: Document): boolean {
  const page = new URL(doc.baseURI);
  return url.origin === page.origin && url.pathname === page.pathname && url.search === page.search;
}
