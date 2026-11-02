import { describe, expect, it } from 'vitest';
import './configure-zod';
import { fieldErrorMessage } from './i18n';
import { printRunLabel } from './print-run';
import {
  PARALLEL_NAME_MAX,
  PRINT_RUN_MAX,
  PRINT_RUN_MIN,
  adminCardUpsertInput,
  cardsListBySeriesInput,
} from './zod';

const card = {
  slug: 'base-card',
  name: '基础卡',
  rarity: 'common',
  seriesSlug: 'dawn-set',
};

describe('printRunLabel', () => {
  it('formats a total without grouping separators and an empty run as unnumbered', () => {
    expect(printRunLabel('zh-CN', 99)).toBe('限量 /99');
    expect(printRunLabel('en-US', 99)).toBe('Limited /99');
    expect(printRunLabel('zh-CN', 1000)).toBe('限量 /1000');
    expect(printRunLabel('en-US', 1000)).toBe('Limited /1000');
    expect(printRunLabel('zh-CN', 1000)).not.toContain(',');
    expect(printRunLabel('zh-CN', null)).toBe('不编号');
    expect(printRunLabel('en-US', null)).toBe('Unnumbered');
  });
});

describe('parallel admin input', () => {
  it('accepts an omitted parallel, an empty link, and a positive print run', () => {
    const omitted = adminCardUpsertInput.parse(card);
    expect(omitted.parallelName).toBeUndefined();
    expect(omitted.parallelOfSlug).toBeUndefined();
    expect(omitted.printRun).toBeUndefined();
    expect(
      adminCardUpsertInput.parse({
        ...card,
        parallelOfSlug: '',
        parallelName: '  金箔  ',
        printRun: null,
      }),
    ).toMatchObject({
      parallelOfSlug: '',
      parallelName: '金箔',
      printRun: null,
    });
    expect(
      adminCardUpsertInput.parse({ ...card, parallelOfSlug: 'base-card', printRun: PRINT_RUN_MIN })
        .printRun,
    ).toBe(1);
    expect(adminCardUpsertInput.parse({ ...card, printRun: PRINT_RUN_MAX }).printRun).toBe(
      PRINT_RUN_MAX,
    );
  });

  it('uses the shared field codes for length and print-run shape', () => {
    const cases: Array<{ input: Record<string, unknown>; path: string; message: string }> = [
      {
        input: { ...card, parallelName: '卡'.repeat(PARALLEL_NAME_MAX + 1) },
        path: 'parallelName',
        message: 'too_big',
      },
      { input: { ...card, printRun: 0 }, path: 'printRun', message: 'print_run_min' },
      { input: { ...card, printRun: -1 }, path: 'printRun', message: 'print_run_min' },
      { input: { ...card, printRun: 1.5 }, path: 'printRun', message: 'invalid_type' },
      { input: { ...card, printRun: '99' }, path: 'printRun', message: 'invalid_type' },
      {
        input: { ...card, printRun: PRINT_RUN_MAX + 1 },
        path: 'printRun',
        message: 'too_big',
      },
      {
        input: { ...card, parallelOfSlug: 'Not A Slug' },
        path: 'parallelOfSlug',
        message: 'slug_format',
      },
    ];
    for (const sample of cases) {
      const parsed = adminCardUpsertInput.safeParse(sample.input);
      expect(parsed.success).toBe(false);
      if (parsed.success) continue;
      const issue = parsed.error.issues.find((item) => item.path[0] === sample.path);
      expect(issue?.message).toBe(sample.message);
    }
    expect(fieldErrorMessage('zh-CN', 'parallel_name_required')).toBe('请填写平行名称');
    expect(fieldErrorMessage('en-US', 'parallel_name_required')).toBe('Enter a parallel name.');
    expect(fieldErrorMessage('zh-CN', 'parallel_cross_series')).toBe('基础卡必须属于同一系列');
    expect(fieldErrorMessage('en-US', 'parallel_cross_series')).toBe(
      'Pick a base card from the same series.',
    );
    expect(fieldErrorMessage('zh-CN', 'too_big')).toBe('内容超出长度限制');
    expect(fieldErrorMessage('zh-CN', 'too_small')).toBe('内容长度不够');
    expect(fieldErrorMessage('zh-CN', 'invalid_type')).toBe('填写的类型不正确');
  });

  it('rejects a string for includeParallels and defaults the flag to false', () => {
    const parsed = cardsListBySeriesInput.safeParse({
      seriesSlug: 'dawn-set',
      includeParallels: 'true',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe('invalid_type');
    expect(cardsListBySeriesInput.parse({ seriesSlug: 'dawn-set' }).includeParallels).toBe(false);
  });
});
