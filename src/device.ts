import { Platform, Dimensions } from 'react-native';
import type { DeviceInfo } from './types';

/**
 * Collect device information for attribution matching
 */
export function getDeviceInfo(): DeviceInfo {
  const { width, height } = Dimensions.get('screen');
  
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    timezone: getTimezone(),
    screenWidth: Math.round(width),
    screenHeight: Math.round(height),
    language: getLanguage(),
  };
}

/**
 * Get device timezone
 */
function getTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * Get device language in BCP 47 format
 */
function getLanguage(): string | undefined {
  try {
    // In React Native, we can access the locale through various means
    // The most reliable is through the Intl API
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale;
  } catch {
    return undefined;
  }
}
