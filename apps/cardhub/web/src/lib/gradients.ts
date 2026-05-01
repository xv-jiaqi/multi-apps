/**
 * Slug-to-Tailwind-gradient mapping.
 *
 * The DB stores `coverUrl` / `imageUrl` as `gradient:from-…-via-…-to-…` tokens
 * which are convenient for the API but useless to Tailwind v4 JIT — the JIT
 * compiler only knows about classes it can see at build time, not strings we
 * concatenate at runtime. Keeping the mapping here means Tailwind sees every
 * literal class and emits the right CSS.
 *
 * If a new series / card slug needs a custom gradient, add it below.
 */
const GRADIENTS: Record<string, string> = {
  'celestial-dawn': 'from-sky-400 via-indigo-400 to-purple-500',
  'verdant-rift': 'from-emerald-400 via-lime-400 to-amber-300',
  'forge-of-titans': 'from-orange-500 via-red-500 to-rose-700',
  'aurora-knight': 'from-sky-200 via-indigo-300 to-violet-500',
  'glacier-sentinel': 'from-cyan-200 via-sky-300 to-blue-500',
  'moonlit-raven': 'from-slate-300 via-indigo-300 to-slate-700',
  'starlight-novice': 'from-amber-100 via-rose-200 to-indigo-300',
  'ancient-treant': 'from-emerald-300 via-green-500 to-lime-600',
  'spore-warden': 'from-lime-200 via-emerald-300 to-emerald-700',
  'amber-mystic': 'from-amber-200 via-orange-300 to-amber-600',
  'forge-titan': 'from-amber-400 via-orange-500 to-red-700',
  'lava-wraith': 'from-rose-400 via-red-500 to-orange-600',
};

const FALLBACK = 'from-neutral-200 via-neutral-300 to-neutral-400';

export function gradientFor(slug: string | undefined | null): string {
  if (!slug) return FALLBACK;
  return GRADIENTS[slug] ?? FALLBACK;
}
