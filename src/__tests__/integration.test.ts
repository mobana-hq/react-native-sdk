/**
 * Integration tests — real modules wired together.
 * Only the true boundaries are mocked: fetch, AsyncStorage, NativeMobana, MobanaProvider context.
 */

jest.mock('../NativeMobana', () => ({
  getInstallReferrer: jest.fn().mockResolvedValue(null),
}));

jest.mock('../components/MobanaProvider', () => ({
  getGlobalFlowContext: jest.fn().mockReturnValue(null),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MobanaSDK } from '../Mobana';
import { getGlobalFlowContext } from '../components/MobanaProvider';
import { getInstallReferrer } from '../NativeMobana';

const mockFetch = global.fetch as jest.Mock;
const mockStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage> & {
  __resetStore: () => void;
};
const mockGetGlobalFlowContext = getGlobalFlowContext as jest.Mock;
const mockGetInstallReferrer = getInstallReferrer as jest.Mock;

let sdk: InstanceType<typeof MobanaSDK>;

// Use autoAttribute: false in most integration tests so auto-attribution doesn't
// consume fetch mocks intended for other operations. Auto-attribution behavior
// is tested explicitly in its own describe block below.
const SDK_CONFIG = { appId: 'abc123', appKey: 'a'.repeat(32), autoAttribute: false as const };

beforeEach(() => {
  mockStorage.__resetStore();
  mockFetch.mockReset();
  jest.clearAllMocks();
  mockGetGlobalFlowContext.mockReturnValue(null);
  mockGetInstallReferrer.mockResolvedValue(null);
  sdk = new MobanaSDK();
});

// ─── Full attribution flow ──────────────────────────────────────────

describe('attribution flow (end-to-end)', () => {
  it('init → getAttribution → result cached → second call uses cache', async () => {
    // Server returns a match
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          matched: true,
          attribution: { utm_source: 'google', utm_campaign: 'summer' },
          confidence: 0.75,
        }),
    });

    await sdk.init(SDK_CONFIG);
    const first = await sdk.getAttribution();

    expect(first.status).toBe('matched');
    expect(first.attribution).toEqual({
      utm_source: 'google',
      utm_campaign: 'summer',
      confidence: 0.75,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call — should come from in-memory cache, no fetch
    const second = await sdk.getAttribution();
    expect(second.status).toBe('matched');
    expect(second.attribution).toEqual(first.attribution);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('attribution persists to AsyncStorage and survives SDK re-creation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          matched: true,
          attribution: { utm_source: 'fb' },
          confidence: 0.8,
        }),
    });

    await sdk.init(SDK_CONFIG);
    await sdk.getAttribution();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Create a new SDK instance (simulates app restart)
    const sdk2 = new MobanaSDK();
    await sdk2.init(SDK_CONFIG);
    const result = await sdk2.getAttribution();

    // Should have loaded from AsyncStorage, no new fetch
    expect(result.status).toBe('matched');
    expect(result.attribution).toEqual({ utm_source: 'fb', confidence: 0.8 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('unmatched result is cached too — no retry on next startup', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ matched: false }),
    });

    await sdk.init(SDK_CONFIG);
    const first = await sdk.getAttribution();
    expect(first.status).toBe('no_match');

    // New SDK instance (app restart)
    const sdk2 = new MobanaSDK();
    await sdk2.init(SDK_CONFIG);
    const second = await sdk2.getAttribution();

    expect(second.status).toBe('no_match');
    // Only one fetch ever made
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('network failure returns error and allows in-session retry', async () => {
    // First attempt — network fails
    mockFetch.mockRejectedValueOnce(new Error('offline'));

    await sdk.init(SDK_CONFIG);
    const first = await sdk.getAttribution();
    expect(first.status).toBe('error');
    expect(first.error?.type).toBe('network');

    // Retry in the same session — should succeed
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          matched: true,
          attribution: { utm_source: 'tiktok' },
          confidence: 0.6,
        }),
    });
    const second = await sdk.getAttribution();
    expect(second.status).toBe('matched');
    expect(second.attribution?.utm_source).toBe('tiktok');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('network failure allows retry on next startup (new SDK instance)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));

    await sdk.init(SDK_CONFIG);
    await sdk.getAttribution();

    const sdk2 = new MobanaSDK();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          matched: true,
          attribution: { utm_source: 'tiktok' },
          confidence: 0.6,
        }),
    });
    await sdk2.init(SDK_CONFIG);
    const second = await sdk2.getAttribution();

    expect(second.status).toBe('matched');
    expect(second.attribution?.utm_source).toBe('tiktok');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ─── Attribution → Conversion flow ──────────────────────────────────

describe('attribution + conversion flow', () => {
  it('trackConversion triggers getAttribution then sends conversion', async () => {
    // getAttribution fetch (shared by auto-attribution + trackConversion's internal call)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ matched: false }),
    });
    // trackConversion fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    await sdk.init(SDK_CONFIG);
    await sdk.trackConversion('signup', 0);

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call was /find
    expect(mockFetch.mock.calls[0][0]).toContain('/find');
    // Second call was /conversion
    expect(mockFetch.mock.calls[1][0]).toContain('/conversion');

    const conversionBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(conversionBody.name).toBe('signup');
    expect(conversionBody.value).toBe(0);
  });

  it('conversion is queued when offline, flushed on next init', async () => {
    // getAttribution succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ matched: false }),
    });
    // conversion fails (offline)
    mockFetch.mockRejectedValueOnce(new Error('offline'));

    await sdk.init(SDK_CONFIG);
    await sdk.trackConversion('purchase', 29.99);

    // Verify it was queued in AsyncStorage
    const queueRaw = await AsyncStorage.getItem('@mobana:conversion_queue');
    expect(queueRaw).not.toBeNull();
    const queue = JSON.parse(queueRaw!);
    expect(queue).toHaveLength(1);
    expect(queue[0].name).toBe('purchase');
    expect(queue[0].value).toBe(29.99);

    // New SDK instance — conversion send succeeds this time
    // getAttribution comes from cache (no fetch), then queue flush sends conversion
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    const sdk2 = new MobanaSDK();
    await sdk2.init(SDK_CONFIG);

    // Queue should be cleared now
    const queueAfter = await AsyncStorage.getItem('@mobana:conversion_queue');
    expect(queueAfter).toBeNull();
  });
});

