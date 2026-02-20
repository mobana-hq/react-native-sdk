import type { FindResponse, DeviceInfo, ConversionEvent, FlowFetchResponse } from './types';

const DEFAULT_TIMEOUT = 10000; // 10 seconds

function buildHeaders(appKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (appKey) {
    headers['X-App-Key'] = appKey;
  }
  return headers;
}

/**
 * Make a request to the attribution API
 */
async function request<T>(
  endpoint: string,
  path: string,
  body: Record<string, unknown>,
  appKey: string,
  timeout: number = DEFAULT_TIMEOUT,
  debug: boolean = false
): Promise<T | null> {
  const url = `${endpoint}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    if (debug) {
      console.log(`[Mobana] POST ${url}`, body);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(appKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (debug) {
        console.log(`[Mobana] Request failed: ${response.status}`);
      }
      return null;
    }

    const data = await response.json();
    
    if (debug) {
      console.log(`[Mobana] Response:`, data);
    }

    return data as T;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (debug) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(`[Mobana] Request timed out after ${timeout}ms`);
      } else {
        console.log(`[Mobana] Request error:`, error);
      }
    }
    
    return null;
  }
}

/**
 * Internal result type for requests that need to surface error details.
 * Used by findAttribution so getAttribution() can distinguish network vs.
 * server vs. timeout errors.
 */
interface RequestResult<U> {
  data: U | null;
  errorType?: 'network' | 'timeout' | 'server';
  /** HTTP status code — only present for 'server' errorType */
  status?: number;
}

/**
 * Like request(), but returns a structured result with error type information
 * instead of collapsing all failures to null.
 */
async function requestWithError<U>(
  endpoint: string,
  path: string,
  body: Record<string, unknown>,
  appKey: string,
  timeout: number = DEFAULT_TIMEOUT,
  debug: boolean = false
): Promise<RequestResult<U>> {
  const url = `${endpoint}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    if (debug) {
      console.log(`[Mobana] POST ${url}`, body);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(appKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (debug) {
        console.log(`[Mobana] Request failed: ${response.status}`);
      }
      return { data: null, errorType: 'server', status: response.status };
    }

    const data = await response.json();

    if (debug) {
      console.log(`[Mobana] Response:`, data);
    }

    return { data: data as U };
  } catch (error) {
    clearTimeout(timeoutId);

    const isTimeout = error instanceof Error && error.name === 'AbortError';

    if (debug) {
      if (isTimeout) {
        console.log(`[Mobana] Request timed out after ${timeout}ms`);
      } else {
        console.log(`[Mobana] Request error:`, error);
      }
    }

    return { data: null, errorType: isTimeout ? 'timeout' : 'network' };
  }
}

/**
 * Call /find endpoint to get attribution
 */
export async function findAttribution<T = Record<string, unknown>>(
  endpoint: string,
  appKey: string,
  installId: string,
  deviceInfo: DeviceInfo,
  dacid: string | null,
  timeout: number,
  debug: boolean
): Promise<RequestResult<FindResponse<T>>> {
  return requestWithError<FindResponse<T>>(
    endpoint,
    '/find',
    {
      installId,
      platform: deviceInfo.platform,
      timezone: deviceInfo.timezone,
      screenWidth: deviceInfo.screenWidth,
      screenHeight: deviceInfo.screenHeight,
      language: deviceInfo.language,
      ...(dacid && { dacid }),
    },
    appKey,
    timeout,
    debug
  );
}

/**
 * Call /conversion endpoint to track a conversion
 */
export async function trackConversionApi(
  endpoint: string,
  appKey: string,
  event: ConversionEvent,
  debug: boolean
): Promise<boolean> {
  const result = await request<{ success: boolean }>(
    endpoint,
    '/conversion',
    {
      installId: event.installId,
      name: event.name,
      value: event.value,
      timestamp: event.timestamp,
      flowSessionId: event.flowSessionId,
    },
    appKey,
    DEFAULT_TIMEOUT,
    debug
  );

  return result?.success ?? false;
}

// ============================================
// Flow API
// ============================================

/**
 * Fetch flow content from the server
 * 
 * @param endpoint - API endpoint
 * @param slug - Flow slug identifier
 * @param installId - Install ID for tracking
 * @param cachedVersionId - If provided, server will return { cached: true } if version matches
 * @param debug - Enable debug logging
 */
export async function fetchFlow(
  endpoint: string,
  appKey: string,
  slug: string,
  installId: string,
  cachedVersionId?: string,
  timeout: number = DEFAULT_TIMEOUT,
  debug: boolean = false
): Promise<FlowFetchResponse | null> {
  const params = new URLSearchParams({ installId });
  if (cachedVersionId) {
    params.set('versionId', cachedVersionId);
  }

  const url = `${endpoint}/flows/${slug}?${params.toString()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    if (debug) {
      console.log(`[Mobana] GET ${url}`);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(appKey),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (debug) {
        console.log(`[Mobana] Flow fetch failed: ${response.status}`);
      }
      return null;
    }

    const data = await response.json();

    if (debug) {
      console.log(`[Mobana] Flow response:`, data);
    }

    return data as FlowFetchResponse;
  } catch (error) {
    clearTimeout(timeoutId);

    if (debug) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(`[Mobana] Flow fetch timed out after ${timeout}ms`);
      } else {
        console.log(`[Mobana] Flow fetch error:`, error);
      }
    }

    return null;
  }
}

/**
 * Track a flow event
 * 
 * @param endpoint - API endpoint
 * @param slug - Flow slug identifier
 * @param installId - Install ID for tracking
 * @param versionId - Flow version that was shown
 * @param sessionId - Session ID for grouping events from a single flow presentation
 * @param event - Event name ('step-1', 'notifications-enabled', 'welcome-viewed', or other event)
 * @param step - Optional step number for multi-step flows
 * @param data - Optional custom event data
 * @param debug - Enable debug logging
 */
export async function trackFlowEvent(
  endpoint: string,
  appKey: string,
  slug: string,
  installId: string,
  versionId: string,
  sessionId: string,
  event: string,
  step?: number,
  data?: unknown,
  debug: boolean = false
): Promise<boolean> {
  const url = `${endpoint}/flows/${slug}/events`;

  try {
    if (debug) {
      console.log(`[Mobana] POST ${url}`, { installId, versionId, sessionId, event, step, data });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(appKey),
      body: JSON.stringify({
        installId,
        versionId,
        sessionId,
        event,
        step,
        data,
      }),
    });

    if (debug) {
      console.log(`[Mobana] Flow event response: ${response.status}`);
    }

    return response.ok;
  } catch (error) {
    if (debug) {
      console.log(`[Mobana] Flow event error:`, error);
    }
    return false;
  }
}
