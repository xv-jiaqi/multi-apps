export function PageMeta({ title }: { title: string }) {
  // A single text child. Multiple children make React 19 hoist an empty
  // document title (the /me page rendered `{name} · Cardhub` that way).
  return <title>{`${title} · Cardhub`}</title>;
}
