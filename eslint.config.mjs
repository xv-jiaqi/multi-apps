import base from '@repo/config-eslint/base';

const dialogNames = [
  'Dialog',
  'DialogTrigger',
  'DialogPortal',
  'DialogOverlay',
  'DialogClose',
  'DialogContent',
  'DialogHeader',
  'DialogFooter',
  'DialogTitle',
  'DialogDescription',
  'AlertDialog',
  'AlertDialogTrigger',
  'AlertDialogPortal',
  'AlertDialogOverlay',
  'AlertDialogContent',
  'AlertDialogHeader',
  'AlertDialogFooter',
  'AlertDialogTitle',
  'AlertDialogDescription',
  'AlertDialogAction',
  'AlertDialogCancel',
];

export default [
  ...base,
  {
    ignores: [
      'apps/cardhub/e2e/.auth/**',
      'apps/cardhub/e2e/test-results/**',
      'apps/cardhub/e2e/playwright-report/**',
      'apps/cardhub/e2e/blob-report/**',
      // Classic browser scripts (no modules); theme-init is appendix §D verbatim.
      'apps/cardhub/web/public/theme-init.js',
      'apps/cardhub/web/public/config.js',
    ],
  },
  {
    // Nest 的依赖注入靠 emitDecoratorMetadata：构造函数参数的类型在运行时要用到，不能改成 import type。
    // 告诉 typescript-eslint 这一点，consistent-type-imports 就不会误报这些导入（PR3 待办 7）。
    files: ['apps/agent-hub/server/**/*.ts'],
    languageOptions: {
      parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
    },
  },
  {
    files: ['apps/agent-hub/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/agent-hub/web/src/components/hub-dialog.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@repo/ui-web',
              importNames: dialogNames,
              message: 'Dialog / AlertDialog 只能从 components/hub-dialog.tsx 导入。',
            },
          ],
        },
      ],
    },
  },
];
