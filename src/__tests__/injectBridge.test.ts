import { generateBridgeScript, buildFlowHtml } from '../bridge/injectBridge';
import type { BridgeContext } from '../bridge/injectBridge';

const baseContext: BridgeContext = {
  attribution: { utm_source: 'facebook', confidence: 0.85 },
  params: { userName: 'Test' },
  installId: 'inst_123',
  platform: 'ios',
  colorScheme: 'light',
  localData: { theme: 'dark' },
  safeArea: { top: 59, bottom: 34, left: 0, right: 0, width: 390, height: 844 },
};

// ─── generateBridgeScript ──────────────────────────────────────────

describe('generateBridgeScript', () => {
  it('embeds context JSON', () => {
    const script = generateBridgeScript(baseContext);
    expect(script).toContain('"installId":"inst_123"');
    expect(script).toContain('"utm_source":"facebook"');
    expect(script).toContain('"userName":"Test"');
  });

  it('creates window.Mobana object', () => {
    const script = generateBridgeScript(baseContext);
    expect(script).toContain('window.Mobana =');
  });

  it('sets bridge ready flag', () => {
    const script = generateBridgeScript(baseContext);
    expect(script).toContain('window.__mobanaBridgeReady = true');
  });

  it('dispatches mobana:ready event', () => {
    const script = generateBridgeScript(baseContext);
    expect(script).toContain("document.dispatchEvent(new Event('mobana:ready'))");
  });

  it('includes response handler', () => {
    const script = generateBridgeScript(baseContext);
    expect(script).toContain('window.__mobanaBridgeResponse');
  });

  it('includes all bridge methods', () => {
    const script = generateBridgeScript(baseContext);
    const expectedMethods = [
      'getAttribution', 'getParams', 'getInstallId', 'getPlatform',
      'getSafeArea', 'getColorScheme', 'setLocalData', 'getLocalData',
      'complete', 'dismiss', 'trackEvent', 'requestCallback',
      'requestNotificationPermission', 'checkNotificationPermission',
      'requestATTPermission', 'checkATTPermission',
      'requestLocationPermission', 'requestBackgroundLocationPermission',
      'getLocationPermissionStatus', 'getCurrentLocation',
      'requestAppReview', 'haptic', 'openURL', 'openSettings', 'playSound',
    ];
    for (const method of expectedMethods) {
      expect(script).toContain(`${method}:`);
    }
  });

  it('embeds safe area values', () => {
    const script = generateBridgeScript(baseContext);
    expect(script).toContain('"top":59');
    expect(script).toContain('"bottom":34');
  });

  it('handles null attribution', () => {
    const script = generateBridgeScript({ ...baseContext, attribution: null });
    expect(script).toContain('"attribution":null');
  });
});

// ─── buildFlowHtml ─────────────────────────────────────────────────

describe('buildFlowHtml', () => {
  const bridgeScript = 'console.log("bridge")';
  const safeArea = { top: 59, bottom: 34, left: 0, right: 0, width: 390, height: 844 };

  it('injects viewport meta tag when missing', () => {
    const html = buildFlowHtml('<html><head></head><body>hi</body></html>', undefined, undefined, bridgeScript);
    expect(html).toContain('viewport-fit=cover');
  });

  it('appends viewport-fit=cover to existing viewport meta', () => {
    const input = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body></body></html>';
    const html = buildFlowHtml(input, undefined, undefined, bridgeScript);
    expect(html).toContain('viewport-fit=cover');
    // Should not duplicate
    const matches = html.match(/viewport-fit=cover/g);
    expect(matches).toHaveLength(1);
  });

  it('injects reset styles', () => {
    const html = buildFlowHtml('<html><head></head><body></body></html>', undefined, undefined, bridgeScript);
    expect(html).toContain('data-mobana="reset"');
    expect(html).toContain('box-sizing: border-box');
  });

  it('injects CSS when provided', () => {
    const html = buildFlowHtml('<html><head></head><body></body></html>', '.custom { color: red }', undefined, bridgeScript);
    expect(html).toContain('.custom { color: red }');
  });

  it('injects JS when provided', () => {
    const html = buildFlowHtml('<html><head></head><body></body></html>', undefined, 'alert("hi")', bridgeScript);
    expect(html).toContain('alert("hi")');
  });

  it('injects bridge script', () => {
    const html = buildFlowHtml('<html><head></head><body></body></html>', undefined, undefined, bridgeScript);
    expect(html).toContain('console.log("bridge")');
  });

  it('injects safe area CSS variables', () => {
    const html = buildFlowHtml(
      '<html><head></head><body></body></html>',
      undefined, undefined, bridgeScript, safeArea, 'dark'
    );
    expect(html).toContain('--safe-area-top: 59px');
    expect(html).toContain('--safe-area-bottom: 34px');
    expect(html).toContain('--screen-width: 390px');
    expect(html).toContain('--screen-height: 844px');
  });

  it('injects color scheme', () => {
    const html = buildFlowHtml(
      '<html><head></head><body></body></html>',
      undefined, undefined, bridgeScript, safeArea, 'dark'
    );
    expect(html).toContain('color-scheme: dark');
    expect(html).toContain('--color-scheme: dark');
  });

  it('defaults to light color scheme', () => {
    const html = buildFlowHtml(
      '<html><head></head><body></body></html>',
      undefined, undefined, bridgeScript
    );
    expect(html).toContain('color-scheme: light');
  });

  it('handles HTML without head or body tags', () => {
    const html = buildFlowHtml('<div>bare content</div>', undefined, undefined, bridgeScript);
    expect(html).toContain('console.log("bridge")');
    expect(html).toContain('bare content');
  });
});
