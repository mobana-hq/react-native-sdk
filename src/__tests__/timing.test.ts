/**
 * Timing tests — verify timeout behavior, deduplication timing, and AbortController usage.
 * Uses jest.useFakeTimers() to control time.
 */

import { findAttribution, fetchFlow } from '../api';
import type { DeviceInfo } from '../types';

const mockFetch = global.fetch as jest.Mock;

const ENDPOINT = 'https://test.mobana.ai';
const APP_KEY = 'a'.repeat(32);
const deviceInfo: DeviceInfo = {
  platform: 'ios',
  timezone: 'America/New_York',
  screenWidth: 390,
  screenHeight: 844,
  language: 'en-US',
};

beforeEach(() => {
  mockFetch.mockReset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── Timeout via AbortController ────────────────────────────────────

describe('request timeout', () => {
  it('findAttribution aborts after specified timeout', async () => {
    // fetch that never resolves until aborted
    mockFetch.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = findAttribution(ENDPOINT, APP_KEY, 'inst_1', deviceInfo, null, 5000, false);

    // Advance time to just before timeout — should still be pending
    jest.advanceTimersByTime(4999);
    // Can't await yet — still pending

    // Advance past timeout
    jest.advanceTimersByTime(1);

    const result = await promise;
    expect(result).toBeNull();
  });

  it('fetchFlow aborts after specified timeout', async () => {
    mockFetch.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = fetchFlow(ENDPOINT, APP_KEY, 'onboarding', 'inst_1', undefined, 3000, false);

    jest.advanceTimersByTime(3000);

    const result = await promise;
    expect(result).toBeNull();
  });

  it('successful response before timeout does not trigger abort', async () => {
    let abortHandlerCalled = false;

    mockFetch.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
      opts.signal.addEventListener('abort', () => {
        abortHandlerCalled = true;
      });
      // Respond immediately
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ matched: false }),
      });
    });

    const result = await findAttribution(ENDPOINT, APP_KEY, 'inst_1', deviceInfo, null, 10000, false);

    // Advance past the timeout
    jest.advanceTimersByTime(15000);

    expect(result).toEqual({ matched: false });
    expect(abortHandlerCalled).toBe(false);
  });

  it('custom timeout value is respected (not just default)', async () => {
    mockFetch.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    // Very short timeout
    const promise = findAttribution(ENDPOINT, APP_KEY, 'inst_1', deviceInfo, null, 100, false);

    // Should not abort at 99ms
    jest.advanceTimersByTime(99);

    // Should abort at 100ms
    jest.advanceTimersByTime(1);

    const result = await promise;
    expect(result).toBeNull();
  });
});

// ─── Deduplication timing ───────────────────────────────────────────
// Uses real timers — this tests concurrency logic, not timeout behavior

describe('deduplication timing', () => {
  it('rapid concurrent getAttribution calls share a single in-flight request', async () => {
    jest.useRealTimers();

    // Slow API response — resolves via manual trigger
    let fetchResolve: ((val: unknown) => void) | null = null;
    mockFetch.mockImplementation(() => {
      return new Promise((resolve) => {
        fetchResolve = resolve;
      });
    });

    // Inline mocks for MobanaSDK dependencies
    jest.mock('../storage', () => ({
      getInstallId: jest.fn().mockResolvedValue('inst_dedup'),
      getCachedResult: jest.fn().mockResolvedValue(null),
      setCachedResult: jest.fn().mockResolvedValue(undefined),
      clearAttribution: jest.fn(),
      queueConversion: jest.fn(),
      getConversionQueue: jest.fn().mockResolvedValue([]),
      clearConversionQueue: jest.fn(),
      getCachedFlow: jest.fn().mockResolvedValue(null),
      setCachedFlow: jest.fn(),
      clearAllCachedFlows: jest.fn(),
      clearLocalData: jest.fn(),
      generateUUID: jest.fn().mockReturnValue('uuid'),
    }));
    jest.mock('../device', () => ({
      getDeviceInfo: jest.fn().mockReturnValue({
        platform: 'ios', timezone: 'UTC', screenWidth: 390, screenHeight: 844, language: 'en',
      }),
    }));
    jest.mock('../NativeMobana', () => ({
      getInstallReferrer: jest.fn().mockResolvedValue(null),
    }));
    jest.mock('../components/MobanaProvider', () => ({
      getGlobalFlowContext: jest.fn().mockReturnValue(null),
    }));

    jest.resetModules();
    const { MobanaSDK: FreshSDK } = await import('../Mobana');
    const dedup = new FreshSDK();
    await dedup.init({ appId: 'test', appKey: 'a'.repeat(32) });

    // Fire 5 concurrent calls
    const promises = Array.from({ length: 5 }, () => dedup.getAttribution());

    // Give microtasks a tick so the first call reaches fetch
    await new Promise((r) => setTimeout(r, 10));

    // Resolve the single pending fetch
    expect(fetchResolve).not.toBeNull();
    fetchResolve!({
      ok: true,
      json: () => Promise.resolve({
        matched: true,
        attribution: { utm_source: 'x', confidence: 1 },
        confidence: 1,
      }),
    });

    const results = await Promise.all(promises);

    for (const r of results) {
      expect(r).toEqual({ utm_source: 'x', confidence: 1 });
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Restore fake timers for other tests in this file
    jest.useFakeTimers();
  });
});
