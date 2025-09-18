module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/src/**/*.test.ts', '**/src/**/*.spec.ts'],
  transform: {
    '^.+\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFilesAfterEnv: [],
  testTimeout: 10000,
  globals: {
    'ts-jest': {
      tsconfig: {
        types: ['jest', 'node']
      }
    }
  }
};