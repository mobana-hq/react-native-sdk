import type { FindResponse, FlowFetchResponse, ConversionEvent, AttributionResult } from '../types';

// ─── Mocks (must be before import) ─────────────────────────────────

jest.mock('../api', () => ({
  findAttribution: jest.fn(),
  trackConversionApi: jest.fn(),
  fetchFlow: jest.fn(),
  trackFlowEvent: jest.fn(),
}));

jest.mock('../storage', () => {
  const actual = jest.requireActual('../storage');
  return {
    ...actual,
    getInstallId: jest.fn().mockResolvedValue('test-install-id'),
    getCachedResult: jest.fn().mockResolvedValue(null),
    setCachedResult: jest.fn().mockResolvedValue(undefined),
    clearAttribution: jest.fn().mockResolvedValue(undefined),
    queueConversion: jest.fn().mockResolvedValue(undefined),
    getConversionQueue: jest.fn().mockResolvedValue([]),
    clearConversionQueue: jest.fn().mockResolvedValue(undefined),
    getCachedFlow: jest.fn().mockResolvedValue(null),
    setCachedFlow: jest.fn().mockResolvedValue(undefined),
    clearAllCachedFlows: jest.fn().mockResolvedValue(undefined),
    clearLocalData: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('../device', () => ({
  getDeviceInfo: jest.fn().mockReturnValue({
    platform: 'ios',
    timezone: 'America/New_York',
    screenWidth: 390,
    screenHeight: 844,
    language: 'en-US',
  }),
}));

jest.mock('../NativeMobana', () => ({
  getInstallReferrer: jest.fn().mockResolvedValue(null),
}));

jest.mock('../components/MobanaProvider', () => ({
  getGlobalFlowContext: jest.fn().mockReturnValue(null),
}));

// ─── Imports ────────────────────────────────────────────────────────

import { MobanaSDK } from '../Mobana';
import { findAttribution, trackConversionApi, fetchFlow } from '../api';
import {
  getInstallId,
  getCachedResult,
  clearAttribution,
  queueConversion,
  getConversionQueue,
  clearConversionQueue,
  getCachedFlow,
  setCachedFlow,
  clearAllCachedFlows,
  clearLocalData,
} from '../storage';
import { getDeviceInfo } from '../device';
import { getInstallReferrer } from '../NativeMobana';
import { getGlobalFlowContext } from '../components/MobanaProvider';

const mockFindAttribution = findAttribution as jest.Mock;
const mockTrackConversion = trackConversionApi as jest.Mock;
const mockFetchFlow = fetchFlow as jest.Mock;

const TEST_APP_KEY = 'a'.repeat(32);

function initConfig(overrides: { appId?: string; appKey?: string; [k: string]: unknown } = {}) {
  return { appId: 'abc123', appKey: TEST_APP_KEY, ...overrides };
}
const mockGetInstallId = getInstallId as jest.Mock;
const mockGetCachedResult = getCachedResult as jest.Mock;
const mockClearAttribution = clearAttribution as jest.Mock;
const mockQueueConversion = queueConversion as jest.Mock;
const mockGetConversionQueue = getConversionQueue as jest.Mock;
const mockClearConversionQueue = clearConversionQueue as jest.Mock;
const mockGetCachedFlow = getCachedFlow as jest.Mock;
const mockSetCachedFlow = setCachedFlow as jest.Mock;
const mockClearAllCachedFlows = clearAllCachedFlows as jest.Mock;
const mockClearLocalData = clearLocalData as jest.Mock;
const mockGetDeviceInfo = getDeviceInfo as jest.Mock;
const mockGetInstallReferrer = getInstallReferrer as jest.Mock;
const mockGetGlobalFlowContext = getGlobalFlowContext as jest.Mock;

let sdk: InstanceType<typeof MobanaSDK>;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetConversionQueue.mockResolvedValue([]);
  mockGetCachedResult.mockResolvedValue(null);
  mockGetInstallId.mockResolvedValue('test-install-id');
  mockGetCachedFlow.mockResolvedValue(null);
  mockGetInstallReferrer.mockResolvedValue(null);
  mockGetGlobalFlowContext.mockReturnValue(null);
  mockGetDeviceInfo.mockReturnValue({
    platform: 'ios',
    timezone: 'America/New_York',
    screenWidth: 390,
    screenHeight: 844,
    language: 'en-US',
  });
  sdk = new MobanaSDK();
});

// ─── init() ─────────────────────────────────────────────────────────

describe('init', () => {
  it('warns and returns when appId is missing', async () => {
    await sdk.init({ appId: '', appKey: TEST_APP_KEY });
    expect(mockGetInstallId).not.toHaveBeenCalled();
    expect(mockGetConversionQueue).not.toHaveBeenCalled();
  });

  it('warns and returns when appKey is missing', async () => {
    await sdk.init(initConfig({ appKey: '' }));
    expect(mockGetInstallId).not.toHaveBeenCalled();
    expect(mockGetConversionQueue).not.toHaveBeenCalled();
  });

  it('sets config with defaults', async () => {
    await sdk.init(initConfig());
    // Verify SDK is configured by calling getAttribution (should not warn)
    mockFindAttribution.mockResolvedValueOnce({ data: { matched: false } });
    const result = await sdk.getAttribution();
    // Should have called API (proving SDK is configured)
    expect(mockFindAttribution).toHaveBeenCalled();
    expect(result.status).toBe('no_match');
  });

  it('eagerly generates installId on init', async () => {
    await sdk.init(initConfig());
    expect(mockGetInstallId).toHaveBeenCalled();
  });

  it('flushes conversion queue on init', async () => {
    const queuedEvent: ConversionEvent = {
      installId: 'test-install-id',
      name: 'signup',
      timestamp: 1000,
    };
    mockGetConversionQueue.mockResolvedValueOnce([queuedEvent]);
    mockTrackConversion.mockResolvedValueOnce(true);

    await sdk.init(initConfig());

    expect(mockTrackConversion).toHaveBeenCalled();
  });

  it('fires attribution in background when autoAttribute is true (default)', async () => {
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    await sdk.init(initConfig());
    // Yield to let the fire-and-forget attribution promise run
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFindAttribution).toHaveBeenCalled();
  });

  it('does not fire attribution on init when autoAttribute is false', async () => {
    await sdk.init(initConfig({ autoAttribute: false }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFindAttribution).not.toHaveBeenCalled();
  });

  it('auto-attribution result is ready when getAttribution is called later', async () => {
    mockFindAttribution.mockResolvedValue({
      data: { matched: true, attribution: { utm_source: 'auto', confidence: 0.9 }, confidence: 0.9 },
    });
    await sdk.init(initConfig());
    // Let auto-attribution complete
    await new Promise((r) => setTimeout(r, 0));

    const result = await sdk.getAttribution();
    expect(result.status).toBe('matched');
    expect(result.attribution?.utm_source).toBe('auto');
    // Should NOT have made a second API call — result was already cached by auto-attribution
    expect(mockFindAttribution).toHaveBeenCalledTimes(1);
  });

  it('re-init with different appId updates endpoint', async () => {
    await sdk.init(initConfig({ appId: 'first' }));
    mockFindAttribution.mockResolvedValueOnce({ data: { matched: false } });
    await sdk.getAttribution();
    expect(mockFindAttribution).toHaveBeenCalledWith(
      'https://first.mobana.ai',
      TEST_APP_KEY,
      expect.any(String), expect.any(Object), null, expect.any(Number), false
    );

    // Reset so memory cache is cleared, then re-init
    await sdk.reset();
    await sdk.init(initConfig({ appId: 'second' }));
    mockFindAttribution.mockResolvedValueOnce({ data: { matched: false } });
    await sdk.getAttribution();
    expect(mockFindAttribution).toHaveBeenLastCalledWith(
      'https://second.mobana.ai',
      TEST_APP_KEY,
      expect.any(String), expect.any(Object), null, expect.any(Number), false
    );
  });
});

// ─── getAttribution() ───────────────────────────────────────────────

describe('getAttribution', () => {
  it('returns error before init', async () => {
    const result = await sdk.getAttribution();
    expect(result.status).toBe('error');
    expect(result.attribution).toBeNull();
    expect(result.error?.type).toBe('sdk_not_configured');
    expect(mockFindAttribution).not.toHaveBeenCalled();
  });

  it('returns error when disabled', async () => {
    await sdk.init(initConfig({ enabled: false }));
    const result = await sdk.getAttribution();
    expect(result.status).toBe('error');
    expect(result.attribution).toBeNull();
    expect(result.error?.type).toBe('sdk_disabled');
    expect(mockFindAttribution).not.toHaveBeenCalled();
  });

  it('fetches from API on first call', async () => {
    await sdk.init(initConfig({ autoAttribute: false }));
    const apiResponse: FindResponse = {
      matched: true,
      attribution: { utm_source: 'facebook', confidence: 0.85 },
      confidence: 0.85,
    };
    mockFindAttribution.mockResolvedValueOnce({ data: apiResponse });

    const result = await sdk.getAttribution();

    expect(mockFindAttribution).toHaveBeenCalledWith(
      'https://abc123.mobana.ai',
      TEST_APP_KEY,
      'test-install-id',
      expect.objectContaining({ platform: 'ios' }),
      null,
      10000,
      false
    );
    expect(result.status).toBe('matched');
    expect(result.attribution).toEqual({ utm_source: 'facebook', confidence: 0.85 });
  });

  it('caches result and returns from memory on second call', async () => {
    await sdk.init(initConfig({ autoAttribute: false }));
    mockFindAttribution.mockResolvedValueOnce({
      data: { matched: true, attribution: { utm_source: 'google', confidence: 0.7 }, confidence: 0.7 },
    });

    const first = await sdk.getAttribution();
    const second = await sdk.getAttribution();

    expect(mockFindAttribution).toHaveBeenCalledTimes(1);
    expect(first.status).toBe('matched');
    expect(second.status).toBe('matched');
    expect(first.attribution).toEqual(second.attribution);
  });

  it('returns from AsyncStorage cache if present', async () => {
    mockGetCachedResult.mockResolvedValueOnce({
      matched: true,
      attribution: { utm_source: 'cached', confidence: 0.9 },
      checkedAt: Date.now(),
    });
    await sdk.init(initConfig({ autoAttribute: false }));

    const result = await sdk.getAttribution();

    expect(mockFindAttribution).not.toHaveBeenCalled();
    expect(result.status).toBe('matched');
    expect(result.attribution).toEqual({ utm_source: 'cached', confidence: 0.9 });
  });

  it('caches unmatched result and skips API on subsequent calls', async () => {
    await sdk.init(initConfig({ autoAttribute: false }));
    mockFindAttribution.mockResolvedValueOnce({ data: { matched: false } });

    const first = await sdk.getAttribution();
    const second = await sdk.getAttribution();

    expect(first.status).toBe('no_match');
    expect(second.status).toBe('no_match');
    expect(mockFindAttribution).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent calls', async () => {
    await sdk.init(initConfig({ autoAttribute: false }));
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });

    const [r1, r2, r3] = await Promise.all([
      sdk.getAttribution(),
      sdk.getAttribution(),
      sdk.getAttribution(),
    ]);

    expect(mockFindAttribution).toHaveBeenCalledTimes(1);
    expect(r1.status).toBe('no_match');
    expect(r2.status).toBe('no_match');
    expect(r3.status).toBe('no_match');
  });

  it('returns error result on API failure without crashing', async () => {
    await sdk.init(initConfig({ autoAttribute: false }));
    mockFindAttribution.mockResolvedValueOnce({ data: null, errorType: 'network' });

    const result = await sdk.getAttribution();
    expect(result.status).toBe('error');
    expect(result.attribution).toBeNull();
    expect(result.error?.type).toBe('network');
  });

  it('returns error result with server status on HTTP error', async () => {
    await sdk.init(initConfig({ autoAttribute: false }));
    mockFindAttribution.mockResolvedValueOnce({ data: null, errorType: 'server', status: 503 });

    const result = await sdk.getAttribution();
    expect(result.status).toBe('error');
    expect(result.error?.type).toBe('server');
    expect(result.error?.status).toBe(503);
  });

  it('retries after error (does not cache error results)', async () => {
    await sdk.init(initConfig({ autoAttribute: false }));
    // First call fails
    mockFindAttribution.mockResolvedValueOnce({ data: null, errorType: 'network' });
    const first = await sdk.getAttribution();
    expect(first.status).toBe('error');

    // Second call should retry and succeed
    mockFindAttribution.mockResolvedValueOnce({
      data: { matched: true, attribution: { utm_source: 'retry', confidence: 0.8 }, confidence: 0.8 },
    });
    const second = await sdk.getAttribution();
    expect(second.status).toBe('matched');
    expect(second.attribution?.utm_source).toBe('retry');
    expect(mockFindAttribution).toHaveBeenCalledTimes(2);
  });

  it('uses custom endpoint when provided', async () => {
    await sdk.init(initConfig({ endpoint: 'https://myproxy.com/d', autoAttribute: false }));
    mockFindAttribution.mockResolvedValueOnce({ data: { matched: false } });

    await sdk.getAttribution();

    expect(mockFindAttribution).toHaveBeenCalledWith(
      'https://myproxy.com/d',
      TEST_APP_KEY,
      expect.any(String),
      expect.any(Object),
      null,
      expect.any(Number),
      false
    );
  });

  it('strips trailing slash from custom endpoint', async () => {
    await sdk.init(initConfig({ endpoint: 'https://myproxy.com/d/', autoAttribute: false }));
    mockFindAttribution.mockResolvedValueOnce({ data: { matched: false } });

    await sdk.getAttribution();

    expect(mockFindAttribution).toHaveBeenCalledWith(
      'https://myproxy.com/d',
      TEST_APP_KEY,
      expect.any(String),
      expect.any(Object),
      null,
      expect.any(Number),
      false
    );
  });

  it('passes dacid from install referrer on Android', async () => {
    mockGetDeviceInfo.mockReturnValue({
      platform: 'android',
      timezone: 'America/New_York',
      screenWidth: 412,
      screenHeight: 915,
      language: 'en-US',
    });
    mockGetInstallReferrer.mockResolvedValueOnce('click_xyz');
    await sdk.init(initConfig({ autoAttribute: false }));
    mockFindAttribution.mockResolvedValueOnce({ data: { matched: false } });

    await sdk.getAttribution();

    expect(mockFindAttribution).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ platform: 'android' }),
      'click_xyz',
      expect.any(Number),
      false
    );
  });

  it('propagates custom timeout to API call', async () => {
    await sdk.init(initConfig({ autoAttribute: false }));
    mockFindAttribution.mockResolvedValueOnce({ data: { matched: false } });

    await sdk.getAttribution({ timeout: 5000 });

    expect(mockFindAttribution).toHaveBeenCalledWith(
      expect.any(String),
      TEST_APP_KEY,
      expect.any(String),
      expect.any(Object),
      null,
      5000,
      false
    );
  });

  it('uses default timeout when none specified', async () => {
    await sdk.init(initConfig({ autoAttribute: false }));
    mockFindAttribution.mockResolvedValueOnce({ data: { matched: false } });

    await sdk.getAttribution();

    expect(mockFindAttribution).toHaveBeenCalledWith(
      expect.any(String),
      TEST_APP_KEY,
      expect.any(String),
      expect.any(Object),
      null,
      10000,
      false
    );
  });

  it('returns no_match from AsyncStorage cache when matched is false', async () => {
    mockGetCachedResult.mockResolvedValueOnce({
      matched: false,
      checkedAt: Date.now(),
    });
    await sdk.init(initConfig({ autoAttribute: false }));

    const result = await sdk.getAttribution();

    expect(result.status).toBe('no_match');
    expect(result.attribution).toBeNull();
    expect(mockFindAttribution).not.toHaveBeenCalled();
  });

  it('skips install referrer on iOS', async () => {
    mockGetDeviceInfo.mockReturnValue({
      platform: 'ios',
      timezone: 'America/New_York',
      screenWidth: 390,
      screenHeight: 844,
      language: 'en-US',
    });
    await sdk.init(initConfig({ autoAttribute: false }));
    mockFindAttribution.mockResolvedValueOnce({ data: { matched: false } });

    await sdk.getAttribution();

    expect(mockGetInstallReferrer).not.toHaveBeenCalled();
    expect(mockFindAttribution).toHaveBeenCalledWith(
      expect.any(String),
      TEST_APP_KEY,
      expect.any(String),
      expect.any(Object),
      null,
      expect.any(Number),
      false
    );
  });
});

