import type { Prisma } from '@prisma/client';

export interface SeedCard {
  slug: string;
  name: string;
  description: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  imageUrl: string;
  attributes: Prisma.InputJsonValue;
}

export interface SeedSeries {
  slug: string;
  title: string;
  description: string;
  coverUrl: string;
  cards: SeedCard[];
}

export const CATALOG_SERIES: SeedSeries[] = [
  {
    slug: 'celestial-dawn',
    title: '天穹黎明',
    description: '故事开端的限定系列，收录构筑型套牌中最具代表性的元素卡，画风偏冷色调玻璃质感。',
    coverUrl: 'gradient:from-sky-400-via-indigo-400-to-purple-500',
    cards: [
      {
        slug: 'aurora-knight',
        name: '极光骑士',
        description: '身披极光鳞甲的天穹守护者，每次行动都伴随冷蓝色辉光。',
        rarity: 'legendary',
        imageUrl: 'gradient:from-sky-200-via-indigo-300-to-violet-500',
        attributes: { cost: 8, attack: 9, health: 9, type: '随从' },
      },
      {
        slug: 'glacier-sentinel',
        name: '冰川守望',
        description: '永冻冰川深处沉睡千年的哨兵，缓慢但坚不可摧。',
        rarity: 'epic',
        imageUrl: 'gradient:from-cyan-200-via-sky-300-to-blue-500',
        attributes: { cost: 6, attack: 6, health: 7, type: '随从' },
      },
      {
        slug: 'moonlit-raven',
        name: '月华渡鸦',
        description: '在月光下穿梭的暗影信使，能短暂窥探敌人的牌库顶。',
        rarity: 'rare',
        imageUrl: 'gradient:from-slate-300-via-indigo-300-to-slate-700',
        attributes: { cost: 4, attack: 4, health: 5, type: '随从' },
      },
      {
        slug: 'starlight-novice',
        name: '初拥星光者',
        description: '刚刚学会汲取星光的年轻法师，潜力无限。',
        rarity: 'common',
        imageUrl: 'gradient:from-amber-100-via-rose-200-to-indigo-300',
        attributes: { cost: 2, attack: 2, health: 3, type: '随从' },
      },
    ],
  },
  {
    slug: 'verdant-rift',
    title: '翠裂之地',
    description: '森林与古代文明交织的中期系列，强调长尾节奏与生态共生主题，色调以暖绿与琥珀为主。',
    coverUrl: 'gradient:from-emerald-400-via-lime-400-to-amber-300',
    cards: [
      {
        slug: 'ancient-treant',
        name: '远古树灵',
        description: '森林意志的化身，根须可在战场上蔓延扎根。',
        rarity: 'legendary',
        imageUrl: 'gradient:from-emerald-300-via-green-500-to-lime-600',
        attributes: { cost: 8, attack: 9, health: 9, type: '随从' },
      },
      {
        slug: 'spore-warden',
        name: '孢子守卫',
        description: '游走于林间的孢子卫士，死亡时释放治疗孢子。',
        rarity: 'rare',
        imageUrl: 'gradient:from-lime-200-via-emerald-300-to-emerald-700',
        attributes: { cost: 4, attack: 4, health: 5, type: '随从' },
      },
      {
        slug: 'amber-mystic',
        name: '琥珀神秘者',
        description: '能够唤醒被琥珀封存的远古秘术。',
        rarity: 'epic',
        imageUrl: 'gradient:from-amber-200-via-orange-300-to-amber-600',
        attributes: { cost: 6, attack: 6, health: 7, type: '随从' },
      },
    ],
  },
  {
    slug: 'forge-of-titans',
    title: '泰坦熔炉',
    description: '机械与火焰的中后期系列，代表卡多为主动技能强势的高费随从，画风偏暖橘加粗体描边。',
    coverUrl: 'gradient:from-orange-500-via-red-500-to-rose-700',
    cards: [
      {
        slug: 'forge-titan',
        name: '熔炉泰坦',
        description: '从地核熔炉之中诞生的钢铁巨兽，每回合自我重铸。',
        rarity: 'legendary',
        imageUrl: 'gradient:from-amber-400-via-orange-500-to-red-700',
        attributes: { cost: 8, attack: 9, health: 9, type: '随从' },
      },
      {
        slug: 'lava-wraith',
        name: '熔岩鬼影',
        description: '熔岩中游荡的余烬生灵，能穿透敌方阵线。',
        rarity: 'epic',
        imageUrl: 'gradient:from-rose-400-via-red-500-to-orange-600',
        attributes: { cost: 6, attack: 6, health: 7, type: '随从' },
      },
    ],
  },
];

export interface SeedUser {
  email: string;
  username: string;
  rawPassword: string;
  role: 'user' | 'admin';
}

// Demo credentials for staging/local only. Never seed these in production.
export const DEMO_USERS: SeedUser[] = [
  {
    email: 'alice@cardhub.test',
    username: 'alice',
    rawPassword: 'password123',
    role: 'user',
  },
  {
    email: 'admin@cardhub.test',
    username: 'admin',
    rawPassword: 'admin123!',
    role: 'admin',
  },
];
