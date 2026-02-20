/**
 * Configuration options for Mobana SDK
 */
export interface MobanaConfig {
  /**
   * Your Mobana app ID from the dashboard (e.g., 'a1b2c3d4')
   * Required.
   */
  appId: string;

  /**
   * Your Mobana app key from the dashboard. Sent as X-App-Key header.
   * Required. Regenerate from dashboard if leaked.
   */
  appKey: string;

  /**
   * Custom endpoint URL for attribution API
   * Optional. Use this if proxying through your own domain (e.g., 'https://myapp.com/d')
   * If not set, defaults to https://{appId}.mobana.ai
   */
  endpoint?: string;

  /**
   * Enable or disable the SDK (default: true)
   * Set to false to disable all attribution tracking (e.g., for GDPR opt-out)
   */
  enabled?: boolean;

  /**
   * Enable debug logging (default: false)
   * When true, logs SDK operations to console
   */
  debug?: boolean;

  /**
   * Automatically fetch attribution when init() is called (default: true)
   *
   * When true, attribution is fetched in the background on init — non-blocking.
   * The result is cached so any subsequent getAttribution() call returns instantly.
   *
   * Set to false to delay attribution until you explicitly call getAttribution()
   * (e.g., to wait for GDPR consent before making any network calls).
   */
  autoAttribute?: boolean;
}

// ============================================
// Flow Types
// ============================================

/**
 * Flow content returned from the API
 */
export interface FlowConfig {
  /** Unique version identifier (immutable) */
  versionId: string;
  /** HTML content of the flow */
  html: string;
  /** CSS styles (may be embedded in HTML) */
  css?: string;
  /** JavaScript code (may be embedded in HTML) */
  js?: string;
}

/**
 * Result returned from startFlow()
 */
export interface FlowResult {
  /** Whether the flow was completed (user called Mobana.complete()) */
  completed: boolean;
  /** Whether the flow was dismissed (user called Mobana.dismiss()) */
  dismissed: boolean;
  /** Error code if flow couldn't be shown */
  error?: FlowError;
  /** Custom data passed to Mobana.complete(data) */
  data?: Record<string, unknown>;
  /** Session ID for this flow presentation (use with trackConversion's flowSessionId) */
  sessionId?: string;
  /**
   * Track a custom event for this flow session after the flow has closed.
   * Useful for tracking events that happen after the flow (e.g., purchase after onboarding).
   * 
   * @param event - Event name (e.g., 'purchase_completed', 'feature_used')
   * @param data - Optional event data (will be stored as JSON)
   * @returns Promise resolving to true if event was tracked successfully
   * 
   * @example
   * ```typescript
   * const result = await Mobana.startFlow('pre-purchase');
   * // ... user makes purchase via Adapty ...
   * await result.trackEvent('purchase_initiated');
   * ```
   */
  trackEvent?: (event: string, data?: Record<string, unknown>) => Promise<boolean>;
}

/**
 * Possible flow error codes
 */
export type FlowError =
  | 'NOT_FOUND'           // Flow doesn't exist or is disabled
  | 'PLAN_REQUIRED'       // App's plan doesn't include flows
  | 'FLOW_LIMIT_EXCEEDED' // Flow view quota exceeded (free plan hard limit)
  | 'NETWORK_ERROR'       // Network request failed
  | 'SERVER_ERROR'        // Server returned an error
  | 'PROVIDER_NOT_MOUNTED' // MobanaProvider not in component tree
  | 'SDK_NOT_CONFIGURED'; // SDK.init() not called

/**
 * Options for startFlow()
 */
export interface FlowOptions {
  /**
   * Custom parameters available in the flow via Mobana.getParams()
   * Use this to pass context to your flow (e.g., user name, feature flags)
   */
  params?: Record<string, unknown>;
  
  /**
   * Callback when flow emits custom events via Mobana.trackEvent()
   * Useful for analytics integration
   */
  onEvent?: (event: string) => void;

