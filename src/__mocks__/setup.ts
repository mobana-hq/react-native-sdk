// Global fetch mock — each test overrides as needed
global.fetch = jest.fn(() =>
  Promise.reject(new Error('fetch not mocked for this test'))
);

// Silence console.warn / console.log from SDK debug output during tests
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
