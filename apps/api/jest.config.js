/**
 * Jest Configuration
 * Para testes de performance do sistema de ratings
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Roots
  roots: ['<rootDir>/test', '<rootDir>/src'],

  // Test patterns
  testMatch: [
    '**/test/**/*.spec.ts',
    '**/__tests__/**/*.ts',
  ],

  // Module extensions
  moduleFileExtensions: ['ts', 'js', 'json'],

  // Coverage
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],

  // Timeout
  testTimeout: 120000, // 2 minutos para testes de performance

  // Verbose output
  verbose: true,

  // Reporting
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: './test-results',
      outputName: 'junit.xml',
    }],
    ['jest-html-reporters', {
      publicPath: './test-results',
      filename: 'report.html',
      expand: true,
      openReport: false,
    }],
  ],

  // Setup
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
};
