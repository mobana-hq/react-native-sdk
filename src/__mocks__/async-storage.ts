let store: Record<string, string> = {};

const AsyncStorage = {
  getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    store[key] = value;
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    delete store[key];
    return Promise.resolve();
  }),
  multiRemove: jest.fn((keys: string[]) => {
    for (const key of keys) {
      delete store[key];
    }
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => Promise.resolve(Object.keys(store))),
  clear: jest.fn(() => {
    store = {};
    return Promise.resolve();
  }),

  /** Test helper: reset the in-memory store between tests */
  __resetStore: () => {
    store = {};
  },
  /** Test helper: peek at current store */
  __getStore: () => ({ ...store }),
};

export default AsyncStorage;
