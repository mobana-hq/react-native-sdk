import React, {
  createContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import {
  Modal,
  StyleSheet,
  View,
  StatusBar,
  Platform,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import type { WebViewProps } from 'react-native-webview';
import type { ModalProps } from 'react-native';
import type { FlowConfig, FlowResult, FlowOptions, Attribution } from '../types';
import type { FlowWebViewProps } from './FlowWebView';
import { trackFlowEvent } from '../api';
import { generateUUID } from '../storage';

// Optional: react-native-webview (required for Flows; checked at provider mount)
let WebViewAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-webview');
  WebViewAvailable = true;
} catch {
  // Not installed - provider will throw in __DEV__ if used
}

let FlowWebViewComponent: React.ComponentType<FlowWebViewProps> | null = null;
if (WebViewAvailable) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  FlowWebViewComponent = require('./FlowWebView').FlowWebView;
}

// Optional peer dependency for app review
let InAppReview: { RequestInAppReview: () => Promise<boolean> } | null = null;
let inAppReviewWarningShown = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  InAppReview = require('react-native-in-app-review').default;
} catch {
  // Not installed
}

/**
 * Internal flow request from SDK
 */
export interface FlowRequest {
  slug: string;
  config: FlowConfig;
  installId: string;
  endpoint: string;
  appKey: string;
  attribution: Attribution | null;
  options?: FlowOptions;
  resolve: (result: FlowResult) => void;
  debug?: boolean;
}

/**
 * Context for flow presentation
 */
interface FlowContextValue {
  presentFlow: (request: FlowRequest) => void;
  isProviderMounted: boolean;
}

const FlowContext = createContext<FlowContextValue | null>(null);

/**
 * Check if provider is mounted (used by SDK)
 */
let globalFlowContext: FlowContextValue | null = null;

export function getGlobalFlowContext(): FlowContextValue | null {
  return globalFlowContext;
}

/**
 * Props for MobanaProvider
 */
export interface MobanaProviderProps {
  children: ReactNode;
  /**
   * Custom props for the Modal component
   */
  modalProps?: Partial<ModalProps>;
  /**
   * Custom props for the WebView component
   */
  webViewProps?: Partial<WebViewProps>;
  /**
   * Custom loading component to show while flow is loading
   */
  loadingComponent?: ReactNode;
  /**
   * Background color shown behind the flow while it loads and during modal transitions.
   * Pass a string for a static color, or an object to automatically switch with the system theme.
   * Defaults to #FFFFFF (light) / #1c1c1e (dark).
   *
   * @example
   * // Static color
   * backgroundColor="#F5F5F5"
   *
   * // Theme-aware (updates automatically when system theme changes)
   * backgroundColor={{ light: '#F0EEE9', dark: '#1A1A1A' }}
   */
  backgroundColor?: string | { light: string; dark: string };
}

/**
 * Provider component for Mobana flows
 * 
 * Wrap your app with this component to enable flow presentation:
 * 
 * @example
 * ```tsx
 * import { MobanaProvider } from '@mobana/react-native-sdk';
 * 
 * export default function App() {
 *   return (
 *     <MobanaProvider>
 *       <YourApp />
 *     </MobanaProvider>
 *   );
 * }
 * ```
 */