// ─── trackConversion() ──────────────────────────────────────────────

describe('trackConversion', () => {
  it('returns early before init', async () => {
    await sdk.trackConversion('signup');
    expect(mockTrackConversion).not.toHaveBeenCalled();
  });

  it('returns early when disabled', async () => {
    await sdk.init(initConfig({ enabled: false }));
    await sdk.trackConversion('signup');
    expect(mockTrackConversion).not.toHaveBeenCalled();
  });

  it('sends conversion via API', async () => {
    await sdk.init(initConfig());
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockTrackConversion.mockResolvedValueOnce(true);

    await sdk.trackConversion('purchase', 49.99, 'sess_1');

    expect(mockTrackConversion).toHaveBeenCalledWith(
      'https://abc123.mobana.ai',
      TEST_APP_KEY,
      expect.objectContaining({
        installId: 'test-install-id',
        name: 'purchase',
        value: 49.99,
        flowSessionId: 'sess_1',
      }),
      false
    );
  });

  it('queues conversion on API failure', async () => {
    await sdk.init(initConfig());
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockTrackConversion.mockResolvedValueOnce(false);

    await sdk.trackConversion('signup');

    expect(mockQueueConversion).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'signup' })
    );
  });

  it('sends conversion with only name (no value or flowSessionId)', async () => {
    await sdk.init(initConfig());
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockTrackConversion.mockResolvedValueOnce(true);

    await sdk.trackConversion('signup');

    expect(mockTrackConversion).toHaveBeenCalledWith(
      'https://abc123.mobana.ai',
      TEST_APP_KEY,
      expect.objectContaining({
        installId: 'test-install-id',
        name: 'signup',
        value: undefined,
        flowSessionId: undefined,
      }),
      false
    );
  });

  it('includes timestamp in conversion event', async () => {
    await sdk.init(initConfig());
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockTrackConversion.mockResolvedValueOnce(true);
    const before = Date.now();

    await sdk.trackConversion('signup');

    const after = Date.now();
    const event = mockTrackConversion.mock.calls[0][2]; // (endpoint, appKey, event)
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(after);
  });

  it('calls getAttribution first to ensure install record', async () => {
    await sdk.init(initConfig());
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockTrackConversion.mockResolvedValueOnce(true);

    await sdk.trackConversion('signup');

    // findAttribution should have been called (via getAttribution)
    expect(mockFindAttribution).toHaveBeenCalled();
  });
});

