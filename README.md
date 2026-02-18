<p align="center">
  <a href="https://mobana.ai" style="vertical-align: middle;">
    <img alt="Mobana" src="https://mobana.ai/images/logos/mobana-transparent.png" height="32">
  </a>
  <br/>
  <strong style="font-size: 1.3em">Mobana</strong>
</p>

<p align="center">
  Simple, privacy-focused mobile app attribution, conversions, and remote flows for React Native.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mobana/react-native-sdk"><img src="https://img.shields.io/npm/v/@mobana/react-native-sdk.svg?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@mobana/react-native-sdk"><img src="https://img.shields.io/npm/dm/@mobana/react-native-sdk.svg?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/mobana-hq/react-native-sdk/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@mobana/react-native-sdk.svg?style=flat-square" alt="license"></a>
  <img src="https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey?style=flat-square" alt="platforms">
</p>

<p align="center">
  <a href="https://mobana.ai/docs">Documentation</a> ·
  <a href="https://mobana.ai/docs/quick-start">Quick Start</a> ·
  <a href="https://mobana.ai/docs/sdk/overview">SDK Reference</a> ·
  <a href="https://mobana.ai/docs/flows/bridge-overview">Flow Bridge</a> ·
  <a href="https://mobana.ai/docs/guides/gdpr">Privacy & GDPR</a>
</p>

---

## Core Features

