/**
 * Slug-to-gradient mapping for Taro miniapp inline `style={{ background }}`.
 *
 * Mirror of `apps/cardhub/web/src/lib/gradients.ts` and
 * `packages/design-tokens/src/taro.scss`. Values are plain CSS
 * `linear-gradient(...)` strings because miniapp runtimes have no
 * Tailwind JIT — we cannot rely on class-name lookup the way web does.
 *
 * When adding a new series / card slug, update all three files so the
 * cover looks the same on every platform.
 */
const GRADIENTS: Record<string, string> = {
  'celestial-dawn': 'linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #a855f7 100%)',
  'verdant-rift': 'linear-gradient(135deg, #34d399 0%, #a3e635 50%, #fcd34d 100%)',
  'forge-of-titans': 'linear-gradient(135deg, #f97316 0%, #ef4444 50%, #be123c 100%)',
  'aurora-knight': 'linear-gradient(135deg, #bae6fd 0%, #a5b4fc 50%, #8b5cf6 100%)',
  'glacier-sentinel': 'linear-gradient(135deg, #a5f3fc 0%, #7dd3fc 50%, #3b82f6 100%)',
  'moonlit-raven': 'linear-gradient(135deg, #cbd5e1 0%, #a5b4fc 50%, #334155 100%)',
  'starlight-novice': 'linear-gradient(135deg, #fef3c7 0%, #fecdd3 50%, #a5b4fc 100%)',
  'ancient-treant': 'linear-gradient(135deg, #6ee7b7 0%, #22c55e 50%, #65a30d 100%)',
  'spore-warden': 'linear-gradient(135deg, #d9f99d 0%, #6ee7b7 50%, #047857 100%)',
  'amber-mystic': 'linear-gradient(135deg, #fde68a 0%, #fdba74 50%, #d97706 100%)',
  'forge-titan': 'linear-gradient(135deg, #fbbf24 0%, #f97316 50%, #b91c1c 100%)',
  'lava-wraith': 'linear-gradient(135deg, #fb7185 0%, #ef4444 50%, #ea580c 100%)',
};

const FALLBACK = 'linear-gradient(135deg, #e5e5e5 0%, #d4d4d4 50%, #a3a3a3 100%)';

export function gradientFor(slug: string | undefined | null): string {
  if (!slug) return FALLBACK;
  return GRADIENTS[slug] ?? FALLBACK;
}
