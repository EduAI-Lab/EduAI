/** Jest config for ESM (package "type": "module"). Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js */
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/test/**/*.test.js'],
  testPathIgnorePatterns: ['\\.integration\\.test\\.js$'],
  setupFiles: ['<rootDir>/test/setup.js'],
};