  /**
   * Async callback invoked when the flow calls Mobana.requestCallback(data).
   * Allows the flow to request the app to perform an action (e.g., trigger a purchase,
   * validate a promo code) and await the result — without closing the flow.
   * 
   * @param data - Arbitrary data sent from the flow
   * @returns Promise resolving to arbitrary data returned to the flow
   * 
   * @example
   * ```typescript
   * const result = await Mobana.startFlow('paywall', {
   *   onCallback: async (data) => {
   *     if (data.action === 'purchase') {
   *       const purchase = await purchaseManager.buy(data.planId);
   *       return { success: purchase.success, receipt: purchase.receipt };
   *     }
   *     return { error: 'Unknown action' };
   *   },
   * });
   * ```
   */
  onCallback?: (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/**
 * Cached flow content (stored in AsyncStorage)
 */
export interface CachedFlow {
  versionId: string;
  html: string;
  css?: string;
  js?: string;
  cachedAt: number;
}

/**
 * API response from GET /api/flows/[slug]
 */
export interface FlowFetchResponse {
  /** True if client's cached version is still current */
  cached?: boolean;
  /** Version ID (always present if not an error) */
  versionId?: string;
  /** HTML content (present if not cached) */
  html?: string;
  /** CSS content (present if not cached) */
  css?: string;
  /** JS content (present if not cached) */
  js?: string;
  /** Error code if flow unavailable */
  error?: string;
}

/**
 * Flow event to send to the server
 */
export interface FlowEvent {
  installId: string;
  versionId: string;
  sessionId: string;
  event: string;
  step?: number;
  data?: unknown;
}

// ============================================
// Bridge Types (for WebView communication)
// ============================================

/**
 * Haptic feedback styles
 */
export type HapticStyle = 
  | 'light' 
  | 'medium' 
  | 'heavy' 
  | 'success' 
  | 'warning' 
  | 'error'
  | 'selection';

/**
 * Location permission status
 */
export type LocationPermissionStatus = 
  | 'granted'
  | 'denied' 
  | 'blocked'
  | 'unavailable'
  | 'limited';

/**
 * ATT (App Tracking Transparency) status (iOS only)
 */
export type ATTStatus = 
  | 'authorized'
  | 'denied'
  | 'not-determined'
  | 'restricted';

/**
 * Device color scheme (light/dark mode)
 */
export type ColorScheme = 'light' | 'dark';

/**
 * Location coordinates
 */
export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

/**
 * Message from WebView to native
 */
export interface BridgeMessage {
  type: string;
  requestId?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

/**
 * Options for getAttribution call
 */
export interface GetAttributionOptions {
  /**
   * Timeout in milliseconds for the attribution request (default: 10000)
   */
  timeout?: number;
}

/**
 * Attribution data returned from the API
 */
export interface Attribution<T = Record<string, unknown>> {
  /**
   * Traffic source (e.g., 'facebook', 'google', 'tiktok')
   */
  utm_source?: string;

  /**
   * Marketing medium (e.g., 'cpc', 'social', 'email')
   */
  utm_medium?: string;

  /**
   * Campaign name
   */
  utm_campaign?: string;

  /**
   * Ad content identifier
   */
  utm_content?: string;

  /**
   * Search keywords
   */
  utm_term?: string;

  /**
   * Referring domain that sent the user to the tracking link (e.g., 'facebook.com')
   * Only the domain is stored (not the full URL) for privacy.
   */
  referrer_domain?: string;

  /**
   * Custom deeplink data passed through the attribution flow
   * Use generics for type-safe access: getAttribution<MyDataType>()
   */
  data?: T;

  /**
   * Match confidence score (0.0 - 1.0)
   * - 1.0 = Deterministic match via Android Install Referrer
   * - < 1.0 = Probabilistic match
   */
  confidence: number;
}

/**
 * Error details returned when an attribution request fails
 */
export interface AttributionError {
  /**
   * Type of error:
   * - 'network' — no internet connection or request was blocked
   * - 'timeout' — request exceeded the timeout limit
   * - 'server' — server returned an HTTP error
   * - 'sdk_not_configured' — SDK.init() was not called before getAttribution()
   * - 'sdk_disabled' — SDK is disabled (enabled: false in config)
   * - 'unknown' — unexpected error
   */
  type: 'network' | 'timeout' | 'server' | 'sdk_not_configured' | 'sdk_disabled' | 'unknown';
  /** HTTP status code (only present for 'server' type) */
  status?: number;
}

/**
 * Result returned by getAttribution()
 */
export interface AttributionResult<T = Record<string, unknown>> {
  /**
   * Attribution status:
   * - 'matched' — attribution data found; check the attribution field
   * - 'no_match' — no match found (organic install)
   * - 'error' — request failed or SDK is misconfigured; check the error field for details
   */
  status: 'matched' | 'no_match' | 'error';
  /** Attribution data. Present only when status is 'matched'. */
  attribution: Attribution<T> | null;
  /** Error details. Present only when status is 'error'. */
  error?: AttributionError;
}

/**
 * Internal: API response from /find endpoint
 */
export interface FindResponse<T = Record<string, unknown>> {
  matched: boolean;
  attribution?: Attribution<T>;
  confidence?: number;
}

/**
 * Internal: Cached attribution result (includes matched: false responses)
 */
export interface CachedAttributionResult<T = Record<string, unknown>> {
  matched: boolean;
  attribution?: Attribution<T>;
  checkedAt: number;
}

/**
 * Internal: Conversion event to be sent or queued
 */
export interface ConversionEvent {
  installId: string;
  name: string;
  value?: number;
  timestamp: number;
  /** Optional flow session ID to link conversion to a specific flow presentation */
  flowSessionId?: string;
}

/**
 * Internal: Device info collected for attribution matching
 */
export interface DeviceInfo {
  platform: 'ios' | 'android';
  timezone?: string;
  screenWidth?: number;
  screenHeight?: number;
  language?: string;
}

/**
 * Safe area insets for the device screen
 * Represents the areas of the screen that may be obscured by system UI
 * (status bar, notch/dynamic island, home indicator, etc.)
 */
export interface SafeArea {
  /** Inset from top (status bar, notch, dynamic island) in points */
  top: number;
  /** Inset from bottom (home indicator, navigation bar) in points */
  bottom: number;
  /** Inset from left (typically 0, but can be non-zero in landscape) in points */
  left: number;
  /** Inset from right (typically 0, but can be non-zero in landscape) in points */
  right: number;
  /** Full screen width in points */
  width: number;
  /** Full screen height in points */
  height: number;
}
