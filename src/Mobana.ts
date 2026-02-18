import type {
  MobanaConfig,
  GetAttributionOptions,
  Attribution,
  ConversionEvent,
  FlowResult,
  FlowOptions,
  FlowConfig,
} from './types';
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
  clearAllCachedFlows,
  clearLocalData,
} from './storage';
import { findAttribution, trackConversionApi, fetchFlow } from './api';
import { getDeviceInfo } from './device';
import { getInstallReferrer } from './NativeMobana';
import { getGlobalFlowContext } from './components/MobanaProvider';

const DEFAULT_ENDPOINT = 'https://{appId}.mobana.ai';
const DEFAULT_TIMEOUT = 10000;

/**
 * Mobana SDK for React Native
 * 
 * Simple, privacy-focused mobile app attribution, conversions, and remote flows.
 * 
 * @example
 * ```typescript
 * import { Mobana, MobanaProvider } from '@mobana/react-native-sdk';
 * 
 * // Wrap your app with the provider (in App.tsx)
 * function App() {
 *   return (
 *     <MobanaProvider>
 *       <YourApp />
 *     </MobanaProvider>
 *   );
 * }
 * 
 * // Initialize once on app start
 * await Mobana.init({ appId: 'a1b2c3d4' });
 * 
 * // Get attribution (handles caching, retries, Android Install Referrer)
 * const attribution = await Mobana.getAttribution();
 * 
 * // Track conversions
 * Mobana.trackConversion('signup');
 * Mobana.trackConversion('purchase', 49.99);
 * 
 * // Show a flow
 * const result = await Mobana.startFlow('onboarding');
 * if (result.completed) {
 *   console.log('User completed onboarding!', result.data);
 * }
 * ```
 */
class MobanaSDK {
  private config: MobanaConfig | null = null;
  private isConfigured = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private attributionPromise: Promise<Attribution<any> | null> | null = null;
  // In-memory cache for attribution (faster than AsyncStorage)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cachedAttribution: Attribution<any> | null = null;
  private attributionChecked = false;

  /**
   * Initialize the SDK with your app settings
   * Must be called before any other SDK methods
   * 
   * @param config - Configuration options (appId is required)
   * 
   * @example
   * ```typescript
   * // Basic initialization
   * await Mobana.init({ appId: 'a1b2c3d4' });
   * 
   * // With custom endpoint (for domain proxying)
   * await Mobana.init({
   *   appId: 'a1b2c3d4',
   *   endpoint: 'https://myapp.com/d',
   * });
   * 
   * // With all options
   * await Mobana.init({
   *   appId: 'a1b2c3d4',
   *   endpoint: 'https://myapp.com/d',   // Optional
   *   enabled: userHasConsented,         // Optional, default: true
   *   debug: __DEV__,                    // Optional, default: false
   * });
   * ```
   */
  async init(config: MobanaConfig): Promise<void> {
    if (!config.appId) {
      console.warn('[Mobana] appId is required');
      return;
    }
    if (!config.appKey) {
      console.warn('[Mobana] appKey is required');
      return;
    }

    this.config = {
      enabled: true,
      debug: false,
      ...config,
    };
    this.isConfigured = true;

    // Eagerly generate/retrieve the install ID so it's ready before
    // the first attribution or conversion call.
    const installId = await getInstallId();

    if (this.config.debug) {
      console.log('[Mobana] Initialized:', {
        appId: this.config.appId,
        endpoint: this.config.endpoint,
        enabled: this.config.enabled,
        installId,
      });
    }

    // Flush any queued conversions when SDK is initialized
    await this.flushConversionQueue();
  }

