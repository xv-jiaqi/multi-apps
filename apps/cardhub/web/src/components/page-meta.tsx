export function PageMeta({
  title,
  description,
  noindex = false,
}: {
  title: string;
  description?: string;
  noindex?: boolean;
}) {
  // A single text child. Multiple children make React 19 hoist an empty
  // document title (the /me page rendered `{name} · Cardhub` that way).
  const content = description?.trim();
  return (
    <>
      <title>{`${title} · Cardhub`}</title>
      {content ? <meta name="description" content={content} /> : null}
      {noindex ? <meta name="robots" content="noindex" /> : null}
    </>
  );
}