// ─── startFlow() ────────────────────────────────────────────────────

describe('startFlow', () => {
  it('returns error before init', async () => {
    const result = await sdk.startFlow('onboarding');
    expect(result.error).toBe('SDK_NOT_CONFIGURED');
    expect(result.completed).toBe(false);
  });

  it('returns error when disabled', async () => {
    await sdk.init(initConfig({ enabled: false }));
    const result = await sdk.startFlow('onboarding');
    expect(result.error).toBe('SDK_NOT_CONFIGURED');
  });

  it('returns PROVIDER_NOT_MOUNTED when no provider', async () => {
    mockGetGlobalFlowContext.mockReturnValue(null);
    await sdk.init(initConfig());
    const result = await sdk.startFlow('onboarding');
    expect(result.error).toBe('PROVIDER_NOT_MOUNTED');
  });

  it('fetches flow and presents via provider', async () => {
    const presentFlow = jest.fn((req) => {
      req.resolve({ completed: true, dismissed: false });
    });
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow });
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockFetchFlow.mockResolvedValueOnce({
      versionId: 'v1',
      html: '<div>flow</div>',
    } as FlowFetchResponse);

    await sdk.init(initConfig());
    const result = await sdk.startFlow('onboarding');

    expect(mockFetchFlow).toHaveBeenCalled();
    expect(presentFlow).toHaveBeenCalled();
    expect(result.completed).toBe(true);
  });

  it('uses cached flow when server confirms cache', async () => {
    const presentFlow = jest.fn((req) => {
      req.resolve({ completed: true, dismissed: false });
    });
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow });
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockGetCachedFlow.mockResolvedValueOnce({
      versionId: 'v1',
      html: '<div>cached</div>',
      cachedAt: Date.now(),
    });
    mockFetchFlow.mockResolvedValueOnce({ cached: true } as FlowFetchResponse);

    await sdk.init(initConfig());
    const result = await sdk.startFlow('onboarding');

    expect(presentFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ html: '<div>cached</div>' }),
      })
    );
    expect(result.completed).toBe(true);
  });

  it('caches new flow content for subsequent use', async () => {
    const flowCache = new Map<string, Record<string, unknown>>();
    mockSetCachedFlow.mockImplementation((slug: string, config: Record<string, unknown>) => {
      flowCache.set(slug, { ...config, cachedAt: Date.now() });
      return Promise.resolve();
    });
    mockGetCachedFlow.mockImplementation((slug: string) => {
      return Promise.resolve(flowCache.get(slug) || null);
    });

    const presentFlow = jest.fn((req) => {
      req.resolve({ completed: true, dismissed: false });
    });
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow });
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });

    await sdk.init(initConfig());

    mockFetchFlow.mockResolvedValueOnce({
      versionId: 'v2',
      html: '<div>new</div>',
      css: 'body{}',
    });
    await sdk.startFlow('onboarding');

    mockFetchFlow.mockResolvedValueOnce({ cached: true });
    await sdk.startFlow('onboarding');

    expect(presentFlow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          html: '<div>new</div>',
          css: 'body{}',
        }),
      })
    );
  });

  it('falls back to cache on network error', async () => {
    const presentFlow = jest.fn((req) => {
      req.resolve({ completed: true, dismissed: false });
    });
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow });
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockGetCachedFlow.mockResolvedValueOnce({
      versionId: 'v1',
      html: '<div>offline</div>',
      cachedAt: Date.now(),
    });
    mockFetchFlow.mockResolvedValueOnce(null);

    await sdk.init(initConfig());
    const result = await sdk.startFlow('onboarding');

    expect(presentFlow).toHaveBeenCalled();
    expect(result.completed).toBe(true);
  });

  it('returns NETWORK_ERROR when no cache and no network', async () => {
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow: jest.fn() });
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockGetCachedFlow.mockResolvedValueOnce(null);
    mockFetchFlow.mockResolvedValueOnce(null);

    await sdk.init(initConfig());
    const result = await sdk.startFlow('onboarding');

    expect(result.error).toBe('NETWORK_ERROR');
  });

  it('returns server error codes (NOT_FOUND)', async () => {
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow: jest.fn() });
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockFetchFlow.mockResolvedValueOnce({ error: 'NOT_FOUND' } as FlowFetchResponse);

    await sdk.init(initConfig());
    const result = await sdk.startFlow('onboarding');

    expect(result.error).toBe('NOT_FOUND');
  });

  it('returns server error codes (PLAN_REQUIRED)', async () => {
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow: jest.fn() });
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockFetchFlow.mockResolvedValueOnce({ error: 'PLAN_REQUIRED' } as FlowFetchResponse);

    await sdk.init(initConfig());
    const result = await sdk.startFlow('onboarding');

    expect(result.error).toBe('PLAN_REQUIRED');
  });

  it('returns server error codes (FLOW_LIMIT_EXCEEDED)', async () => {
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow: jest.fn() });
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockFetchFlow.mockResolvedValueOnce({ error: 'FLOW_LIMIT_EXCEEDED' } as FlowFetchResponse);

    await sdk.init(initConfig());
    const result = await sdk.startFlow('onboarding');

    expect(result.error).toBe('FLOW_LIMIT_EXCEEDED');
  });

  it('passes options through to provider', async () => {
    const presentFlow = jest.fn((req) => {
      req.resolve({ completed: true, dismissed: false });
    });
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow });
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockFetchFlow.mockResolvedValueOnce({
      versionId: 'v1',
      html: '<div>flow</div>',
    });

    const onEvent = jest.fn();
    const onCallback = jest.fn();
    await sdk.init(initConfig());
    await sdk.startFlow('onboarding', {
      params: { userName: 'Test' },
      onEvent,
      onCallback,
    });

    expect(presentFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          params: { userName: 'Test' },
          onEvent,
          onCallback,
        }),
      })
    );
  });

  it('passes cached attribution to presented flow', async () => {
    const presentFlow = jest.fn((req) => {
      req.resolve({ completed: true, dismissed: false });
    });
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow });
    mockFindAttribution.mockResolvedValue({
      data: { matched: true, attribution: { utm_source: 'fb', confidence: 0.9 }, confidence: 0.9 },
    });
    mockFetchFlow.mockResolvedValueOnce({
      versionId: 'v1',
      html: '<div>flow</div>',
    });

    await sdk.init(initConfig());
    await sdk.getAttribution();
    await sdk.startFlow('onboarding');

    expect(presentFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        attribution: expect.objectContaining({ utm_source: 'fb' }),
      })
    );
  });

  it('returns SERVER_ERROR on unexpected response', async () => {
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow: jest.fn() });
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockFetchFlow.mockResolvedValueOnce({} as FlowFetchResponse);

    await sdk.init(initConfig());
    const result = await sdk.startFlow('onboarding');

    expect(result.error).toBe('SERVER_ERROR');
  });

  it('returns SERVER_ERROR on thrown exception', async () => {
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow: jest.fn() });
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    mockFetchFlow.mockRejectedValueOnce(new Error('boom'));

    await sdk.init(initConfig());
    const result = await sdk.startFlow('onboarding');

    expect(result.error).toBe('SERVER_ERROR');
  });
});

