export function PageMeta({ title, description }: { title: string; description?: string }) {
  // A single text child. Multiple children make React 19 hoist an empty
  // document title (the /me page rendered `{name} · Cardhub` that way).
  const content = description?.trim();
  return (
    <>
      <title>{`${title} · Cardhub`}</title>
      {content ? <meta name="description" content={content} /> : null}
    </>
  );
}
