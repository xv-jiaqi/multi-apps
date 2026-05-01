export interface MockSeriesSummary {
  slug: string;
  title: string;
  description: string;
  coverGradient: string;
  cardCount: number;
}

export interface MockCardSummary {
  slug: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  imageGradient: string;
}

export interface MockCardDetail extends MockCardSummary {
  description: string;
  attributes: Record<string, string | number>;
  seriesSlug: string;
  seriesTitle: string;
}

export interface MockSeriesDetail extends MockSeriesSummary {
  cards: MockCardSummary[];
}

const SERIES: MockSeriesDetail[] = [
  {
    slug: 'celestial-dawn',
    title: '天穹黎明',
    description: '故事开端的限定系列，收录构筑型套牌中最具代表性的元素卡，画风偏冷色调玻璃质感。',
    coverGradient: 'from-sky-400 via-indigo-400 to-purple-500',
    cardCount: 4,
    cards: [
      {
        slug: 'aurora-knight',
        name: '极光骑士',
        rarity: 'legendary',
        imageGradient: 'from-sky-200 via-indigo-300 to-violet-500',
      },
      {
        slug: 'glacier-sentinel',
        name: '冰川守望',
        rarity: 'epic',
        imageGradient: 'from-cyan-200 via-sky-300 to-blue-500',
      },
      {
        slug: 'moonlit-raven',
        name: '月华渡鸦',
        rarity: 'rare',
        imageGradient: 'from-slate-300 via-indigo-300 to-slate-700',
      },
      {
        slug: 'starlight-novice',
        name: '初拥星光者',
        rarity: 'common',
        imageGradient: 'from-amber-100 via-rose-200 to-indigo-300',
      },
    ],
  },
  {
    slug: 'verdant-rift',
    title: '翠裂之地',
    description: '森林与古代文明交织的中期系列，强调长尾节奏与生态共生主题，色调以暖绿与琥珀为主。',
    coverGradient: 'from-emerald-400 via-lime-400 to-amber-300',
    cardCount: 3,
    cards: [
      {
        slug: 'ancient-treant',
        name: '远古树灵',
        rarity: 'legendary',
        imageGradient: 'from-emerald-300 via-green-500 to-lime-600',
      },
      {
        slug: 'spore-warden',
        name: '孢子守卫',
        rarity: 'rare',
        imageGradient: 'from-lime-200 via-emerald-300 to-emerald-700',
      },
      {
        slug: 'amber-mystic',
        name: '琥珀神秘者',
        rarity: 'epic',
        imageGradient: 'from-amber-200 via-orange-300 to-amber-600',
      },
    ],
  },
  {
    slug: 'forge-of-titans',
    title: '泰坦熔炉',
    description: '机械与火焰的中后期系列，代表卡多为主动技能强势的高费随从，画风偏暖橘加粗体描边。',
    coverGradient: 'from-orange-500 via-red-500 to-rose-700',
    cardCount: 2,
    cards: [
      {
        slug: 'forge-titan',
        name: '熔炉泰坦',
        rarity: 'legendary',
        imageGradient: 'from-amber-400 via-orange-500 to-red-700',
      },
      {
        slug: 'lava-wraith',
        name: '熔岩鬼影',
        rarity: 'epic',
        imageGradient: 'from-rose-400 via-red-500 to-orange-600',
      },
    ],
  },
];

const CARD_DETAIL: Record<string, MockCardDetail> = {};
for (const series of SERIES) {
  for (const card of series.cards) {
    CARD_DETAIL[card.slug] = {
      ...card,
      seriesSlug: series.slug,
      seriesTitle: series.title,
      description: `${card.name} 是「${series.title}」系列的代表卡之一，本段为静态模拟数据，将在 Epic 2 接入真实数据库。`,
      attributes: {
        cost:
          card.rarity === 'legendary'
            ? 8
            : card.rarity === 'epic'
              ? 6
              : card.rarity === 'rare'
                ? 4
                : 2,
        attack:
          card.rarity === 'legendary'
            ? 9
            : card.rarity === 'epic'
              ? 6
              : card.rarity === 'rare'
                ? 4
                : 2,
        health:
          card.rarity === 'legendary'
            ? 9
            : card.rarity === 'epic'
              ? 7
              : card.rarity === 'rare'
                ? 5
                : 3,
        type: '随从',
      },
    };
  }
}

export function listMockSeries(): MockSeriesSummary[] {
  return SERIES.map(({ cards: _cards, ...summary }) => summary);
}

export function getMockSeries(slug: string): MockSeriesDetail | undefined {
  return SERIES.find((s) => s.slug === slug);
}

export function getMockCard(slug: string): MockCardDetail | undefined {
  return CARD_DETAIL[slug];
}

export function listAllMockCards(): MockCardDetail[] {
  return Object.values(CARD_DETAIL);
}
