import { observer } from 'mobx-react-lite';
import { Info } from 'lucide-react';
import { t, type CardSearchParseErrorReason } from '@repo/shared';
import { useStores } from '../stores/root-store';

function valueAfterColon(token: string): string {
  const colon = token.indexOf(':');
  return colon >= 0 ? token.slice(colon + 1) : token;
}

export const SEARCH_SYNTAX_EXAMPLES = [
  'r:legendary',
  's:celestial-dawn',
  '极光 OR 冰川',
  '守 -冰川',
] as const;

export const SyntaxExamples = observer(function SyntaxExamples({
  id,
  compact = false,
  onExample,
}: {
  id?: string;
  compact?: boolean;
  onExample: (example: string) => void;
}) {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  return (
    <div id={id} className="space-y-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-600">
        <span>{tt('search.syntaxLabel')}</span>
        {SEARCH_SYNTAX_EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            aria-label={tt('search.trySyntax', { example })}
            onMouseDown={(event) => {
              if (compact) event.preventDefault();
            }}
            onClick={() => onExample(example)}
            className="rounded-sm bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-800 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {example}
          </button>
        ))}
      </p>
      <p className="text-xs text-neutral-600">{tt('search.syntaxHelp')}</p>
    </div>
  );
});

export const UnsupportedHint = observer(function UnsupportedHint({
  id,
  error,
}: {
  id?: string;
  error: { reason: CardSearchParseErrorReason; token: string };
}) {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const message =
    error.reason === 'unknownPrefix'
      ? tt('search.unsupportedPrefix', { token: error.token })
      : tt('search.invalidRarity', { value: valueAfterColon(error.token) });

  return (
    <p id={id} role="status" className="flex items-start gap-1.5 text-xs text-neutral-700">
      <Info className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
      <span>{message}</span>
    </p>
  );
});