// ─── prefetchFlow() ─────────────────────────────────────────────────

describe('prefetchFlow', () => {
  it('fetches flow from server', async () => {
    await sdk.init(initConfig());
    mockFetchFlow.mockResolvedValueOnce({
      versionId: 'v1',
      html: '<div>prefetched</div>',
    });

    await sdk.prefetchFlow('onboarding');

    expect(mockFetchFlow).toHaveBeenCalled();
  });

  it('prefetched flow is used by subsequent startFlow', async () => {
    const flowCache = new Map<string, Record<string, unknown>>();
    mockSetCachedFlow.mockImplementation((slug: string, config: Record<string, unknown>) => {
      flowCache.set(slug, { ...config, cachedAt: Date.now() });
      return Promise.resolve();
    });
    mockGetCachedFlow.mockImplementation((slug: string) => {
      return Promise.resolve(flowCache.get(slug) || null);
    });

    const presentFlow = jest.fn((req) => {
      req.resolve({ completed: true, dismissed: false });
    });
    mockGetGlobalFlowContext.mockReturnValue({ isProviderMounted: true, presentFlow });
    mockFindAttribution.mockResolvedValue({ data: { matched: false } });

    await sdk.init(initConfig());

    mockFetchFlow.mockResolvedValueOnce({
      versionId: 'v1',
      html: '<div>prefetched</div>',
    });
    await sdk.prefetchFlow('onboarding');

    mockFetchFlow.mockResolvedValueOnce({ cached: true });
    const result = await sdk.startFlow('onboarding');

    expect(presentFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ html: '<div>prefetched</div>' }),
      })
    );
    expect(result.completed).toBe(true);
  });

  it('skips caching when server confirms existing cache', async () => {
    await sdk.init(initConfig());
    mockGetCachedFlow.mockResolvedValueOnce({
      versionId: 'v1',
      html: '<div/>', cachedAt: Date.now(),
    });
    mockFetchFlow.mockResolvedValueOnce({ cached: true } as FlowFetchResponse);

    await sdk.prefetchFlow('onboarding');

    expect(mockSetCachedFlow).not.toHaveBeenCalled();
  });

  it('no-ops when disabled', async () => {
    await sdk.init(initConfig({ enabled: false }));
    await sdk.prefetchFlow('onboarding');
    expect(mockFetchFlow).not.toHaveBeenCalled();
  });

  it('no-ops before init', async () => {
    await sdk.prefetchFlow('onboarding');
    expect(mockFetchFlow).not.toHaveBeenCalled();
  });
});

