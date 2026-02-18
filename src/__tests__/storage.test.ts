import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getInstallId,
  getCachedResult,
  setCachedResult,
  clearAttribution,
  queueConversion,
  getConversionQueue,
  clearConversionQueue,
  getCachedFlow,
  setCachedFlow,
  clearCachedFlow,
  clearAllCachedFlows,
  getAllLocalData,
  setLocalData,
  getLocalData,
  clearLocalData,
  generateUUID,
} from '../storage';
import type { ConversionEvent } from '../types';

const mockStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage> & {
  __resetStore: () => void;
  __getStore: () => Record<string, string>;
};

beforeEach(() => {
  mockStorage.__resetStore();
  jest.clearAllMocks();
});

// ─── generateUUID ──────────────────────────────────────────────────

describe('generateUUID', () => {
  it('produces valid UUID v4 format', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('generates unique values', () => {
    const uuids = new Set(Array.from({ length: 50 }, () => generateUUID()));
    expect(uuids.size).toBe(50);
  });
});

// ─── getInstallId ──────────────────────────────────────────────────

describe('getInstallId', () => {
  it('generates and stores a new UUID on first call', async () => {
    const id = await getInstallId();
    expect(id).toMatch(/^[0-9a-f]{8}-/);
    expect(mockStorage.setItem).toHaveBeenCalledWith('@mobana:install_id', id);
  });

  it('returns the stored ID on subsequent calls', async () => {
    await mockStorage.setItem('@mobana:install_id', 'existing-uuid');
    jest.clearAllMocks();

    const id = await getInstallId();
    expect(id).toBe('existing-uuid');
    expect(mockStorage.setItem).not.toHaveBeenCalled();
  });

  it('returns a UUID even if storage throws', async () => {
    mockStorage.getItem.mockRejectedValueOnce(new Error('storage broken'));
    const id = await getInstallId();
    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });
});

// ─── attribution cache ─────────────────────────────────────────────

describe('attribution cache', () => {
  it('round-trips a matched result', async () => {
    const attribution = { utm_source: 'fb', confidence: 0.9 };
    await setCachedResult(true, attribution);
    const cached = await getCachedResult();

    expect(cached).not.toBeNull();
    expect(cached!.matched).toBe(true);
    expect(cached!.attribution).toEqual(attribution);
    expect(cached!.checkedAt).toBeGreaterThan(0);
  });

  it('round-trips an unmatched result', async () => {
    await setCachedResult(false);
    const cached = await getCachedResult();

    expect(cached).not.toBeNull();
    expect(cached!.matched).toBe(false);
    expect(cached!.attribution).toBeUndefined();
  });

  it('returns null when nothing cached', async () => {
    const cached = await getCachedResult();
    expect(cached).toBeNull();
  });

  it('returns null if stored data is corrupt', async () => {
    await mockStorage.setItem('@mobana:attribution', '{bad json');
    const cached = await getCachedResult();
    expect(cached).toBeNull();
  });
});

// ─── clearAttribution ──────────────────────────────────────────────

describe('clearAttribution', () => {
  it('removes both attribution and install ID keys', async () => {
    await mockStorage.setItem('@mobana:install_id', 'id');
    await mockStorage.setItem('@mobana:attribution', '{}');
    await clearAttribution();

    expect(mockStorage.multiRemove).toHaveBeenCalledWith([
      '@mobana:attribution',
      '@mobana:install_id',
    ]);
    const store = mockStorage.__getStore();
    expect(store['@mobana:install_id']).toBeUndefined();
    expect(store['@mobana:attribution']).toBeUndefined();
  });
});

// ─── conversion queue ──────────────────────────────────────────────

describe('conversion queue', () => {
  const event1: ConversionEvent = {
    installId: 'inst_1',
    name: 'signup',
    timestamp: 1000,
  };
  const event2: ConversionEvent = {
    installId: 'inst_1',
    name: 'purchase',
    value: 9.99,
    timestamp: 2000,
  };

  it('starts with an empty queue', async () => {
    const queue = await getConversionQueue();
    expect(queue).toEqual([]);
  });

  it('queues events in order', async () => {
    await queueConversion(event1);
    await queueConversion(event2);
    const queue = await getConversionQueue();

    expect(queue).toHaveLength(2);
    expect(queue[0].name).toBe('signup');
    expect(queue[1].name).toBe('purchase');
  });

  it('clearConversionQueue empties the queue', async () => {
    await queueConversion(event1);
    await clearConversionQueue();
    const queue = await getConversionQueue();
    expect(queue).toEqual([]);
  });
});

// ─── flow cache ────────────────────────────────────────────────────

describe('flow cache', () => {
  const flowConfig = { versionId: 'v1', html: '<div>flow</div>', css: 'body{}' };

  it('returns null for uncached flow', async () => {
    const cached = await getCachedFlow('onboarding');
    expect(cached).toBeNull();
  });

  it('round-trips flow content', async () => {
    await setCachedFlow('onboarding', flowConfig);
    const cached = await getCachedFlow('onboarding');

    expect(cached).not.toBeNull();
    expect(cached!.versionId).toBe('v1');
    expect(cached!.html).toBe('<div>flow</div>');
    expect(cached!.cachedAt).toBeGreaterThan(0);
  });

  it('stores different flows by slug', async () => {
    await setCachedFlow('onboarding', flowConfig);
    await setCachedFlow('paywall', { versionId: 'v2', html: '<div>pay</div>' });

    const onb = await getCachedFlow('onboarding');
    const pay = await getCachedFlow('paywall');
    expect(onb!.versionId).toBe('v1');
    expect(pay!.versionId).toBe('v2');
  });

  it('clearCachedFlow removes a single flow', async () => {
    await setCachedFlow('onboarding', flowConfig);
    await setCachedFlow('paywall', { versionId: 'v2', html: '<div/>' });
    await clearCachedFlow('onboarding');

    expect(await getCachedFlow('onboarding')).toBeNull();
    expect(await getCachedFlow('paywall')).not.toBeNull();
  });

  it('clearAllCachedFlows removes all flows but not other keys', async () => {
    await mockStorage.setItem('@mobana:install_id', 'keep-me');
    await setCachedFlow('onboarding', flowConfig);
    await setCachedFlow('paywall', { versionId: 'v2', html: '<div/>' });
    await clearAllCachedFlows();

    expect(await getCachedFlow('onboarding')).toBeNull();
    expect(await getCachedFlow('paywall')).toBeNull();
    expect(await mockStorage.getItem('@mobana:install_id')).toBe('keep-me');
  });
});

// ─── local data ────────────────────────────────────────────────────

describe('local data', () => {
  it('starts empty', async () => {
    const data = await getAllLocalData();
    expect(data).toEqual({});
  });

  it('round-trips key-value pairs', async () => {
    await setLocalData('theme', 'dark');
    await setLocalData('onboardingDone', true);

    expect(await getLocalData('theme')).toBe('dark');
    expect(await getLocalData('onboardingDone')).toBe(true);
  });

  it('returns undefined for missing key', async () => {
    expect(await getLocalData('nope')).toBeUndefined();
  });

  it('clearLocalData removes all local data', async () => {
    await setLocalData('theme', 'dark');
    await clearLocalData();
    expect(await getAllLocalData()).toEqual({});
  });
});

// ─── error resilience ──────────────────────────────────────────────

describe('error resilience', () => {
  it('getCachedResult returns null on storage error', async () => {
    mockStorage.getItem.mockRejectedValueOnce(new Error('fail'));
    expect(await getCachedResult()).toBeNull();
  });

  it('setCachedResult swallows storage errors', async () => {
    mockStorage.setItem.mockRejectedValueOnce(new Error('fail'));
    await expect(setCachedResult(true, { confidence: 1 })).resolves.toBeUndefined();
  });

  it('queueConversion swallows storage errors', async () => {
    mockStorage.getItem.mockRejectedValueOnce(new Error('fail'));
    await expect(
      queueConversion({ installId: 'x', name: 'y', timestamp: 0 })
    ).resolves.toBeUndefined();
  });

  it('getConversionQueue returns empty array on error', async () => {
    mockStorage.getItem.mockRejectedValueOnce(new Error('fail'));
    expect(await getConversionQueue()).toEqual([]);
  });

  it('getAllLocalData returns empty object on error', async () => {
    mockStorage.getItem.mockRejectedValueOnce(new Error('fail'));
    expect(await getAllLocalData()).toEqual({});
  });
});
