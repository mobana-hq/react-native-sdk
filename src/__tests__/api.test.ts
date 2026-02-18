import { findAttribution, trackConversionApi, fetchFlow, trackFlowEvent } from '../api';
import type { DeviceInfo, ConversionEvent } from '../types';

const mockFetch = global.fetch as jest.Mock;

const ENDPOINT = 'https://test123.mobana.ai';
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
});

// ─── findAttribution ───────────────────────────────────────────────

describe('findAttribution', () => {
  it('sends POST to /find with correct body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ matched: false }),
    });

    await findAttribution(ENDPOINT, APP_KEY, 'inst_1', deviceInfo, null, 10000, false);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`${ENDPOINT}/find`);
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-App-Key']).toBe(APP_KEY);

    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      installId: 'inst_1',
      platform: 'ios',
      timezone: 'America/New_York',
      screenWidth: 390,
      screenHeight: 844,
      language: 'en-US',
    });
  });

  it('includes dacid in body when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ matched: true }),
    });

    await findAttribution(ENDPOINT, APP_KEY, 'inst_1', deviceInfo, 'click_abc', 10000, false);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.dacid).toBe('click_abc');
  });

  it('omits dacid when null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ matched: false }),
    });

    await findAttribution(ENDPOINT, APP_KEY, 'inst_1', deviceInfo, null, 10000, false);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('dacid');
  });

  it('returns parsed response on success', async () => {
    const serverResponse = {
      matched: true,
      attribution: { utm_source: 'facebook', confidence: 0.85 },
      confidence: 0.85,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(serverResponse),
    });

    const result = await findAttribution(ENDPOINT, APP_KEY, 'inst_1', deviceInfo, null, 10000, false);
    expect(result).toEqual(serverResponse);
  });

  it('returns null on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await findAttribution(ENDPOINT, APP_KEY, 'inst_1', deviceInfo, null, 10000, false);
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failed'));

    const result = await findAttribution(ENDPOINT, APP_KEY, 'inst_1', deviceInfo, null, 10000, false);
    expect(result).toBeNull();
  });

  it('returns null on abort (timeout)', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortError);

    const result = await findAttribution(ENDPOINT, APP_KEY, 'inst_1', deviceInfo, null, 10000, false);
    expect(result).toBeNull();
  });
});

// ─── trackConversionApi ────────────────────────────────────────────

describe('trackConversionApi', () => {
  const event: ConversionEvent = {
    installId: 'inst_1',
    name: 'signup',
    value: 9.99,
    timestamp: 1700000000000,
    flowSessionId: 'sess_abc',
  };

  it('sends POST to /conversion with correct body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    await trackConversionApi(ENDPOINT, APP_KEY, event, false);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`${ENDPOINT}/conversion`);
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      installId: 'inst_1',
      name: 'signup',
      value: 9.99,
      timestamp: 1700000000000,
      flowSessionId: 'sess_abc',
    });
  });

  it('returns true on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    const result = await trackConversionApi(ENDPOINT, APP_KEY, event, false);
    expect(result).toBe(true);
  });

  it('returns false on server failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: false }),
    });

    const result = await trackConversionApi(ENDPOINT, APP_KEY, event, false);
    expect(result).toBe(false);
  });

  it('returns false on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));

    const result = await trackConversionApi(ENDPOINT, APP_KEY, event, false);
    expect(result).toBe(false);
  });

  it('returns false on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await trackConversionApi(ENDPOINT, APP_KEY, event, false);
    expect(result).toBe(false);
  });

  it('sends conversion with only required fields', async () => {
    const minimalEvent: ConversionEvent = {
      installId: 'inst_1',
      name: 'signup',
      timestamp: 1700000000000,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    await trackConversionApi(ENDPOINT, APP_KEY, minimalEvent, false);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      installId: 'inst_1',
      name: 'signup',
      value: undefined,
      timestamp: 1700000000000,
      flowSessionId: undefined,
    });
  });
});

// ─── fetchFlow ─────────────────────────────────────────────────────

describe('fetchFlow', () => {
  it('sends GET to /flows/{slug} with installId param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ versionId: 'v1', html: '<div/>' }),
    });

    await fetchFlow(ENDPOINT, APP_KEY, 'onboarding', 'inst_1', undefined, 10000, false);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain(`${ENDPOINT}/flows/onboarding`);
    expect(url).toContain('installId=inst_1');
    expect(url).not.toContain('versionId=');
    expect(opts.method).toBe('GET');
  });

  it('includes versionId param when cached version provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ cached: true }),
    });

    await fetchFlow(ENDPOINT, APP_KEY, 'onboarding', 'inst_1', 'v42', 10000, false);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('versionId=v42');
  });

  it('returns parsed response on success', async () => {
    const flowData = { versionId: 'v1', html: '<div>hello</div>', css: 'body{}' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(flowData),
    });

    const result = await fetchFlow(ENDPOINT, APP_KEY, 'onboarding', 'inst_1', undefined, 10000, false);
    expect(result).toEqual(flowData);
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await fetchFlow(ENDPOINT, APP_KEY, 'onboarding', 'inst_1', undefined, 10000, false);
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));

    const result = await fetchFlow(ENDPOINT, APP_KEY, 'onboarding', 'inst_1', undefined, 10000, false);
    expect(result).toBeNull();
  });
});

// ─── trackFlowEvent ────────────────────────────────────────────────

describe('trackFlowEvent', () => {
  it('sends POST to /flows/{slug}/events with correct body', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await trackFlowEvent(
      ENDPOINT, APP_KEY, 'onboarding', 'inst_1', 'v1', 'sess_1', 'step_viewed', 2, { page: 'welcome' }, false
    );

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`${ENDPOINT}/flows/onboarding/events`);
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      installId: 'inst_1',
      versionId: 'v1',
      sessionId: 'sess_1',
      event: 'step_viewed',
      step: 2,
      data: { page: 'welcome' },
    });
  });

  it('returns true on success', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await trackFlowEvent(
      ENDPOINT, APP_KEY, 'onboarding', 'inst_1', 'v1', 'sess_1', '__started__', undefined, undefined, false
    );
    expect(result).toBe(true);
  });

  it('returns false on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));

    const result = await trackFlowEvent(
      ENDPOINT, APP_KEY, 'onboarding', 'inst_1', 'v1', 'sess_1', '__started__', undefined, undefined, false
    );
    expect(result).toBe(false);
  });

  it('returns false on non-200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await trackFlowEvent(
      ENDPOINT, APP_KEY, 'onboarding', 'inst_1', 'v1', 'sess_1', '__started__', undefined, undefined, false
    );
    expect(result).toBe(false);
  });

  it('sends event without optional step and data', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await trackFlowEvent(
      ENDPOINT, APP_KEY, 'onboarding', 'inst_1', 'v1', 'sess_1', '__completed__', undefined, undefined, false
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      installId: 'inst_1',
      versionId: 'v1',
      sessionId: 'sess_1',
      event: '__completed__',
      step: undefined,
      data: undefined,
    });
  });

  it('passes AbortSignal to fetch', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await findAttribution(ENDPOINT, APP_KEY, 'inst_1', deviceInfo, null, 10000, false);

    const opts = mockFetch.mock.calls[0][1];
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
