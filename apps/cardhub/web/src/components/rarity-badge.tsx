type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

const RARITY_STYLE: Record<
  Rarity,
  { bg: string; text: string; label: { 'zh-CN': string; 'en-US': string } }
> = {
  common: {
    bg: 'bg-neutral-100',
    text: 'text-neutral-600',
    label: { 'zh-CN': '普通', 'en-US': 'Common' },
  },
  rare: {
    bg: 'bg-sky-100',
    text: 'text-sky-700',
    label: { 'zh-CN': '稀有', 'en-US': 'Rare' },
  },
  epic: {
    bg: 'bg-violet-100',
    text: 'text-violet-700',
    label: { 'zh-CN': '史诗', 'en-US': 'Epic' },
  },
  legendary: {
    bg: 'bg-gradient-to-r from-amber-200 to-orange-300',
    text: 'text-amber-800',
    label: { 'zh-CN': '传说', 'en-US': 'Legendary' },
  },
};

export function RarityBadge({ rarity, locale }: { rarity: Rarity; locale: 'zh-CN' | 'en-US' }) {
  const style = RARITY_STYLE[rarity];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label[locale]}
    </span>
  );
}