// ─── Prefetch → startFlow flow ──────────────────────────────────────

describe('prefetch + startFlow flow', () => {
  it('prefetchFlow caches, startFlow uses cache with server validation', async () => {
    const presentFlow = jest.fn((req) => {
      req.resolve({ completed: true, dismissed: false });
    });
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow });

    await sdk.init(SDK_CONFIG);

    // prefetchFlow calls fetchFlow (GET) — server returns flow content
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          versionId: 'v5',
          html: '<div>onboarding</div>',
          css: '.step { color: blue }',
        }),
    });

    await sdk.prefetchFlow('onboarding');

    // Verify flow was cached in AsyncStorage
    const cachedRaw = await AsyncStorage.getItem('@mobana:flow:onboarding');
    expect(cachedRaw).not.toBeNull();
    const cached = JSON.parse(cachedRaw!);
    expect(cached.versionId).toBe('v5');

    // startFlow triggers: getAttribution (POST /find), then fetchFlow (GET /flows)
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ matched: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ cached: true, versionId: 'v5' }),
      });

    const result = await sdk.startFlow('onboarding');

    expect(result.completed).toBe(true);
    expect(presentFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          versionId: 'v5',
          html: '<div>onboarding</div>',
        }),
      })
    );
  });

  it('startFlow fetches fresh when prefetch was not done', async () => {
    const presentFlow = jest.fn((req) => {
      req.resolve({ completed: false, dismissed: true });
    });
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow });

    // getAttribution
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ matched: false }),
    });
    // fetchFlow — fresh content
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          versionId: 'v1',
          html: '<div>fresh</div>',
        }),
    });

    await sdk.init(SDK_CONFIG);
    const result = await sdk.startFlow('onboarding');

    expect(result.dismissed).toBe(true);
    expect(presentFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ html: '<div>fresh</div>' }),
      })
    );

    // Should also have been cached for next time
    const cachedRaw = await AsyncStorage.getItem('@mobana:flow:onboarding');
    expect(cachedRaw).not.toBeNull();
  });
});

// ─── Reset flow ─────────────────────────────────────────────────────

describe('reset flow', () => {
  it('reset clears everything — new attribution fetch required', async () => {
    // First attribution
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          matched: true,
          attribution: { utm_source: 'old' },
          confidence: 0.5,
        }),
    });

    await sdk.init(SDK_CONFIG);
    const before = await sdk.getAttribution();
    expect(before.attribution?.utm_source).toBe('old');

    await sdk.reset();

    // After reset — new attribution
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          matched: true,
          attribution: { utm_source: 'new' },
          confidence: 0.9,
        }),
    });

    const after = await sdk.getAttribution();
    expect(after.attribution?.utm_source).toBe('new');

    // Install ID should be different (old one was deleted)
    const findCall1Body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const findCall2Body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(findCall1Body.installId).not.toBe(findCall2Body.installId);
  });
});

// ─── Enable/disable cycle ───────────────────────────────────────────

describe('enable/disable cycle', () => {
  it('disabled SDK skips everything, re-enable resumes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ matched: false }),
    });

    await sdk.init(SDK_CONFIG);
    await sdk.getAttribution();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Disable — should block all operations
    sdk.setEnabled(false);

    const attr = await sdk.getAttribution();
    expect(attr.status).toBe('error');
    expect(attr.error?.type).toBe('sdk_disabled');
    // Still only 1 fetch (disabled skips API)
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await sdk.trackConversion('signup');
    // No new fetch (disabled skips conversion)
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Re-enable — attribution should still be in memory from before disable
    sdk.setEnabled(true);

    // Give flush a tick
    await new Promise((r) => setTimeout(r, 10));

    // getAttribution should work from memory cache
    const afterEnable = await sdk.getAttribution();
    expect(afterEnable.status).toBe('no_match'); // Was unmatched
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ─── Auto-attribution ────────────────────────────────────────────────

describe('auto-attribution (autoAttribute: true)', () => {
  const AUTO_CONFIG = { appId: 'abc123', appKey: 'a'.repeat(32) };

  it('attribution is fetched in the background on init', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          matched: true,
          attribution: { utm_source: 'auto_fb' },
          confidence: 0.85,
        }),
    });

    await sdk.init(AUTO_CONFIG);
    // Yield to let the fire-and-forget attribution complete
    await new Promise((r) => setTimeout(r, 0));

    // getAttribution should return immediately from cache — no extra fetch
    const result = await sdk.getAttribution();
    expect(result.status).toBe('matched');
    expect(result.attribution?.utm_source).toBe('auto_fb');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('explicit getAttribution shares the in-flight auto-attribution request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          matched: true,
          attribution: { utm_source: 'shared' },
          confidence: 0.9,
        }),
    });

    await sdk.init(AUTO_CONFIG);

    // Explicit call while auto-attribution is in-flight — should share, not duplicate
    const result = await sdk.getAttribution();
    expect(result.status).toBe('matched');
    expect(result.attribution?.utm_source).toBe('shared');
    // Only one network request made despite two getAttribution calls
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
