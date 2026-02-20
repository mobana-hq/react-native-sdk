import React, { useRef, useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Vibration,
  Platform,
  Dimensions,
  useColorScheme,
} from 'react-native';
import type { WebView as WebViewType, WebViewMessageEvent } from 'react-native-webview';
import type {
  FlowConfig,
  FlowResult,
  Attribution,
  BridgeMessage,
  HapticStyle,
  SafeArea,
} from '../types';
import { generateBridgeScript, buildFlowHtml } from '../bridge/injectBridge';
import { setLocalData, getAllLocalData, getLocalData } from '../storage';
import { trackFlowEvent } from '../api';

// Optional peer dependencies - gracefully handle if not installed
let HapticFeedback: {
  trigger: (type: string, options?: { enableVibrateFallback?: boolean }) => void;
} | null = null;
let Geolocation: {
  getCurrentPosition: (
    success: (position: { coords: GeolocationCoordinates; timestamp: number }) => void,
    error: (error: { code: number; message: string }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }
  ) => void;
} | null = null;

// react-native-permissions types
type PermissionStatus = 'unavailable' | 'denied' | 'limited' | 'granted' | 'blocked';
interface NotificationSettings {
  alert?: boolean;
  badge?: boolean;
  sound?: boolean;
  carPlay?: boolean;
  criticalAlert?: boolean;
  provisional?: boolean;
  providesAppSettings?: boolean;
  lockScreen?: boolean;
  notificationCenter?: boolean;
}
interface PermissionsModule {
  check: (permission: string) => Promise<PermissionStatus>;
  request: (permission: string) => Promise<PermissionStatus>;
  checkNotifications: () => Promise<{ status: PermissionStatus; settings: NotificationSettings }>;
  requestNotifications: (options: string[]) => Promise<{ status: PermissionStatus; settings: NotificationSettings }>;
  openSettings: () => Promise<void>;
  PERMISSIONS: {
    IOS: {
      APP_TRACKING_TRANSPARENCY: string;
      LOCATION_WHEN_IN_USE: string;
      LOCATION_ALWAYS: string;
    };
    ANDROID: {
      ACCESS_FINE_LOCATION: string;
      ACCESS_COARSE_LOCATION: string;
      ACCESS_BACKGROUND_LOCATION: string;
    };
  };
  RESULTS: {
    UNAVAILABLE: PermissionStatus;
    DENIED: PermissionStatus;
    LIMITED: PermissionStatus;
    GRANTED: PermissionStatus;
    BLOCKED: PermissionStatus;
  };
}

let Permissions: PermissionsModule | null = null;

interface GeolocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
}

let hapticFeedbackWarningShown = false;
let geolocationWarningShown = false;
let permissionsWarningShown = false;

// Storage keys for tracking permission request states (for "not_requested" detection on Android)
const LOCATION_REQUESTED_KEY = '@mobana:location_requested';
const BACKGROUND_LOCATION_REQUESTED_KEY = '@mobana:bg_location_requested';

/**
 * Show warning about missing react-native-permissions and return unavailable response
 */
function warnPermissionsNotInstalled(feature: string): void {
  if (!permissionsWarningShown) {
    permissionsWarningShown = true;
    console.warn(
      `[Mobana] react-native-permissions is not installed. ` +
      `Permission features (${feature}) will not work. To enable permission handling in Flows, install: ` +
      `npm install react-native-permissions\n` +
      `See: https://github.com/zoontek/react-native-permissions for setup instructions.`
    );
  }
}

/**
 * Location permission status object returned by getLocationPermissionStatus
 */
interface LocationPermissionStatus {
  foreground: 'granted' | 'denied' | 'blocked' | 'not_requested';
  background: 'granted' | 'denied' | 'blocked' | 'not_requested';
  precision: 'precise' | 'coarse' | 'unknown';
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  HapticFeedback = require('react-native-haptic-feedback').default;
} catch {
  // Not installed - will use Vibration fallback
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Geolocation = require('react-native-geolocation-service').default;
} catch {
  // Not installed
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Permissions = require('react-native-permissions');
} catch {
  // Not installed - permission features will show warning when used
}