// ─── reset() ────────────────────────────────────────────────────────

describe('reset', () => {
  it('clears all storage', async () => {
    await sdk.init(initConfig());
    await sdk.reset();

    expect(mockClearAttribution).toHaveBeenCalled();
    expect(mockClearConversionQueue).toHaveBeenCalled();
    expect(mockClearAllCachedFlows).toHaveBeenCalled();
    expect(mockClearLocalData).toHaveBeenCalled();
  });

  it('clears in-memory cache so next getAttribution fetches fresh', async () => {
    await sdk.init(initConfig());
    mockFindAttribution.mockResolvedValue({
      data: { matched: true, attribution: { utm_source: 'fb', confidence: 0.8 }, confidence: 0.8 },
    });

    await sdk.getAttribution();
    expect(mockFindAttribution).toHaveBeenCalledTimes(1);

    await sdk.reset();

    mockFindAttribution.mockResolvedValue({ data: { matched: false } });
    await sdk.getAttribution();
    expect(mockFindAttribution).toHaveBeenCalledTimes(2);
  });
});

// ─── setEnabled() ───────────────────────────────────────────────────

describe('setEnabled', () => {
  it('warns before init', () => {
    sdk.setEnabled(false);
    // Should not throw, just warn
    expect(console.warn).toHaveBeenCalled();
  });

  it('disabling blocks getAttribution', async () => {
    await sdk.init(initConfig());
    sdk.setEnabled(false);

    const result = await sdk.getAttribution();
    expect(result.status).toBe('error');
    expect(result.error?.type).toBe('sdk_disabled');
    expect(result.attribution).toBeNull();
    expect(mockFindAttribution).not.toHaveBeenCalled();
  });

  it('re-enabling flushes conversion queue', async () => {
    const queued: ConversionEvent = { installId: 'x', name: 'y', timestamp: 0 };
    await sdk.init(initConfig());
    sdk.setEnabled(false);

    mockGetConversionQueue.mockResolvedValueOnce([queued]);
    mockTrackConversion.mockResolvedValueOnce(true);

    sdk.setEnabled(true);

    // Give the async flush a tick to execute
    await new Promise((r) => setTimeout(r, 50));

    expect(mockTrackConversion).toHaveBeenCalled();
  });
});

