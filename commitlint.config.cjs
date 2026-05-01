/** @type {import("@commitlint/types").UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'root',
        'web',
        'native',
        'miniapp',
        'api',
        'ui-web',
        'ui-mini',
        'shared',
        'stores',
        'trpc-contract',
        'design-tokens',
        'config',
        'docker',
        'ci',
        'docs',
        'deps',
      ],
    ],
  },
};