// Safe area context - try to import for accurate insets
let SafeAreaContext: {
  useSafeAreaInsets?: () => { top: number; bottom: number; left: number; right: number };
  initialWindowMetrics?: { insets: { top: number; bottom: number; left: number; right: number } } | null;
} | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SafeAreaContext = require('react-native-safe-area-context');
} catch {
  // Not installed - will use platform defaults
}

// WebView - required for flows, but loaded dynamically to avoid build failure if not installed
// MobanaProvider checks for availability before rendering FlowWebView
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let WebView: React.ComponentType<any> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  WebView = require('react-native-webview').WebView;
} catch {
  // Not installed - MobanaProvider will handle this case
}

/**
 * Get safe area insets with fallback to platform defaults
 */
function getSafeAreaInsets(): { top: number; bottom: number; left: number; right: number } {
  // Try to get from initialWindowMetrics (available at module load time)
  if (SafeAreaContext?.initialWindowMetrics?.insets) {
    return SafeAreaContext.initialWindowMetrics.insets;
  }
  
  // Fall back to reasonable platform-specific defaults
  if (Platform.OS === 'ios') {
    // Modern iPhones with notch/dynamic island: ~59pt top (47pt status + 12pt extra for island)
    // Home indicator: ~34pt bottom
    // Older iPhones: ~20pt status bar, 0pt bottom
    const { height } = Dimensions.get('window');
    const hasNotch = height >= 812; // iPhone X and later
    return {
      top: hasNotch ? 59 : 20,
      bottom: hasNotch ? 34 : 0,
      left: 0,
      right: 0,
    };
  } else {
    // Android: typically ~24-32pt for status bar, ~48pt for gesture nav
    return {
      top: 24,
      bottom: 0, // Android gesture nav is usually handled by system
      left: 0,
      right: 0,
    };
  }
}

