import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Attribution, CachedAttributionResult, ConversionEvent, CachedFlow } from './types';

const KEYS = {
  INSTALL_ID: '@mobana:install_id',
  ATTRIBUTION: '@mobana:attribution',
  CONVERSION_QUEUE: '@mobana:conversion_queue',
  LOCAL_DATA: '@mobana:local_data',
} as const;

const FLOW_CACHE_PREFIX = '@mobana:flow:';

/**
 * Get or create a stable install ID (UUID)
 * Generated once on first launch and persisted locally
 */
export async function getInstallId(): Promise<string> {
  try {
    let installId = await AsyncStorage.getItem(KEYS.INSTALL_ID);
    
    if (!installId) {
      // Generate UUID v4
      installId = generateUUID();
      await AsyncStorage.setItem(KEYS.INSTALL_ID, installId);
    }
    
    return installId;
  } catch {
    // If storage fails, generate a new UUID each time
    // This is suboptimal but ensures the SDK doesn't crash
    return generateUUID();
  }
}

/**
 * Get cached attribution result (includes matched: false responses)
 */
export async function getCachedResult<T = Record<string, unknown>>(): Promise<CachedAttributionResult<T> | null> {
  try {
    const data = await AsyncStorage.getItem(KEYS.ATTRIBUTION);
    if (data) {
      return JSON.parse(data) as CachedAttributionResult<T>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Store attribution result in cache (stores both matched and unmatched responses)
 */
export async function setCachedResult<T = Record<string, unknown>>(
  matched: boolean,
  attribution?: Attribution<T>
): Promise<void> {
  try {
    const result: CachedAttributionResult<T> = {
      matched,
      attribution,
      checkedAt: Date.now(),
    };
    await AsyncStorage.setItem(KEYS.ATTRIBUTION, JSON.stringify(result));
  } catch {
    // Silently fail - caching is not critical
  }
}

/**
 * Clear all stored attribution data (for testing/reset)
 */
export async function clearAttribution(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEYS.ATTRIBUTION, KEYS.INSTALL_ID]);
  } catch {
    // Silently fail
  }
}

/**
 * Queue a conversion event for later sending (offline support)
 */
export async function queueConversion(event: ConversionEvent): Promise<void> {
  try {
    const queue = await getConversionQueue();
    queue.push(event);
    await AsyncStorage.setItem(KEYS.CONVERSION_QUEUE, JSON.stringify(queue));
  } catch {
    // Silently fail - we tried our best
  }
}

/**
 * Get all queued conversion events
 */
export async function getConversionQueue(): Promise<ConversionEvent[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.CONVERSION_QUEUE);
    if (data) {
      return JSON.parse(data) as ConversionEvent[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Clear the conversion queue after successful send
 */
export async function clearConversionQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEYS.CONVERSION_QUEUE);
  } catch {
    // Silently fail
  }
}

/**
 * Generate a UUID v4
 * Uses crypto.getRandomValues when available (Hermes 0.73+), falls back to Math.random
 */
export function generateUUID(): string {
  // Check if crypto.getRandomValues is available (Hermes 0.73+, modern RN)
  const cryptoObj = typeof globalThis !== 'undefined' && (globalThis as typeof globalThis & { crypto?: { getRandomValues: (array: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(16);
      cryptoObj.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } catch {
      // Fall through to Math.random fallback
    }
  }
  // Fallback for environments without crypto.getRandomValues
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================
// Flow Caching
// ============================================

/**
 * Get cached flow content by slug
 */
export async function getCachedFlow(slug: string): Promise<CachedFlow | null> {
  try {
    const key = `${FLOW_CACHE_PREFIX}${slug}`;
    const data = await AsyncStorage.getItem(key);
    if (data) {
      return JSON.parse(data) as CachedFlow;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Cache flow content
 */
export async function setCachedFlow(slug: string, flow: Omit<CachedFlow, 'cachedAt'>): Promise<void> {
  try {
    const key = `${FLOW_CACHE_PREFIX}${slug}`;
    const cached: CachedFlow = {
      ...flow,
      cachedAt: Date.now(),
    };
    await AsyncStorage.setItem(key, JSON.stringify(cached));
  } catch {
    // Silently fail - caching is not critical
  }
}

/**
 * Clear cached flow by slug
 */
export async function clearCachedFlow(slug: string): Promise<void> {
  try {
    const key = `${FLOW_CACHE_PREFIX}${slug}`;
    await AsyncStorage.removeItem(key);
  } catch {
    // Silently fail
  }
}

/**
 * Clear all cached flows
 */
export async function clearAllCachedFlows(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const flowKeys = allKeys.filter(key => key.startsWith(FLOW_CACHE_PREFIX));
    if (flowKeys.length > 0) {
      await AsyncStorage.multiRemove(flowKeys);
    }
  } catch {
    // Silently fail
  }
}

// ============================================
// Local Data (for flow bridge)
// ============================================

/**
 * Get all local data
 */
export async function getAllLocalData(): Promise<Record<string, unknown>> {
  try {
    const data = await AsyncStorage.getItem(KEYS.LOCAL_DATA);
    if (data) {
      return JSON.parse(data) as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Store data locally on device (persists across app sessions)
 */
export async function setLocalData(key: string, value: unknown): Promise<void> {
  try {
    const data = await getAllLocalData();
    data[key] = value;
    await AsyncStorage.setItem(KEYS.LOCAL_DATA, JSON.stringify(data));
  } catch {
    // Silently fail
  }
}

/**
 * Retrieve locally stored data
 */
export async function getLocalData(key: string): Promise<unknown> {
  try {
    const data = await getAllLocalData();
    return data[key];
  } catch {
    return undefined;
  }
}

/**
 * Clear all local data
 */
export async function clearLocalData(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEYS.LOCAL_DATA);
  } catch {
    // Silently fail
  }
}