  /**
   * Enable or disable the SDK dynamically
   * Useful for GDPR consent flows
   * 
   * @param enabled - Whether the SDK should be enabled
   */
  setEnabled(enabled: boolean): void {
    if (!this.config) {
      console.warn('[Mobana] SDK not configured. Call init() first.');
      return;
    }

    this.config.enabled = enabled;

    if (this.config.debug) {
      console.log(`[Mobana] ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    if (enabled) {
      this.flushConversionQueue();
    }
  }

  /**
   * Get attribution data for this install
   * 
   * Returns cached result if available, otherwise fetches from server.
   * Never throws - returns null on error or no match.
   * 
   * @param options - Optional settings for the attribution request
   * @returns Attribution data or null if not available
   * 
   * @example
   * ```typescript
   * const attribution = await Mobana.getAttribution();
   * 
   * if (attribution) {
   *   YourAnalyticsProvider.track('App Installed', {
   *     source: attribution.utm_source,
   *     campaign: attribution.utm_campaign,
   *   });
   * 
   *   if (attribution.data?.promo) {
   *     applyPromoCode(attribution.data.promo);
   *   }
   * }
   * ```
   * 
   * @example
   * // With TypeScript generics for typed data
   * interface MyDeeplinkData {
   *   promo?: string;
   *   referrer?: string;
   * }
   * 
   * const attribution = await Mobana.getAttribution<MyDeeplinkData>();
   * // attribution.data is now typed as MyDeeplinkData
   */
  async getAttribution<T = Record<string, unknown>>(
    options: GetAttributionOptions = {}
  ): Promise<Attribution<T> | null> {
    if (!this.isConfigured || !this.config) {
      console.warn('[Mobana] SDK not configured. Call init() first.');
      return null;
    }

    if (!this.config.enabled) {
      if (this.config.debug) {
        console.log('[Mobana] SDK disabled, returning null');
      }
      return null;
    }

    // Return in-memory cache if available (fastest)
    if (this.attributionChecked) {
      return this.cachedAttribution as Attribution<T> | null;
    }

    // Check AsyncStorage cache
    const cached = await getCachedResult<T>();
    if (cached) {
      if (this.config.debug) {
        console.log('[Mobana] Returning cached result, matched:', cached.matched);
      }
      // Update in-memory cache
      this.attributionChecked = true;
      this.cachedAttribution = cached.matched ? (cached.attribution ?? null) : null;
      return this.cachedAttribution as Attribution<T> | null;
    }

    // Prevent duplicate concurrent requests
    if (this.attributionPromise) {
      return this.attributionPromise as Promise<Attribution<T> | null>;
    }

    this.attributionPromise = this.fetchAttribution<T>(options);
    const result = await this.attributionPromise;
    this.attributionPromise = null;

    // Update in-memory cache
    this.attributionChecked = true;
    this.cachedAttribution = result;

    return result;
  }

  /**
   * Track a conversion event
   * 
   * Conversions are linked to the original attribution via installId.
   * If offline, conversions are queued and sent when back online.
   * Never throws - silently handles errors.
   * 
   * @param name - Conversion name (must be configured in app settings)
   * @param value - Optional monetary value
   * @param flowSessionId - Optional flow session ID to link conversion to a specific flow presentation
   * 
   * @example
   * ```typescript
   * // Simple conversion
   * Mobana.trackConversion('signup');
   * 
   * // Conversion with value
   * Mobana.trackConversion('purchase', 49.99);
   * 
   * // Conversion linked to a flow session
   * const result = await Mobana.startFlow('pre-purchase');
   * // ... user makes purchase via paywall ...
   * await Mobana.trackConversion('purchase', 49.99, result.sessionId);
   * ```
   */
  async trackConversion(name: string, value?: number, flowSessionId?: string): Promise<void> {
    if (!this.isConfigured || !this.config) {
      if (this.config?.debug) {
        console.log('[Mobana] SDK not configured, skipping conversion');
      }
      return;
    }

    if (!this.config.enabled) {
      if (this.config.debug) {
        console.log('[Mobana] SDK disabled, skipping conversion');
      }
      return;
    }

    const installId = await getInstallId();
    
    const event: ConversionEvent = {
      installId,
      name,
      value,
      timestamp: Date.now(),
      flowSessionId,
    };

    // Ensure Install record exists on server (created on first getAttribution call).
    // This is fast after first call — returns from in-memory cache without network.
    // We don't care about the result; conversions work for organic installs too.
    await this.getAttribution();

    // Try to send immediately
    const success = await this.sendConversion(event);
    
    if (!success) {
      // Queue for later if failed (offline, etc.)
      await queueConversion(event);
      
      if (this.config.debug) {
        console.log('[Mobana] Conversion queued for later');
      }
    }
  }

  /**
   * Reset all stored attribution data
   * Useful for testing or when user logs out
   * 
   * Note: This generates a new installId, so subsequent attributions
   * will be treated as a new install.
   */
  async reset(): Promise<void> {
    // Clear in-memory cache
    this.cachedAttribution = null;
    this.attributionChecked = false;
    this.attributionPromise = null;

    // Clear persistent storage
    await clearAttribution();
    await clearConversionQueue();
    await clearAllCachedFlows();
    await clearLocalData();
    
    if (this.config?.debug) {
      console.log('[Mobana] Reset complete');
    }
  }

  // ============================================
  // Flows
  // ============================================

  /**
   * Start and display a flow
   * 
   * Fetches the flow content (or uses cache) and presents it in a full-screen modal.
   * The promise resolves when the user completes or dismisses the flow.
   * 
   * Requires MobanaProvider to be mounted in your app.
   * 
   * @param slug - Flow identifier (from dashboard)
   * @param options - Optional flow configuration
   * @returns Flow result with completion status and optional data
   * 
   * @example
   * ```typescript
   * // Basic usage
   * const result = await Mobana.startFlow('onboarding');
   * 
   * if (result.completed) {
   *   console.log('Onboarding completed!', result.data);
   * } else if (result.error) {
   *   console.log('Flow error:', result.error);
   * }
   * 
   * // With custom parameters
   * const result = await Mobana.startFlow('welcome', {
   *   params: { userName: 'John', isPremium: true },
   *   onEvent: (name) => {
   *     analytics.track(name);
   *   },
   * });
   * ```
   */
  async startFlow(slug: string, options?: FlowOptions): Promise<FlowResult> {
    // Check if SDK is configured
    if (!this.isConfigured || !this.config) {
      console.warn('[Mobana] SDK not configured. Call init() first.');
      return { completed: false, dismissed: true, error: 'SDK_NOT_CONFIGURED' };
    }

    // Check if SDK is enabled
    if (!this.config.enabled) {
      if (this.config.debug) {
        console.log('[Mobana] SDK disabled, cannot start flow');
      }
      return { completed: false, dismissed: true, error: 'SDK_NOT_CONFIGURED' };
    }

    // Check if provider is mounted
    const flowContext = getGlobalFlowContext();
    if (!flowContext?.isProviderMounted) {
      console.warn(
        '[Mobana] startFlow() called but MobanaProvider is not mounted. ' +
        'Wrap your app with <MobanaProvider> to enable flows.'
      );
      return { completed: false, dismissed: true, error: 'PROVIDER_NOT_MOUNTED' };
    }

    try {
      const endpoint = this.getEndpoint();
      const installId = await getInstallId();

      // Ensure attribution is loaded (for passing to flow context).
      // Fast after first call — returns from in-memory cache without network.
      // We don't fail if attribution isn't matched; flows work for organic installs too.
      await this.getAttribution();

      // Check cache for this flow
      const cached = await getCachedFlow(slug);

      if (this.config.debug) {
        console.log(`[Mobana] Starting flow: ${slug}`, {
          hasCached: !!cached,
          cachedVersionId: cached?.versionId,
        });
      }

      // Fetch flow from server (with cache validation)
      const response = await fetchFlow(
        endpoint,
        this.config.appKey,
        slug,
        installId,
        cached?.versionId,
        DEFAULT_TIMEOUT,
        this.config.debug
      );

      // Handle network error
      if (!response) {
        // If we have a cached version, use it
        if (cached) {
          if (this.config.debug) {
            console.log('[Mobana] Network error, using cached flow');
          }
          return this.presentFlowToUser(flowContext, {
            slug,
            config: cached,
            installId,
            endpoint,
            appKey: this.config.appKey,
            options,
          });
        }
        return { completed: false, dismissed: true, error: 'NETWORK_ERROR' };
      }

      // Handle server errors
      if (response.error) {
        if (this.config.debug) {
          console.log(`[Mobana] Flow error: ${response.error}`);
        }
        return { completed: false, dismissed: true, error: response.error as FlowResult['error'] };
      }

      // Determine flow content to use
      let flowConfig: FlowConfig;

      if (response.cached && cached) {
        // Server confirmed our cached version is current
        flowConfig = cached;
        if (this.config.debug) {
          console.log('[Mobana] Using cached flow (validated)');
        }
      } else if (response.versionId && response.html) {
        // New content from server
        flowConfig = {
          versionId: response.versionId,
          html: response.html,
          css: response.css,
          js: response.js,
        };
        // Cache for next time
        await setCachedFlow(slug, flowConfig);
        if (this.config.debug) {
          console.log('[Mobana] Using fresh flow, cached for next time');
        }
      } else {
        // Unexpected response
        if (this.config.debug) {
          console.log('[Mobana] Unexpected flow response');
        }
        return { completed: false, dismissed: true, error: 'SERVER_ERROR' };
      }

      // Present the flow
      return this.presentFlowToUser(flowContext, {
        slug,
        config: flowConfig,
        installId,
        endpoint,
        appKey: this.config.appKey,
        options,
      });
    } catch (error) {
      if (this.config.debug) {
        console.log('[Mobana] Error starting flow:', error);
      }
      return { completed: false, dismissed: true, error: 'SERVER_ERROR' };
    }
  }

  /**
   * Prefetch a flow for faster display later
   * 
   * Downloads and caches the flow content without displaying it.
   * Call this ahead of time if you know a flow will be shown soon.
   * 
   * @param slug - Flow identifier (from dashboard)
   * 
   * @example
   * ```typescript
   * // Prefetch during app startup
   * Mobana.prefetchFlow('onboarding');
   * 
   * // Later, when ready to show (will be instant if prefetched)
   * const result = await Mobana.startFlow('onboarding');
   * ```
   */
  async prefetchFlow(slug: string): Promise<void> {
    if (!this.isConfigured || !this.config) {
      return;
    }

    if (!this.config.enabled) {
      return;
    }

    try {
      const endpoint = this.getEndpoint();
      const installId = await getInstallId();
      const cached = await getCachedFlow(slug);

      if (this.config.debug) {
        console.log(`[Mobana] Prefetching flow: ${slug}`);
      }

      const response = await fetchFlow(
        endpoint,
        this.config.appKey,
        slug,
        installId,
        cached?.versionId,
        DEFAULT_TIMEOUT,
        this.config.debug
      );

      if (response && !response.error && !response.cached && response.versionId && response.html) {
        // Cache the new content
        await setCachedFlow(slug, {
          versionId: response.versionId,
          html: response.html,
          css: response.css,
          js: response.js,
        });
        if (this.config.debug) {
          console.log(`[Mobana] Flow "${slug}" prefetched and cached`);
        }
      } else if (response?.cached) {
        if (this.config.debug) {
          console.log(`[Mobana] Flow "${slug}" already cached and current`);
        }
      }
    } catch (error) {
      if (this.config.debug) {
        console.log('[Mobana] Error prefetching flow:', error);
      }
    }
  }

  /**
   * Present a flow to the user via the provider
   */
  private presentFlowToUser(
    flowContext: NonNullable<ReturnType<typeof getGlobalFlowContext>>,
    params: {
      slug: string;
      config: FlowConfig;
      installId: string;
      endpoint: string;
      appKey: string;
      options?: FlowOptions;
    }
  ): Promise<FlowResult> {
    return new Promise((resolve) => {
      flowContext.presentFlow({
        slug: params.slug,
        config: params.config,
        installId: params.installId,
        endpoint: params.endpoint,
        appKey: params.appKey,
        attribution: this.cachedAttribution,
        options: params.options,
        resolve,
        debug: this.config?.debug,
      });
    });
  }

  // ============================================
  // Private methods
  // ============================================

  private getEndpoint(): string {
    if (this.config?.endpoint) {
      // Remove trailing slash
      return this.config.endpoint.replace(/\/$/, '');
    }
    
    if (this.config?.appId) {
      return DEFAULT_ENDPOINT.replace('{appId}', this.config.appId);
    }
    
    throw new Error('No endpoint configured');
  }

  private async fetchAttribution<T = Record<string, unknown>>(
    options: GetAttributionOptions
  ): Promise<Attribution<T> | null> {
    const { timeout = DEFAULT_TIMEOUT } = options;

    try {
      const endpoint = this.getEndpoint();
      const installId = await getInstallId();
      const deviceInfo = getDeviceInfo();

      if (this.config?.debug) {
        console.log('[Mobana] Fetching attribution...');
        console.log('[Mobana] Device info:', deviceInfo);
      }

      // Get Android Install Referrer for deterministic attribution
      let dacid: string | null = null;
      if (deviceInfo.platform === 'android') {
        dacid = await getInstallReferrer();
        
        if (this.config?.debug) {
          console.log('[Mobana] Install Referrer dacid:', dacid || '(not available)');
        }
      }

      // Make API request
      const response = await findAttribution<T>(
        endpoint,
        this.config!.appKey,
        installId,
        deviceInfo,
        dacid,
        timeout,
        this.config?.debug ?? false
      );

      // If no response (network error, timeout), don't cache - allow retry
      if (!response) {
        if (this.config?.debug) {
          console.log('[Mobana] No response from server');
        }
        return null;
      }

      // Cache the response if server returned a valid response with matched key
      // This prevents retrying on every startup
      if (typeof response.matched === 'boolean') {
        if (response.matched && response.attribution) {
          // Build attribution object
          const attribution: Attribution<T> = {
            ...response.attribution,
            confidence: response.confidence ?? 0,
          };

          // Cache matched result
          await setCachedResult(true, attribution);

          if (this.config?.debug) {
            console.log('[Mobana] Attribution matched:', attribution);
          }

          return attribution;
        } else {
          // Cache unmatched result - prevents retry on next startup
          await setCachedResult<T>(false);

          if (this.config?.debug) {
            console.log('[Mobana] No match found (cached)');
          }

          return null;
        }
      }

      // Unexpected response format
      if (this.config?.debug) {
        console.log('[Mobana] Unexpected response format');
      }
      return null;
    } catch (error) {
      if (this.config?.debug) {
        console.log('[Mobana] Error fetching attribution:', error);
      }
      return null;
    }
  }

  private async sendConversion(event: ConversionEvent): Promise<boolean> {
    try {
      const endpoint = this.getEndpoint();
      return await trackConversionApi(endpoint, this.config!.appKey, event, this.config?.debug ?? false);
    } catch {
      return false;
    }
  }

  private async flushConversionQueue(): Promise<void> {
    if (!this.config?.enabled) {
      return;
    }

    const queue = await getConversionQueue();
    
    if (queue.length === 0) {
      return;
    }

    if (this.config?.debug) {
      console.log(`[Mobana] Flushing ${queue.length} queued conversions`);
    }

    // Send all queued conversions
    const results = await Promise.all(
      queue.map((event) => this.sendConversion(event))
    );

    // Clear the queue, then re-queue only the failures (avoids duplicate sends)
    await clearConversionQueue();
    const failed = queue.filter((_, i) => !results[i]);
    for (const event of failed) {
      await queueConversion(event);
    }
  }
}

// Export class for testing (create fresh instances without shared state)
export { MobanaSDK };

// Export singleton instance
export const Mobana = new MobanaSDK();
