/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        diagnostics: false,
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/', '/packages/.*/dist/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts', '!src/**/index.ts'],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
  // Pragmatic floors: mid-60 globally so the bar grows with coverage, but
  // hot paths (auth and tRPC routers) must stay above 80 to catch regressions.
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 50,
      functions: 60,
      lines: 60,
    },
    './src/modules/auth/**/*.ts': {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },
  },
  testTimeout: 15000,
  // Jest otherwise uses one worker per core (minus one). This suite runs
  // beside the web vitest workers on a 4-core CI runner.
  maxWorkers: 2,
};
