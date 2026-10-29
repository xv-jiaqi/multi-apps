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
    ],
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
