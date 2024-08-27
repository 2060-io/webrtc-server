module.exports = {
  // Location of test files.
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],

  // Modules that need to be transformed to be compatible with Jest (by default, JavaScript).
  transform: {
    '^.+\\.js$': 'babel-jest',
  },

  // Directories that should be ignored when searching for test files.
  testPathIgnorePatterns: ['/node_modules/'],

  // Test set to ignore.
  testIgnorePatterns: ['/ignore-test.js'],

  // Test file extension (by default, .js).
  testFileExtensions: ['js'],

  // Test reporter to use (you can customize it).
  reporters: ['default'],

  // Timeout settings (increase or decrease as needed).
  testTimeout: 60000,

  // Configuration for displaying detailed test results.
  verbose: true,

  // Modules that need to be transpiled (for example, if you're using ES6+).
  transformIgnorePatterns: ['/node_modules/(?!my-module)'],
}
