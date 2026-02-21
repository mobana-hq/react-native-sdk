import type { Attribution, SafeArea, ColorScheme } from '../types';

/**
 * Bridge context passed from native to WebView
 */
export interface BridgeContext {
  attribution: Attribution | null;
  params: Record<string, unknown>;
  installId: string;
  platform: 'ios' | 'android';
  colorScheme: ColorScheme;
  localData: Record<string, unknown>;
  safeArea: SafeArea;
}

/**
 * Generate JavaScript code to inject into WebView
 * Creates the window.Mobana bridge object
 */
export function generateBridgeScript(context: BridgeContext): string {
  const contextJson = JSON.stringify(context);

  // This JavaScript runs inside the WebView
  return `
(function() {
  'use strict';
  
  // Bridge context from native
  var __context = ${contextJson};
  var __localData = __context.localData || {};
  
  // Pending async requests (requestId -> { resolve, reject })
  var __pendingRequests = {};
  var __requestId = 0;
  
  // Send message to native
  function postMessage(type, payload, requestId) {
    var message = {
      type: type,
      payload: payload,
      requestId: requestId
    };
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  
  // Make an async request to native and wait for response
  function asyncRequest(type, payload) {
    return new Promise(function(resolve, reject) {
      var id = ++__requestId;
      __pendingRequests[id] = { resolve: resolve, reject: reject };
      postMessage(type, payload, id);
    });
  }
  
  // Handle response from native (called via injectJavaScript)
  window.__mobanaBridgeResponse = function(requestId, success, result) {
    var pending = __pendingRequests[requestId];
    if (pending) {
      delete __pendingRequests[requestId];
      if (success) {
        pending.resolve(result);
      } else {
        pending.reject(new Error(result || 'Request failed'));
      }
    }
  };
  
  // Mobana bridge object
  window.Mobana = {
    // ============================================
    // Data Access
    // ============================================
    
    /**
     * Get attribution data for this install
     * @returns {Object|null} Attribution object or null if not matched
     */
    getAttribution: function() {
      return __context.attribution;
    },
    
    /**
     * Get custom parameters passed to startFlow()
     * @returns {Object} Parameters object
     */
    getParams: function() {
      return __context.params || {};
    },
    
    /**
     * Get the install ID
     * @returns {string} Unique install identifier
     */
    getInstallId: function() {
      return __context.installId;
    },
    
    /**
     * Get the current platform
     * @returns {string} 'ios' or 'android'
     */
    getPlatform: function() {
      return __context.platform;
    },
    
    /**
     * Get safe area insets for the device screen
     * @returns {Object} { top, bottom, left, right, width, height }
     */
    getSafeArea: function() {
      return __context.safeArea;
    },
    
    /**
     * Get the device color scheme (light/dark mode)
     * @returns {string} 'light' or 'dark'
     */
    getColorScheme: function() {
      return __context.colorScheme;
    },
    
    /**
     * Store data locally on device (persists across app sessions)
     * @param {string} key - Data key
     * @param {*} value - Data value
     */
    setLocalData: function(key, value) {
      __localData[key] = value;
      postMessage('setLocalData', { key: key, value: value });
    },
    
    /**
     * Retrieve locally stored data
     * @param {string} key - Data key
     * @returns {*} Data value or undefined
     */
    getLocalData: function(key) {
      return __localData[key];
    },
    
    // ============================================
    // Flow Control
    // ============================================
    
    /**
     * Complete the flow with optional data
     * @param {Object} data - Optional data to return to the app
     */
    complete: function(data) {
      postMessage('complete', { data: data });
    },
    
    /**
     * Dismiss the flow
     */
    dismiss: function() {
      postMessage('dismiss', {});
    },
    
    /**
     * Track a custom event
     * @param {string} name - Event name (snake_case, e.g., 'welcome_viewed')
     */
    trackEvent: function(name) {
      postMessage('trackEvent', { name: name });
    },
    
    /**
     * Request the app to perform an async action and return a result.
     * The flow stays open while the app processes the request.
     * Requires onCallback to be provided when starting the flow.
     * 
     * @param {Object} data - Arbitrary data to send to the app's onCallback handler
     * @param {Object} options - Optional configuration
     * @param {number} options.timeout - Timeout in seconds (default: 300)
     * @returns {Promise<Object>} Result returned by the app's onCallback handler
     * 
     * @example
     * // Request a purchase
     * try {
     *   var result = await Mobana.requestCallback(
     *     { action: 'purchase', planId: 'premium' },
     *     { timeout: 120 }
     *   );
     *   if (result.success) {
     *     Mobana.complete({ purchased: true });
     *   }
     * } catch (error) {
     *   // Timeout, no handler, or handler threw an error
     * }
     */
    requestCallback: function(data, options) {
      var opts = options || {};
      var timeout = typeof opts.timeout === 'number' ? opts.timeout : 300;
      
      var promise = asyncRequest('requestCallback', { data: data || {} });
      
      // Wrap with timeout
      var timeoutMs = timeout * 1000;
      var timer;
      var timeoutPromise = new Promise(function(_, reject) {
        timer = setTimeout(function() {
          reject(new Error('requestCallback timed out after ' + timeout + 's'));
        }, timeoutMs);
      });
      
      return Promise.race([promise, timeoutPromise]).then(
        function(result) { clearTimeout(timer); return result; },
        function(error) { clearTimeout(timer); throw error; }
      );
    },
    
    // ============================================
    // Permissions
    // ============================================
    
    /**
     * Request notification permission
     * @returns {Promise<boolean>} True if granted
     */
    requestNotificationPermission: function() {
      return asyncRequest('requestNotificationPermission', {});
    },
    
    /**
     * Check notification permission status without requesting
     * @returns {Promise<Object>} { status: string, granted: boolean, settings?: Object }
     */
    checkNotificationPermission: function() {
      return asyncRequest('checkNotificationPermission', {});
    },
    
    /**
     * Request App Tracking Transparency permission (iOS only)
     * @returns {Promise<string>} 'authorized', 'denied', 'not-determined', or 'restricted'
     */
    requestATTPermission: function() {
      return asyncRequest('requestATTPermission', {});
    },
    
    /**
     * Check App Tracking Transparency status without requesting (iOS only)
     * @returns {Promise<string>} 'authorized', 'denied', 'not-determined', or 'restricted'
     */
    checkATTPermission: function() {
      return asyncRequest('checkATTPermission', {});
    },
    
    /**
     * Request location permission
     * @param {Object} options - Optional configuration
     * @param {string} options.precision - 'precise' (default) or 'coarse'. On Android, this determines
     *   whether to request ACCESS_FINE_LOCATION or ACCESS_COARSE_LOCATION. On iOS, precision is
     *   controlled by the user in the permission dialog.
     * @returns {Promise<string>} Permission result ('granted', 'denied', 'blocked', 'unavailable')
     */
    requestLocationPermission: function(options) {
      var opts = options || {};
      return asyncRequest('requestLocationPermission', { precision: opts.precision || 'precise' });
    },
    
    /**
     * Request background location permission
     * @returns {Promise<string>} Permission result ('granted', 'denied', 'blocked', 'unavailable')
     */
    requestBackgroundLocationPermission: function() {
      return asyncRequest('requestBackgroundLocationPermission', {});
    },
    
    /**
     * Get current location permission status
     * @returns {Promise<Object>} Location permission status object:
     *   - foreground: 'granted' | 'denied' | 'blocked' | 'not_requested'
     *   - background: 'granted' | 'denied' | 'blocked' | 'not_requested'
     *   - precision: 'precise' | 'coarse' | 'unknown'
     */
    getLocationPermissionStatus: function() {
      return asyncRequest('getLocationPermissionStatus', {});
    },
    
    /**
     * Get current location
     * @returns {Promise<Object>} Location coordinates
     */
    getCurrentLocation: function() {
      return asyncRequest('getCurrentLocation', {});
    },
    
    // ============================================
    // Native Utilities
    // ============================================
    
    /**
     * Request app store review
     * Note: This will complete the flow and show the review dialog after the flow closes.
     * Due to iOS StoreKit limitations, reviews cannot be shown while a modal is visible.
     * Use this as the final action in your flow.
     */
    requestAppReview: function() {
      postMessage('requestAppReview', {});
    },
    
    /**
     * Trigger haptic feedback
     * @param {string} style - 'light', 'medium', 'heavy', 'success', 'warning', 'error', 'selection'
     */
    haptic: function(style) {
      postMessage('haptic', { style: style || 'medium' });
    },
    
    /**
     * Open a URL in the browser
     * @param {string} url - URL to open
     */
    openURL: function(url) {
      postMessage('openURL', { url: url });
    },
    
    /**
     * Open app settings
     */
    openSettings: function() {
      postMessage('openSettings', {});
    },
    
    /**
     * Play a sound from a URL (external or base64 data URL)
     * @param {string} url - Sound URL (https:// or data:audio/...)
     * @param {Object} options - Optional playback options
     * @param {number} options.volume - Volume level (0.0 - 1.0, default 1.0)
     * @param {boolean} options.loop - Whether to loop the sound (default false)
     * @param {function} options.onEnd - Callback when sound finishes playing
     * @param {function} options.onError - Callback when an error occurs
     * @returns {Object} Controller with { isPlaying, stop() }
     */
    playSound: function(url, options) {
      var opts = options || {};
      var volume = typeof opts.volume === 'number' ? Math.max(0, Math.min(1, opts.volume)) : 1.0;
      var loop = opts.loop === true;
      var onEnd = typeof opts.onEnd === 'function' ? opts.onEnd : null;
      var onError = typeof opts.onError === 'function' ? opts.onError : null;
      
      var controller = {
        isPlaying: false,
        stop: function() {}
      };
      
      try {
        var audio = new Audio(url);
        audio.volume = volume;
        audio.loop = loop;
        
        audio.onplay = function() {
          controller.isPlaying = true;
        };
        
        audio.onended = function() {
          controller.isPlaying = false;
          if (onEnd) {
            try { onEnd(); } catch (e) { console.warn('playSound onEnd error:', e); }
          }
        };
        
        audio.onerror = function(e) {
          controller.isPlaying = false;
          console.warn('playSound error: Failed to load or play sound');
          if (onError) {
            try { onError(e); } catch (err) { console.warn('playSound onError callback error:', err); }
          }
        };
        
        audio.onpause = function() {
          if (!audio.ended) {
            controller.isPlaying = false;
          }
        };
        
        controller.stop = function() {
          try {
            audio.pause();
            audio.currentTime = 0;
            controller.isPlaying = false;
          } catch (e) {
            // Audio may have been garbage collected
          }
        };
        
        audio.play().catch(function(e) {
          controller.isPlaying = false;
          console.warn('playSound error: ' + e.message);
          if (onError) {
            try { onError(e); } catch (err) { console.warn('playSound onError callback error:', err); }
          }
        });
        
        controller.isPlaying = true;
      } catch (e) {
        console.warn('playSound error: ' + e.message);
        if (onError) {
          try { onError(e); } catch (err) { console.warn('playSound onError callback error:', err); }
        }
      }
      
      return controller;
    }
  };
  
  // Mark bridge as ready
  window.__mobanaBridgeReady = true;
  
  // Dispatch ready event for flows that want to wait
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new Event('mobana:ready'));
  }
})();
`;
}