// ─── flushConversionQueue (via init) ────────────────────────────────

describe('flushConversionQueue', () => {
  it('sends all queued events on init', async () => {
    const events: ConversionEvent[] = [
      { installId: 'x', name: 'a', timestamp: 1 },
      { installId: 'x', name: 'b', timestamp: 2 },
    ];
    mockGetConversionQueue.mockResolvedValueOnce(events);
    mockTrackConversion.mockResolvedValue(true);

    await sdk.init(initConfig());

    expect(mockTrackConversion).toHaveBeenCalledTimes(2);
  });

  it('re-queues only failures', async () => {
    const events: ConversionEvent[] = [
      { installId: 'x', name: 'success', timestamp: 1 },
      { installId: 'x', name: 'fail', timestamp: 2 },
    ];
    mockGetConversionQueue.mockResolvedValueOnce(events);
    mockTrackConversion
      .mockResolvedValueOnce(true)   // first succeeds
      .mockResolvedValueOnce(false); // second fails

    await sdk.init(initConfig());

    expect(mockQueueConversion).toHaveBeenCalledTimes(1);
    expect(mockQueueConversion).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'fail' })
    );
  });

  it('does nothing when queue is empty', async () => {
    mockGetConversionQueue.mockResolvedValueOnce([]);
    await sdk.init(initConfig());
    expect(mockTrackConversion).not.toHaveBeenCalled();
  });
});
