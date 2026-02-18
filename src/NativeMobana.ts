import { NativeModules, Platform } from 'react-native';

/**
 * Native module interface for platform-specific functionality
 * Currently used for Android Install Referrer
 */
interface NativeMobanaModule {
  /**
   * Get the Install Referrer string from Android Play Store
   * Returns null on iOS or if referrer is not available
   */
  getInstallReferrer(): Promise<string | null>;
}

// Try to get the native module, fallback to stub if not available
const NativeMobana: NativeMobanaModule | null =
  NativeModules.Mobana
    ? NativeModules.Mobana
    : new Proxy(
        {},
        {
          get() {
            // Return null instead of throwing to support Expo Go / web
            return () => Promise.resolve(null);
          },
        }
      ) as NativeMobanaModule;

/**
 * Get Android Install Referrer
 * Extracts the dacid (Mobana Click ID) from the referrer string
 */
export async function getInstallReferrer(): Promise<string | null> {
  if (Platform.OS !== 'android') {
    return null;
  }

  try {
    const referrer = await NativeMobana?.getInstallReferrer();
    
    if (!referrer) {
      return null;
    }

    // Parse referrer string to extract dacid parameter
    // Format: "utm_source=...&dacid=abc123&..."
    const params = new URLSearchParams(referrer);
    return params.get('dacid');
  } catch {
    // Install Referrer not available (e.g., not installed from Play Store)
    return null;
  }
}

/**
 * Check if native module is available
 * Used to determine if we can use Install Referrer
 */
export function isNativeModuleAvailable(): boolean {
  return NativeModules.Mobana != null;
}
