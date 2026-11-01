import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

type Tx = Prisma.TransactionClient;

type ParallelCode =
  | 'parallel_cross_series'
  | 'parallel_chain'
  | 'parallel_self'
  | 'parallel_has_children'
  | 'parallel_base_missing'
  | 'parallel_name_required';

export type ParallelWrite = {
  /** Undefined leaves the stored link. Null clears it. */
  parallelOfId: string | null | undefined;
  /** Undefined leaves the stored name. Null clears it. */
  parallelName: string | null | undefined;
  /** Undefined leaves the stored total. Null clears it. */
  printRun: number | null | undefined;
  /** Other cards whose public detail must be dropped from the catalog cache. */
  invalidateSlugs: string[];
};

type ExistingCard = {
  id: string;
  seriesId: string;
  parallelOfId: string | null;
  parallelName: string | null;
  parallelOf: { slug: string } | null;
  parallels: { slug: string }[];
};

/**
 * Field codes from CH-213 §8. The zod issue message is the code. The HTTP
 * message stays the generic validation sentence.
 * One failure wins, in this order: self, missing base, chain, cross-series,
 * existing parallels, missing name.
 */
function parallelFieldError(
  field: 'parallelOfSlug' | 'parallelName',
  code: ParallelCode,
): TRPCError {
  const parsed = z
    .object({
      parallelOfSlug: z.string(),
      parallelName: z.string(),
    })
    .superRefine((_value, ctx) => {
      ctx.addIssue({ code: 'custom', message: code, path: [field] });
    })
    .safeParse({ parallelOfSlug: 'base', parallelName: 'name' });
  if (parsed.success) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '平行版本校验没有生成字段错误' });
  }
  return new TRPCError({ code: 'BAD_REQUEST', cause: parsed.error });
}

async function lockCards(tx: Tx, ids: readonly string[]): Promise<void> {
  const unique = [...new Set(ids)].filter((id) => id.length > 0).sort();
  if (unique.length === 0) return;
  await tx.$queryRaw`SELECT "id" FROM "cards" WHERE "id" IN (${Prisma.join(unique)}) FOR UPDATE`;
}

function emptyToNull(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null;
  return value;
}

function requiredName(provided: string | undefined, existing: string | null): string {
  const name = provided !== undefined ? provided : (existing ?? '');
  if (name.length === 0) {
    throw parallelFieldError('parallelName', 'parallel_name_required');
  }
  return name;
}

async function loadBase(
  tx: Tx,
  args: { cardId: string | null; cardSlug: string; seriesId: string; parallelOfSlug: string },
): Promise<{ id: string; slug: string }> {
  const located = await tx.card.findUnique({
    where: { slug: args.parallelOfSlug },
    select: { id: true },
  });
  if (!located) throw parallelFieldError('parallelOfSlug', 'parallel_base_missing');

  await lockCards(tx, args.cardId ? [args.cardId, located.id] : [located.id]);

  const base = await tx.card.findUnique({
    where: { id: located.id },
    select: { id: true, slug: true, seriesId: true, parallelOfId: true },
  });
  if (!base) throw parallelFieldError('parallelOfSlug', 'parallel_base_missing');
  if (base.id === args.cardId || base.slug === args.cardSlug) {
    throw parallelFieldError('parallelOfSlug', 'parallel_self');
  }
  if (base.parallelOfId !== null) throw parallelFieldError('parallelOfSlug', 'parallel_chain');
  if (base.seriesId !== args.seriesId) {
    throw parallelFieldError('parallelOfSlug', 'parallel_cross_series');
  }
  if (args.cardId) {
    const children = await tx.card.count({ where: { parallelOfId: args.cardId } });
    if (children > 0) throw parallelFieldError('parallelOfSlug', 'parallel_has_children');
  }
  return { id: base.id, slug: base.slug };
}

function relatedSlugs(existing: ExistingCard | null): string[] {
  if (!existing) return [];
  const slugs = existing.parallels.map((row) => row.slug);
  if (existing.parallelOf) slugs.push(existing.parallelOf.slug);
  return slugs;
}

/**
 * Decide the parallel columns for one admin create or update.
 * Omitted inputs leave stored values in place. An empty parallelOfSlug clears
 * the link and keeps parallelName unless a new name was sent.
 * Moving the card to another series without a new base clears the link.
 * The series-change trigger clears children; this returns their slugs so the
 * cache can drop them.
 */
export async function resolveParallelWrite(
  tx: Tx,
  args: {
    mode: 'create' | 'update';
    cardSlug: string;
    seriesId: string;
    parallelOfSlug: string | undefined;
    parallelName: string | undefined;
    printRun: number | null | undefined;
  },
): Promise<ParallelWrite> {
  const requested = args.parallelOfSlug;
  if (requested !== undefined && requested.length > 0 && requested === args.cardSlug) {
    throw parallelFieldError('parallelOfSlug', 'parallel_self');
  }

  const existing: ExistingCard | null =
    args.mode === 'update'
      ? await tx.card.findUnique({
          where: { slug: args.cardSlug },
          select: {
            id: true,
            seriesId: true,
            parallelOfId: true,
            parallelName: true,
            parallelOf: { select: { slug: true } },
            parallels: { select: { slug: true } },
          },
        })
      : null;
  if (args.mode === 'update' && !existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '卡牌不存在' });
  }

  const seriesChanged = existing !== null && existing.seriesId !== args.seriesId;
  const attaching = requested !== undefined && requested.length > 0;
  const clearing = requested === '' || (requested === undefined && seriesChanged);
  const invalidate = new Set<string>(relatedSlugs(existing));

  if (attaching && requested !== undefined) {
    const base = await loadBase(tx, {
      cardId: existing?.id ?? null,
      cardSlug: args.cardSlug,
      seriesId: args.seriesId,
      parallelOfSlug: requested,
    });
    invalidate.add(base.slug);
    return {
      parallelOfId: base.id,
      parallelName: requiredName(args.parallelName, existing?.parallelName ?? null),
      printRun: args.mode === 'create' ? (args.printRun ?? null) : args.printRun,
      invalidateSlugs: [...invalidate],
    };
  }

  if (args.mode === 'create') {
    return {
      parallelOfId: null,
      parallelName: emptyToNull(args.parallelName),
      printRun: args.printRun ?? null,
      invalidateSlugs: [],
    };
  }

  if (clearing) {
    return {
      parallelOfId: null,
      parallelName: args.parallelName === undefined ? undefined : emptyToNull(args.parallelName),
      printRun: args.printRun,
      invalidateSlugs: [...invalidate],
    };
  }

  let parallelName: string | null | undefined;
  if (args.parallelName === undefined) {
    parallelName = undefined;
  } else if (args.parallelName.length === 0 && existing?.parallelOfId) {
    throw parallelFieldError('parallelName', 'parallel_name_required');
  } else {
    parallelName = emptyToNull(args.parallelName);
  }
  return {
    parallelOfId: undefined,
    parallelName,
    printRun: args.printRun,
    invalidateSlugs: [...invalidate],
  };
}
