const swc = ['@swc/jest', { jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2023' }, module: { type: 'commonjs' } }];

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testPathIgnorePatterns: ['/node_modules/', '/fixtures/', '/helpers/'],
  transform: { '^.+\\.(t|j)sx?$': swc },
  // ESM-only dependencies of @fastify/static
  transformIgnorePatterns: ['/node_modules/(?!(content-disposition)/)'],
  testTimeout: 30000,
};
