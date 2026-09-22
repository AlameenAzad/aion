/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  clearMocks: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/commands/**',
    // Thin passthrough wrappers over inquirer/ora/console — no branching logic
    // of their own to test, same rationale as excluding banner.ts.
    '!src/ui/**',
    // Pre-existing interactive setup wizard (predates this batch) — same class
    // of code as commands/setup.ts, just factored out; excluded for the same
    // reason commands/** is.
    '!src/utils/leaveSetup.ts',
  ],
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 90,
      functions: 90,
      lines: 90,
    },
  },
};