export interface FlowWebViewProps {
  /** Flow configuration (HTML, CSS, JS) */
  config: FlowConfig;
  /** Flow slug identifier */
  slug: string;
  /** Install ID for tracking */
  installId: string;
  /** API endpoint */
  endpoint: string;
  /** App key for X-App-Key header */
  appKey: string;
  /** Attribution data to pass to flow */
  attribution: Attribution | null;
  /** Custom parameters to pass to flow */
  params?: Record<string, unknown>;
  /** Session ID for grouping all events from this flow presentation */
  sessionId: string;
  /** Called when flow is completed */
  onComplete: (data?: Record<string, unknown>) => void;
  /** Called when flow is dismissed */
  onDismiss: () => void;
  /** Called when flow emits a custom event */
  onEvent?: (name: string) => void;
  /** Async callback for flow-initiated app actions (e.g., purchases) */
  onCallback?: (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Custom props forwarded to the underlying WebView */
  webViewProps?: Record<string, unknown>;
  /**
   * Background color shown behind the flow while it loads.
   * Pass a string for a static color, or an object to match the system theme.
   * Defaults to #FFFFFF (light) / #1c1c1e (dark).
   */
  backgroundColor?: string | { light: string; dark: string };
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Internal WebView component for rendering flows
 * Handles bridge communication between flow JS and native capabilities
 */
export function FlowWebView({
  config,
  slug,
  installId,
  endpoint,
  appKey,
  attribution,
  params = {},
  sessionId,
  onComplete,
  onDismiss,
  onEvent,
  onCallback,
  webViewProps,
  backgroundColor,
  debug = false,
}: FlowWebViewProps) {
  const webViewRef = useRef<WebViewType>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const bgColor = backgroundColor
    ? typeof backgroundColor === 'string'
      ? backgroundColor
      : isDark ? backgroundColor.dark : backgroundColor.light
    : isDark ? '#1c1c1e' : '#FFFFFF';

  // Build HTML with bridge on mount
  useEffect(() => {
    const buildHtml = async () => {
      const localData = await getAllLocalData();
      const insets = getSafeAreaInsets();
      const { width, height } = Dimensions.get('window');
      
      const safeArea: SafeArea = {
        ...insets,
        width,
        height,
      };
      
      const bridgeScript = generateBridgeScript({
        attribution,
        params,
        installId,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        colorScheme: colorScheme === 'dark' ? 'dark' : 'light',
        localData,
        safeArea,
      });

      const fullHtml = buildFlowHtml(
        config.html,
        config.css,
        config.js,
        bridgeScript,
        safeArea,
        colorScheme === 'dark' ? 'dark' : 'light'
      );

      setHtmlContent(fullHtml);
    };

    buildHtml();
  }, [config, attribution, params, installId, colorScheme]);

  // Send response back to WebView for async requests
  const sendResponse = useCallback((requestId: number, success: boolean, result: unknown) => {
    const js = `window.__mobanaBridgeResponse(${requestId}, ${success}, ${JSON.stringify(result)});`;
    webViewRef.current?.injectJavaScript(js);
  }, []);

  // Track flow event
  const trackEvent = useCallback(
    (event: string, step?: number, data?: unknown) => {
      trackFlowEvent(
        endpoint,
        appKey,
        slug,
        installId,
        config.versionId,
        sessionId,
        event,
        step,
        data,
        debug
      );
    },
    [endpoint, appKey, slug, installId, config.versionId, sessionId, debug]
  );

  // Handle haptic feedback
  const triggerHaptic = useCallback((style: HapticStyle) => {
    if (HapticFeedback) {
      const typeMap: Record<HapticStyle, string> = {
        light: 'impactLight',
        medium: 'impactMedium',
        heavy: 'impactHeavy',
        success: 'notificationSuccess',
        warning: 'notificationWarning',
        error: 'notificationError',
        selection: 'selection',
      };
      HapticFeedback.trigger(typeMap[style] || 'impactMedium', {
        enableVibrateFallback: true,
      });
    } else {
      // Show warning once about missing optional dependency
      if (!hapticFeedbackWarningShown) {
        hapticFeedbackWarningShown = true;
        console.warn(
          '[Mobana] react-native-haptic-feedback is not installed. ' +
          'Falling back to basic Vibration API. For better haptic feedback, install: ' +
          'npm install react-native-haptic-feedback'
        );
      }
      // Fallback to basic vibration
      const durationMap: Record<HapticStyle, number> = {
        light: 10,
        medium: 20,
        heavy: 30,
        success: 30,
        warning: 40,
        error: 50,
        selection: 5,
      };
      Vibration.vibrate(durationMap[style] || 20);
    }
  }, []);

  // Handle messages from WebView
  const handleMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      try {
        const message: BridgeMessage = JSON.parse(event.nativeEvent.data);
        const { type, payload, requestId } = message;

        if (debug) {
          console.log(`[Mobana] Bridge message: ${type}`, payload);
        }

        switch (type) {
          // Flow control
          case 'complete':
            onComplete(payload?.data);
            break;

          case 'dismiss':
            onDismiss();
            break;

          case 'trackEvent':
            trackEvent(payload?.name);
            onEvent?.(payload?.name);
            break;

          // Permissions
          case 'requestNotificationPermission':
            if (!Permissions) {
              warnPermissionsNotInstalled('notifications');
              sendResponse(requestId!, false, 'react-native-permissions is not installed');
              break;
            }
            try {
              // Use requestNotifications for both platforms - it's cross-platform and handles
              // Android API level differences (POST_NOTIFICATIONS only exists on API 33+)
              const { status } = await Permissions.requestNotifications(['alert', 'sound', 'badge']);
              sendResponse(requestId!, true, status === Permissions.RESULTS.GRANTED);
            } catch (error) {
              if (debug) {
                console.log('[Mobana] Notification permission request error:', error);
              }
              sendResponse(requestId!, false, 'Permission request failed');
            }
            break;

          case 'checkNotificationPermission':
            if (!Permissions) {
              warnPermissionsNotInstalled('notifications');
              sendResponse(requestId!, true, { status: 'unavailable', granted: false });
              break;
            }
            try {
              // Use checkNotifications for both platforms - it's cross-platform and handles
              // Android API level differences (POST_NOTIFICATIONS only exists on API 33+)
              const { status, settings } = await Permissions.checkNotifications();
              sendResponse(requestId!, true, {
                status,
                granted: status === Permissions.RESULTS.GRANTED,
                settings, // Detailed settings (alert, badge, sound, etc.)
              });
            } catch (error) {
              if (debug) {
                console.log('[Mobana] Notification permission check error:', error);
              }
              sendResponse(requestId!, true, { status: 'unavailable', granted: false });
            }
            break;

          case 'requestATTPermission':
            if (Platform.OS !== 'ios') {
              // ATT is iOS only
              sendResponse(requestId!, true, 'authorized');
              break;
            }
            if (!Permissions) {
              warnPermissionsNotInstalled('ATT');
              sendResponse(requestId!, true, 'not-determined');
              break;
            }
            try {
              const result = await Permissions.request(Permissions.PERMISSIONS.IOS.APP_TRACKING_TRANSPARENCY);
              const statusMap: Record<string, string> = {
                [Permissions.RESULTS.GRANTED]: 'authorized',
                [Permissions.RESULTS.DENIED]: 'denied',
                [Permissions.RESULTS.BLOCKED]: 'denied',
                [Permissions.RESULTS.UNAVAILABLE]: 'not-determined',
                [Permissions.RESULTS.LIMITED]: 'restricted',
              };
              sendResponse(requestId!, true, statusMap[result] || 'not-determined');
            } catch {
              sendResponse(requestId!, true, 'not-determined');
            }
            break;

          case 'checkATTPermission':
            if (Platform.OS !== 'ios') {
              // ATT is iOS only - Android doesn't have this restriction
              sendResponse(requestId!, true, 'authorized');
              break;
            }
            if (!Permissions) {
              warnPermissionsNotInstalled('ATT');
              sendResponse(requestId!, true, 'not-determined');
              break;
            }
            try {
              const result = await Permissions.check(Permissions.PERMISSIONS.IOS.APP_TRACKING_TRANSPARENCY);
              const statusMap: Record<string, string> = {
                [Permissions.RESULTS.GRANTED]: 'authorized',
                [Permissions.RESULTS.DENIED]: 'denied',
                [Permissions.RESULTS.BLOCKED]: 'denied',
                [Permissions.RESULTS.UNAVAILABLE]: 'not-determined',
                [Permissions.RESULTS.LIMITED]: 'restricted',
              };
              sendResponse(requestId!, true, statusMap[result] || 'not-determined');
            } catch {
              sendResponse(requestId!, true, 'not-determined');
            }
            break;

          case 'requestLocationPermission':
            if (!Permissions) {
              warnPermissionsNotInstalled('location');
              sendResponse(requestId!, false, 'react-native-permissions is not installed');
              break;
            }
            try {
              // Mark as requested for "not_requested" detection on Android
              await setLocalData(LOCATION_REQUESTED_KEY, true);
              
              // Get precision option: 'precise' (default) or 'coarse'
              const precision = payload?.precision === 'coarse' ? 'coarse' : 'precise';
              
              const permission = Platform.select({
                ios: Permissions.PERMISSIONS.IOS.LOCATION_WHEN_IN_USE,
                // Android: choose between fine and coarse based on precision option
                android: precision === 'coarse' 
                  ? Permissions.PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION 
                  : Permissions.PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
              });
              if (debug) {
                console.log(`[Mobana] Requesting location permission (precision: ${precision}): ${permission}`);
              }
              if (permission) {
                const result = await Permissions.request(permission);
                if (debug) {
                  console.log(`[Mobana] Location permission result: ${result}`);
                }
                sendResponse(requestId!, true, result);
              } else {
                sendResponse(requestId!, true, 'unavailable');
              }
            } catch (error) {
              if (debug) {
                console.log(`[Mobana] Location permission error:`, error);
              }
              sendResponse(requestId!, false, 'Permission request failed');
            }
            break;

          case 'requestBackgroundLocationPermission':
            if (!Permissions) {
              warnPermissionsNotInstalled('background location');
              sendResponse(requestId!, false, 'react-native-permissions is not installed');
              break;
            }
            try {
              // Mark as requested for "not_requested" detection on Android
              await setLocalData(BACKGROUND_LOCATION_REQUESTED_KEY, true);
              
              const permission = Platform.select({
                ios: Permissions.PERMISSIONS.IOS.LOCATION_ALWAYS,
                android: Permissions.PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION,
              });
              if (debug) {
                console.log(`[Mobana] Requesting background location permission: ${permission}`);
              }
              if (permission) {
                const result = await Permissions.request(permission);
                if (debug) {
                  console.log(`[Mobana] Background location permission result: ${result}`);
                }
                sendResponse(requestId!, true, result);
              } else {
                sendResponse(requestId!, true, 'unavailable');
              }
            } catch (error) {
              if (debug) {
                console.log(`[Mobana] Background location permission error:`, error);
              }
              sendResponse(requestId!, false, 'Permission request failed');
            }
            break;

          case 'getLocationPermissionStatus':
            if (!Permissions) {
              warnPermissionsNotInstalled('location status');
              sendResponse(requestId!, true, {
                foreground: 'denied',
                background: 'not_requested',
                precision: 'unknown',
              } as LocationPermissionStatus);
              break;
            }
            try {
              // Check if we've ever requested these permissions (for "not_requested" on Android)
              const locationRequested = await getLocalData(LOCATION_REQUESTED_KEY);
              const bgLocationRequested = await getLocalData(BACKGROUND_LOCATION_REQUESTED_KEY);
              
              // Helper to convert react-native-permissions result to our status
              const mapStatus = (result: string, wasRequested: boolean): 'granted' | 'denied' | 'blocked' | 'not_requested' => {
                if (result === Permissions!.RESULTS.GRANTED || result === Permissions!.RESULTS.LIMITED) return 'granted';
                if (result === Permissions!.RESULTS.BLOCKED) return 'blocked';
                // On iOS, RESULTS.DENIED means "not determined" (can ask)
                // On Android, we need to track if we've asked before
                if (result === Permissions!.RESULTS.DENIED) {
                  if (Platform.OS === 'ios') {
                    return 'not_requested'; // iOS "denied" means "not yet asked"
                  }
                  // Android: check our tracking flag
                  return wasRequested ? 'denied' : 'not_requested';
                }
                if (result === Permissions!.RESULTS.UNAVAILABLE) return 'denied';
                return 'denied';
              };
              
              // Check foreground location
              let foregroundStatus: 'granted' | 'denied' | 'blocked' | 'not_requested' = 'not_requested';
              let locationPrecision: 'precise' | 'coarse' | 'unknown' = 'unknown';
              
              if (Platform.OS === 'ios') {
                const iosResult = await Permissions.check(Permissions.PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
                foregroundStatus = mapStatus(iosResult, !!locationRequested);
                // iOS precision is user-controlled, we can't easily detect it without getting location
                // Mark as unknown since we can't determine without actually getting a location
                if (foregroundStatus === 'granted') {
                  locationPrecision = 'unknown'; // iOS user may have chosen precise or approximate
                }
              } else {
                // Android: check both fine and coarse to determine precision
                const fineResult = await Permissions.check(Permissions.PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
                const coarseResult = await Permissions.check(Permissions.PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION);
                
                if (fineResult === Permissions.RESULTS.GRANTED) {
                  foregroundStatus = 'granted';
                  locationPrecision = 'precise';
                } else if (coarseResult === Permissions.RESULTS.GRANTED) {
                  foregroundStatus = 'granted';
                  locationPrecision = 'coarse';
                } else if (fineResult === Permissions.RESULTS.BLOCKED || coarseResult === Permissions.RESULTS.BLOCKED) {
                  foregroundStatus = 'blocked';
                } else {
                  foregroundStatus = mapStatus(fineResult, !!locationRequested);
                }
              }
              
              // Check background location
              let backgroundStatus: 'granted' | 'denied' | 'blocked' | 'not_requested' = 'not_requested';
              const bgPermission = Platform.select({
                ios: Permissions.PERMISSIONS.IOS.LOCATION_ALWAYS,
                android: Permissions.PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION,
              });
              
              if (bgPermission) {
                const bgResult = await Permissions.check(bgPermission);
                backgroundStatus = mapStatus(bgResult, !!bgLocationRequested);
              }
              
              const status: LocationPermissionStatus = {
                foreground: foregroundStatus,
                background: backgroundStatus,
                precision: locationPrecision,
              };
              
              if (debug) {
                console.log(`[Mobana] Location permission status:`, status);
              }
              
              sendResponse(requestId!, true, status);
            } catch (error) {
              if (debug) {
                console.log(`[Mobana] Location permission status error:`, error);
              }
              sendResponse(requestId!, true, {
                foreground: 'denied',
                background: 'not_requested',
                precision: 'unknown',
              } as LocationPermissionStatus);
            }
            break;

          case 'getCurrentLocation':
            if (Geolocation) {
              Geolocation.getCurrentPosition(
                (position) => {
                  sendResponse(requestId!, true, {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    altitude: position.coords.altitude,
                    altitudeAccuracy: position.coords.altitudeAccuracy,
                    heading: position.coords.heading,
                    speed: position.coords.speed,
                    timestamp: position.timestamp,
                  });
                },
                (error) => {
                  sendResponse(requestId!, false, error.message);
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
              );
            } else {
              if (!geolocationWarningShown) {
                geolocationWarningShown = true;
                console.warn(
                  '[Mobana] react-native-geolocation-service is not installed. ' +
                  'getCurrentLocation will not work. To enable location features, install: ' +
                  'npm install react-native-geolocation-service'
                );
              }
              sendResponse(requestId!, false, 'Geolocation not available - react-native-geolocation-service is not installed');
            }
            break;

          // Native utilities
          case 'requestAppReview':
            // App review can't be shown while Modal is visible (StoreKit limitation)
            // Complete the flow with action, and the provider will show review after modal closes
            onComplete({ action: 'request-app-review' });
            break;

          case 'haptic':
            triggerHaptic(payload?.style || 'medium');
            break;

          case 'openURL':
            if (payload?.url) {
              Linking.openURL(payload.url).catch(() => {
                if (debug) {
                  console.log(`[Mobana] Failed to open URL: ${payload.url}`);
                }
              });
            }
            break;

          case 'openSettings':
            if (!Permissions) {
              warnPermissionsNotInstalled('openSettings');
              // Try to open settings via Linking as fallback
              Linking.openSettings().catch(() => {
                if (debug) {
                  console.log('[Mobana] Failed to open settings via Linking fallback');
                }
              });
              break;
            }
            Permissions.openSettings().catch(() => {
              if (debug) {
                console.log('[Mobana] Failed to open settings');
              }
            });
            break;

          // Local data
          case 'setLocalData':
            if (payload?.key !== undefined) {
              await setLocalData(payload.key, payload.value);
            }
            break;

          // App callback
          case 'requestCallback':
            if (!onCallback) {
              sendResponse(requestId!, false, 'No onCallback handler provided to startFlow()');
              break;
            }
            try {
              const callbackResult = await onCallback(payload?.data || {});
              sendResponse(requestId!, true, callbackResult);
            } catch (error) {
              if (debug) {
                console.log('[Mobana] onCallback error:', error);
              }
              sendResponse(
                requestId!,
                false,
                error instanceof Error ? error.message : 'onCallback handler failed'
              );
            }
            break;

          default:
            if (debug) {
              console.log(`[Mobana] Unknown bridge message type: ${type}`);
            }
        }
      } catch (error) {
        if (debug) {
          console.log('[Mobana] Failed to parse bridge message:', error);
        }
      }
    },
    [debug, onComplete, onDismiss, onEvent, onCallback, sendResponse, trackEvent, triggerHaptic]
  );

  if (!htmlContent || !WebView) {
    return (
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <ActivityIndicator size="large" color="#8E8E93" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <WebView
        ref={webViewRef}
        source={{ html: htmlContent }}
        style={styles.webview}
        onMessage={handleMessage}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => setIsLoading(false)}
        originWhitelist={['*']}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        scrollEnabled={true}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        scalesPageToFit={false}
        // Security: don't allow navigation away from the flow
        onShouldStartLoadWithRequest={(request: { url: string }) => {
          // Allow initial load and javascript: URLs
          if (request.url === 'about:blank' || request.url.startsWith('data:')) {
            return true;
          }
          // Block external navigation - use openURL bridge instead
          if (request.url.startsWith('http://') || request.url.startsWith('https://')) {
            return false;
          }
          return true;
        }}
        {...webViewProps}
      />
      {isLoading && (
        <View style={[styles.loadingOverlay, { backgroundColor: bgColor }]}>
          <ActivityIndicator size="large" color="#8E8E93" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
