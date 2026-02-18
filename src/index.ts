/**
 * @mobana/react-native-sdk
 * 
 * Simple, privacy-focused mobile app attribution, conversions, and remote flows.
 * 
 * @example
 * ```typescript
 * import { Mobana, MobanaProvider } from '@mobana/react-native-sdk';
 * 
 * // 1. Wrap your app with the provider (in App.tsx)
 * function App() {
 *   return (
 *     <MobanaProvider>
 *       <YourApp />
 *     </MobanaProvider>
 *   );
 * }
 * 
 * // 2. Initialize the SDK
 * await Mobana.init({ appId: 'a1b2c3d4' });
 * 
 * // 3. Get attribution
 * const attribution = await Mobana.getAttribution();
 * 
 * // 4. Track conversions
 * Mobana.trackConversion('signup');
 * Mobana.trackConversion('purchase', 49.99);
 * 
 * // 5. Show flows and track post-flow events
 * const result = await Mobana.startFlow('onboarding');
 * if (result.completed) {
 *   // Track events after flow closes using result.trackEvent()
 *   await result.trackEvent('feature_used');
 *   // Link conversions to flow session using result.sessionId
 *   await Mobana.trackConversion('purchase', 9.99, result.sessionId);
 * }
 * ```
 * 
 * @packageDocumentation
 */

// Main SDK
export { Mobana } from './Mobana';

// Components
export { MobanaProvider } from './components/MobanaProvider';
export type { MobanaProviderProps } from './components/MobanaProvider';

// Types - Attribution
export type {
  MobanaConfig,
  GetAttributionOptions,
  Attribution,
} from './types';

// Types - Flows
export type {
  FlowConfig,
  FlowResult,
  FlowOptions,
  FlowError,
  HapticStyle,
  LocationPermissionStatus,
  ATTStatus,
  LocationCoordinates,
} from './types';