- **[Attribution & Deeplinking](https://mobana.ai/attribution)** — Know where your installs come from and pass custom data (promo codes, referral IDs, content) through app store installs. No IDFA/GAID required.
- **[Conversion Tracking](https://mobana.ai/conversion-tracking)** — Track post-install events and tie them back to campaigns for ROI measurement.
- **[Flows](https://mobana.ai/flows)** — Display dynamic remote experiences (onboarding, permission prompts, paywalls) built from the Mobana dashboard — no app store updates required.

## Requirements

| Dependency | Minimum Version |
|------------|-----------------|
| React Native | `>= 0.72` |
| React | `>= 17.0` |
| Expo SDK | `50+` (Expo Go not supported) |
| iOS | `13.4+` |
| Android | API `23+` (Android 6.0) |

## Table of Contents

- [Installation](#installation)
  - [Bare React Native](#bare-react-native)
  - [Expo](#expo)
  - [Optional Peer Dependencies](#optional-peer-dependencies)
- [Quick Start](#quick-start)
  - [Initialize the SDK](#1-initialize-the-sdk)
  - [Get Attribution](#2-get-attribution)
  - [Track Conversions](#3-track-conversions)
  - [Show a Flow](#4-show-a-flow-optional)
- [API](#api)
- [Flows](#flows)
- [Privacy & GDPR](#privacy--gdpr)
- [Documentation](#documentation)
- [License](#license)

## Installation

The SDK supports both **bare React Native** and **Expo**. Pick the section that matches your project setup — the SDK API is identical in both environments.

### Bare React Native

Attribution and conversion tracking:

```bash
npm install @mobana/react-native-sdk \
  @react-native-async-storage/async-storage
```

Add [Flows](#flows) support (requires `react-native-webview`):

```bash
npm install @mobana/react-native-sdk \
  @react-native-async-storage/async-storage \
  react-native-webview
```

> If your flows use native permissions, you'll need to configure your iOS **Podfile** and Android **AndroidManifest.xml**. See the **[full installation guide](https://mobana.ai/docs/installation)** for platform-specific setup.

### Expo

Attribution and conversion tracking:

```bash
npx expo install @mobana/react-native-sdk \
  @react-native-async-storage/async-storage
```

Add [Flows](#flows) support:

```bash
npx expo install @mobana/react-native-sdk \
  @react-native-async-storage/async-storage \
  react-native-webview
```

Add the plugin to your `app.json`:

```json
{
  "expo": {
    "plugins": ["@mobana/react-native-sdk"]
  }
}
```

> **Note:** This SDK uses native code — Expo Go is not supported. Use `expo-dev-client` for development builds.

### Optional Peer Dependencies

If your Flows use permissions, haptics, reviews, or location, install the relevant optional packages:

```bash
npm install react-native-permissions \
  react-native-haptic-feedback \
  react-native-in-app-review \
  react-native-geolocation-service \
  react-native-safe-area-context
```

> For iOS Podfile setup, Android manifest permissions, and Expo plugin configuration, see the **[full installation guide](https://mobana.ai/docs/installation)**.

## Quick Start

### 1. Initialize the SDK

Call `init` once when your app starts. Get your App ID from the [Mobana dashboard](https://mobana.ai).

```typescript
import { Mobana } from '@mobana/react-native-sdk';

await Mobana.init({
  appId: 'YOUR_APP_ID',
  debug: __DEV__,
});
```

### 2. Get Attribution

```typescript
const attribution = await Mobana.getAttribution();

if (attribution) {
  console.log(attribution.utm_source);     // e.g. "facebook"
  console.log(attribution.utm_campaign);   // e.g. "summer_sale"
  console.log(attribution.confidence);     // 0.0–1.0

  if (attribution.data?.promo) {
    applyPromoCode(attribution.data.promo);
  }
}
```

`getAttribution()` never throws — it returns `null` when there's no match or on error.

### 3. Track Conversions

```typescript
Mobana.trackConversion('signup');
Mobana.trackConversion('purchase', 49.99);
```

### 4. Show a Flow (optional)

Wrap your app with `MobanaProvider` and start flows by slug:

```tsx
import { MobanaProvider, Mobana } from '@mobana/react-native-sdk';

function App() {
  return (
    <MobanaProvider>
      <YourApp />
    </MobanaProvider>
  );
}

// Somewhere in your app
const result = await Mobana.startFlow('onboarding');

if (result.completed) {
  console.log('User completed onboarding!', result.data);
}
```

> For the full walkthrough, see the **[Quick Start guide](https://mobana.ai/docs/quick-start)**.

## API

| Method | Description | Reference |
|--------|-------------|-----------|
| `Mobana.init(config)` | Initialize the SDK with your App ID | [Docs →](https://mobana.ai/docs/sdk/init) |
| `Mobana.getAttribution()` | Get install attribution and deeplink data | [Docs →](https://mobana.ai/docs/sdk/get-attribution) |
| `Mobana.trackConversion(name, value?)` | Track post-install conversion events | [Docs →](https://mobana.ai/docs/sdk/track-conversion) |
| `Mobana.startFlow(slug, options?)` | Display an in-app flow | [Docs →](https://mobana.ai/docs/sdk/start-flow) |
| `Mobana.prefetchFlow(slug)` | Prefetch a flow for instant display | [Docs →](https://mobana.ai/docs/sdk/prefetch-flow) |
| `Mobana.setEnabled(enabled)` | Enable/disable the SDK (GDPR consent) | [Docs →](https://mobana.ai/docs/sdk/set-enabled) |
| `Mobana.reset()` | Clear stored data, generate new install ID | [Docs →](https://mobana.ai/docs/sdk/reset) |
| `<MobanaProvider>` | Context provider for Flows (wraps your app) | [Docs →](https://mobana.ai/docs/sdk/provider) |

> For full API reference with all options and return types, see the **[SDK Overview](https://mobana.ai/docs/sdk/overview)**.

## Flows

Flows are rich in-app experiences (onboarding, permission prompts, paywalls, announcements) you build visually in the Mobana dashboard. They run inside a WebView and communicate with your app through a JavaScript bridge.

Inside a flow, you have access to attribution data, custom parameters, native permissions, haptics, sounds, and more — all through the `Mobana` bridge object.

| Topic | Link |
|-------|------|
| What are Flows? | [mobana.ai/flows](https://mobana.ai/flows) |
| Building Flows | [Guide →](https://mobana.ai/docs/guides/building-flows) |
| Bridge Overview | [Docs →](https://mobana.ai/docs/flows/bridge-overview) |
| Permissions | [Docs →](https://mobana.ai/docs/flows/bridge-permissions) |
| Events & Tracking | [Guide →](https://mobana.ai/docs/guides/flow-events-tracking) |
| CSS Variables | [Docs →](https://mobana.ai/docs/flows/css-variables) |

## Privacy & GDPR

Mobana is built with privacy at its core:

- **No device IDs** — IDFA/GAID are never required or collected
- **Privacy-first matching** — attribution works without invasive device fingerprinting
- **Minimal data** — only what's needed for attribution, nothing more
- **Opt-out support** — call `Mobana.setEnabled(false)` to disable all tracking
- **GDPR/CCPA compliant** — see our [GDPR guide](https://mobana.ai/docs/guides/gdpr) and [Privacy Policy](https://mobana.ai/privacy)

## Documentation

| Resource | Link |
|----------|------|
| Full Documentation | [mobana.ai/docs](https://mobana.ai/docs) |
| Installation Guide | [mobana.ai/docs/installation](https://mobana.ai/docs/installation) |
| Quick Start | [mobana.ai/docs/quick-start](https://mobana.ai/docs/quick-start) |
| SDK Reference | [mobana.ai/docs/sdk/overview](https://mobana.ai/docs/sdk/overview) |
| Flow Bridge API | [mobana.ai/docs/flows/bridge-overview](https://mobana.ai/docs/flows/bridge-overview) |
| Custom Endpoints | [mobana.ai/docs/guides/custom-endpoints](https://mobana.ai/docs/guides/custom-endpoints) |
| GDPR & Privacy | [mobana.ai/docs/guides/gdpr](https://mobana.ai/docs/guides/gdpr) |
| Test Setup | [mobana.ai/docs/test-setup](https://mobana.ai/docs/test-setup) |

## License

MIT — see [LICENSE](./LICENSE) for details.