/**
 * Build complete HTML with injected bridge, styles, and safe area CSS variables
 */
export function buildFlowHtml(
  html: string,
  css: string | undefined,
  js: string | undefined,
  bridgeScript: string,
  safeArea?: SafeArea,
  colorScheme?: ColorScheme
): string {
  let fullHtml = html;

  // 0. Ensure viewport meta tag prevents zoom and has viewport-fit=cover for edge-to-edge rendering.
  // Zoom is always disabled — flows are native UI surfaces, not web pages users should zoom.
  const viewportMetaRegex = /<meta\s+[^>]*name=["']viewport["'][^>]*>/i;
  const viewportMatch = fullHtml.match(viewportMetaRegex);
  if (viewportMatch) {
    const existingTag = viewportMatch[0];
    // Rewrite the content attribute to enforce zoom prevention and viewport-fit=cover,
    // stripping any conflicting user-scalable or maximum-scale values the flow may have set.
    const updatedTag = existingTag.replace(
      /content=["']([^"']*)["']/i,
      (_match, content) => {
        // Remove any existing user-scalable / maximum-scale declarations
        let cleaned = content
          .replace(/,?\s*user-scalable=[^\s,]*/gi, '')
          .replace(/,?\s*maximum-scale=[^\s,]*/gi, '');
        // Append our required values
        if (!cleaned.includes('viewport-fit=cover')) {
          cleaned += ', viewport-fit=cover';
        }
        cleaned += ', maximum-scale=1.0, user-scalable=no';
        return `content="${cleaned.replace(/^,\s*/, '')}"`;
      }
    );
    fullHtml = fullHtml.replace(existingTag, updatedTag);
  } else {
    // No viewport meta tag — inject a sensible default with zoom disabled
    const defaultViewport = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">';
    if (fullHtml.includes('</head>')) {
      fullHtml = fullHtml.replace(/<head([^>]*)>/i, `<head$1>${defaultViewport}`);
    } else if (fullHtml.includes('<body')) {
      fullHtml = fullHtml.replace('<body', `<head>${defaultViewport}</head><body`);
    } else {
      fullHtml = `<head>${defaultViewport}</head>` + fullHtml;
    }
  }

  // 1. Inject SDK base resets FIRST (before user CSS, so flows can override)
  const resetStyle = `<style data-mobana="reset">
/* Mobana SDK base resets — flows can override any of these */
*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}
body {
  -webkit-font-smoothing: antialiased;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  overflow: hidden;
}
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
}
*::-webkit-scrollbar {
  width: 3px;
  height: 3px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 100px;
}
*::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.35);
}
*::-webkit-scrollbar-corner {
  background: transparent;
}
@media (prefers-color-scheme: dark) {
  * {
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }
  *::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }
  *::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.35);
  }
}
</style>`;
  if (fullHtml.includes('</head>')) {
    // Insert at the START of <head> so it comes before any flow styles
    fullHtml = fullHtml.replace(/<head([^>]*)>/i, `<head$1>${resetStyle}`);
  } else if (fullHtml.includes('<body')) {
    fullHtml = fullHtml.replace('<body', `<head>${resetStyle}</head><body`);
  } else {
    fullHtml = resetStyle + fullHtml;
  }

  // 2. Inject user CSS (if separate) — after resets, before env vars
  if (css) {
    const styleTag = `<style>${css}</style>`;
    if (fullHtml.includes('</head>')) {
      fullHtml = fullHtml.replace('</head>', () => `${styleTag}</head>`);
    } else if (fullHtml.includes('<body')) {
      fullHtml = fullHtml.replace('<body', () => `<head>${styleTag}</head><body`);
    } else {
      fullHtml = styleTag + fullHtml;
    }
  }

  // 3. Inject CSS environment variables AFTER user CSS (SDK values take precedence)
  // Note: We use values from react-native-safe-area-context (not CSS env()) for reliable
  // cross-platform insets. Step 0 ensures viewport-fit=cover for edge-to-edge rendering.
  const envVarsStyle = `<style data-mobana="env">
:root {
  /* Color scheme - enables light-dark() CSS function */
  color-scheme: ${colorScheme || 'light'};
  --color-scheme: ${colorScheme || 'light'};
  /* Safe area insets - from react-native-safe-area-context */
  --safe-area-top: ${safeArea?.top ?? 0}px;
  --safe-area-right: ${safeArea?.right ?? 0}px;
  --safe-area-bottom: ${safeArea?.bottom ?? 0}px;
  --safe-area-left: ${safeArea?.left ?? 0}px;
  /* Screen dimensions */
  --screen-width: ${safeArea?.width ?? 0}px;
  --screen-height: ${safeArea?.height ?? 0}px;
}
</style>`;
  if (fullHtml.includes('</head>')) {
    fullHtml = fullHtml.replace('</head>', `${envVarsStyle}</head>`);
  } else if (fullHtml.includes('<body')) {
    fullHtml = fullHtml.replace('<body', `<head>${envVarsStyle}</head><body`);
  } else {
    fullHtml = envVarsStyle + fullHtml;
  }

  // Inject JS if separate
  if (js) {
    const scriptTag = `<script>${js}</script>`;
    if (fullHtml.includes('</body>')) {
      fullHtml = fullHtml.replace('</body>', () => `${scriptTag}</body>`);
    } else {
      fullHtml = fullHtml + scriptTag;
    }
  }

  // Inject bridge script (must come before user JS)
  const bridgeTag = `<script>${bridgeScript}</script>`;
  if (fullHtml.includes('</head>')) {
    fullHtml = fullHtml.replace('</head>', () => `${bridgeTag}</head>`);
  } else if (fullHtml.includes('<body')) {
    fullHtml = fullHtml.replace('<body', () => `<head>${bridgeTag}</head><body`);
  } else {
    fullHtml = bridgeTag + fullHtml;
  }

  return fullHtml;
}