export function MobanaProvider({
  children,
  modalProps,
  webViewProps,
  loadingComponent,
  backgroundColor,
}: MobanaProviderProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const bgColor = backgroundColor
    ? typeof backgroundColor === 'string'
      ? backgroundColor
      : isDark ? backgroundColor.dark : backgroundColor.light
    : isDark ? '#1c1c1e' : '#FFFFFF';

  if (__DEV__ && !WebViewAvailable) {
    throw new Error(
      '[Mobana] react-native-webview is required for MobanaProvider.\n\n' +
        'Install it with: npm install react-native-webview\n\n' +
        'If you only need attribution/conversion tracking, you can skip the provider ' +
        'and use Mobana.init, getAttribution, trackConversion directly.'
    );
  }

  const [currentRequest, setCurrentRequest] = useState<FlowRequest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const hasTrackedStartRef = useRef(false);
  // Session ID for the current flow presentation (groups all events together)
  const sessionIdRef = useRef<string>('');

  // Present a flow
  const presentFlow = useCallback((request: FlowRequest) => {
    setIsLoading(true);
    hasTrackedStartRef.current = false;
    // Generate a new session ID for this flow presentation
    sessionIdRef.current = generateUUID();
    setCurrentRequest(request);
  }, []);

  // Context value
  const contextValue: FlowContextValue = {
    presentFlow,
    isProviderMounted: true,
  };

  // Register global context for SDK access
  useEffect(() => {
    globalFlowContext = contextValue;
    return () => {
      globalFlowContext = null;
    };
  }, [contextValue]);

  // Track "__started__" event when flow is shown (system event, not user-callable)
  useEffect(() => {
    if (currentRequest && !hasTrackedStartRef.current) {
      hasTrackedStartRef.current = true;
      trackFlowEvent(
        currentRequest.endpoint,
        currentRequest.appKey,
        currentRequest.slug,
        currentRequest.installId,
        currentRequest.config.versionId,
        sessionIdRef.current,
        '__started__',
        undefined,
        undefined,
        currentRequest.debug
      );
      setIsLoading(false);
    }
  }, [currentRequest]);

  // Handle flow completion
  const handleComplete = useCallback(
    (data?: Record<string, unknown>) => {
      if (!currentRequest) return;

      // Capture context for the trackEvent closure (must be done before clearing currentRequest)
      const capturedEndpoint = currentRequest.endpoint;
      const capturedAppKey = currentRequest.appKey;
      const capturedSlug = currentRequest.slug;
      const capturedInstallId = currentRequest.installId;
      const capturedVersionId = currentRequest.config.versionId;
      const capturedSessionId = sessionIdRef.current;
      const capturedDebug = currentRequest.debug;

      // Track "__completed__" event (system event, not user-callable)
      trackFlowEvent(
        capturedEndpoint,
        capturedAppKey,
        capturedSlug,
        capturedInstallId,
        capturedVersionId,
        capturedSessionId,
        '__completed__',
        undefined,
        data,
        capturedDebug
      );

      // Create trackEvent closure for post-flow event tracking
      const trackEvent = async (event: string, eventData?: Record<string, unknown>): Promise<boolean> => {
        return trackFlowEvent(
          capturedEndpoint,
          capturedAppKey,
          capturedSlug,
          capturedInstallId,
          capturedVersionId,
          capturedSessionId,
          event,
          undefined,
          eventData,
          capturedDebug
        );
      };

      // Resolve the promise with sessionId and trackEvent for post-flow tracking
      currentRequest.resolve({
        completed: true,
        dismissed: false,
        data,
        sessionId: capturedSessionId,
        trackEvent,
      });

      // Check for special actions that need to run after modal closes
      const action = data?.action;

      setCurrentRequest(null);

      // Handle post-modal actions after a delay to ensure modal is fully closed
      if (action === 'request-app-review') {
        setTimeout(async () => {
          if (InAppReview) {
            try {
              await InAppReview.RequestInAppReview();
            } catch {
              // Silently fail - review request is best-effort
            }
          } else {
            if (!inAppReviewWarningShown) {
              inAppReviewWarningShown = true;
              console.warn(
                '[Mobana] react-native-in-app-review is not installed. ' +
                'App store review prompts will not work. To enable this feature, install: ' +
                'npm install react-native-in-app-review'
              );
            }
          }
        }, 300); // Small delay to ensure modal animation completes
      }
    },
    [currentRequest]
  );

  // Handle flow dismissal
  const handleDismiss = useCallback(() => {
    if (!currentRequest) return;

    // Capture context for the trackEvent closure (must be done before clearing currentRequest)
    const capturedEndpoint = currentRequest.endpoint;
    const capturedAppKey = currentRequest.appKey;
    const capturedSlug = currentRequest.slug;
    const capturedInstallId = currentRequest.installId;
    const capturedVersionId = currentRequest.config.versionId;
    const capturedSessionId = sessionIdRef.current;
    const capturedDebug = currentRequest.debug;

    // Track "__dismissed__" event (system event, not user-callable)
    trackFlowEvent(
      capturedEndpoint,
      capturedAppKey,
      capturedSlug,
      capturedInstallId,
      capturedVersionId,
      capturedSessionId,
      '__dismissed__',
      undefined,
      undefined,
      capturedDebug
    );

    // Create trackEvent closure for post-flow event tracking
    const trackEvent = async (event: string, eventData?: Record<string, unknown>): Promise<boolean> => {
      return trackFlowEvent(
        capturedEndpoint,
        capturedAppKey,
        capturedSlug,
        capturedInstallId,
        capturedVersionId,
        capturedSessionId,
        event,
        undefined,
        eventData,
        capturedDebug
      );
    };

    // Resolve the promise with sessionId and trackEvent for post-flow tracking
    currentRequest.resolve({
      completed: false,
      dismissed: true,
      sessionId: capturedSessionId,
      trackEvent,
    });

    setCurrentRequest(null);
  }, [currentRequest]);

  // Handle custom events from flow
  const handleEvent = useCallback(
    (name: string) => {
      currentRequest?.options?.onEvent?.(name);
    },
    [currentRequest]
  );

  return (
    <FlowContext.Provider value={contextValue}>
      {children}
      <Modal
        visible={currentRequest !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent={Platform.OS === 'android'}
        onRequestClose={undefined} // Disable Android back button dismiss
        // navigationBarTranslucent is supported in RN 0.72+ but types may be outdated
        {...(Platform.OS === 'android' ? { navigationBarTranslucent: true } : {})}
        {...modalProps}
      >
        <View style={[styles.modalContainer, { backgroundColor: bgColor }]}>
          {Platform.OS === 'ios' && (
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
          )}
          {currentRequest && !isLoading && FlowWebViewComponent && (
            <FlowWebViewComponent
              config={currentRequest.config}
              slug={currentRequest.slug}
              installId={currentRequest.installId}
              endpoint={currentRequest.endpoint}
              appKey={currentRequest.appKey}
              attribution={currentRequest.attribution}
              params={currentRequest.options?.params}
              sessionId={sessionIdRef.current}
              onComplete={handleComplete}
              onDismiss={handleDismiss}
              onEvent={handleEvent}
              onCallback={currentRequest.options?.onCallback}
              webViewProps={webViewProps}
              backgroundColor={backgroundColor}
              debug={currentRequest.debug}
            />
          )}
          {isLoading && (
            <View style={[styles.loadingContainer, { backgroundColor: bgColor }]}>
              {loadingComponent || (
                <ActivityIndicator size="large" color="#8E8E93" />
              )}
            </View>
          )}
        </View>
      </Modal>
    </FlowContext.Provider>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
