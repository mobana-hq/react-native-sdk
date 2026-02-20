/**
 * Expo Config Plugin for @mobana/react-native-sdk
 * 
 * This plugin automatically configures native dependencies for Expo projects.
 * 
 * Usage in app.json / app.config.js:
 * {
 *   "expo": {
 *     "plugins": [
 *       // Attribution-only (no special permissions needed):
 *       "@mobana/react-native-sdk"
 *       
 *       // Or with Flows that need permissions:
 *       ["@mobana/react-native-sdk", {
 *         "permissions": ["Notifications", "AppTrackingTransparency"]
 *       }]
 *     ]
 *   }
 * }
 * 
 * Available permissions (opt-in, none enabled by default):
 * - Notifications (for push notification prompts)
 * - AppTrackingTransparency (for ATT prompts on iOS 14.5+)
 * - LocationWhenInUse (for location-based flows)
 * - LocationAlways (for background location flows)
 */

const { 
  withProjectBuildGradle, 
  withMainApplication,
  withDangerousMod,
  withInfoPlist,
  withAndroidManifest,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// No permissions enabled by default - users must explicitly opt-in
// This prevents unexpected permission entries in Info.plist / AndroidManifest
const DEFAULT_PERMISSIONS = [];

/**
 * Add Install Referrer dependency to Android build.gradle
 */
function withInstallReferrerDependency(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      const buildGradle = config.modResults.contents;
      
      // Check if already added
      if (!buildGradle.includes('com.android.installreferrer:installreferrer')) {
        // Add to allprojects dependencies
        const allProjectsPattern = /allprojects\s*\{[\s\S]*?repositories\s*\{/;
        
        if (allProjectsPattern.test(buildGradle)) {
          // Project has allprojects block, the dependency will be resolved
          // through the library's own build.gradle
        }
      }
    }
    return config;
  });
}

/**
 * Add MobanaPackage to MainApplication.java
 */
function withMobanaPackage(config) {
  return withMainApplication(config, (config) => {
    const mainApplication = config.modResults.contents;
    
    // Check if already imported
    if (!mainApplication.includes('ai.mobana.sdk.MobanaPackage')) {
      // Add import
      const importPattern = /^import.*$/m;
      config.modResults.contents = mainApplication.replace(
        importPattern,
        (match) => `${match}\nimport ai.mobana.sdk.MobanaPackage;`
      );
      
      // Add to getPackages
      const packagesPattern = /new PackageList\(this\)\.getPackages\(\)/;
      if (packagesPattern.test(config.modResults.contents)) {
        // Using autolinking, package should be auto-registered
        // No manual addition needed
      }
    }
    
    return config;
  });
}

/**
 * Add required Android permissions to AndroidManifest.xml
 * This enables react-native-permissions to request these permissions at runtime
 */
function withAndroidPermissions(config, permissions) {
  // Skip if no permissions configured
  if (!permissions || permissions.length === 0) {
    return config;
  }
  
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    
    // Ensure uses-permission array exists
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }
    
    // Helper to add a permission if not already present
    const addPermission = (permissionName) => {
      const exists = manifest['uses-permission'].some(
        (p) => p.$?.['android:name'] === permissionName
      );
      if (!exists) {
        manifest['uses-permission'].push({
          $: { 'android:name': permissionName },
        });
      }
    };
    
    // Add POST_NOTIFICATIONS for Android 13+ (API 33+)
    if (permissions.includes('Notifications')) {
      addPermission('android.permission.POST_NOTIFICATIONS');
    }
    
    // Add location permissions
    if (permissions.includes('LocationWhenInUse') || permissions.includes('LocationAlways')) {
      addPermission('android.permission.ACCESS_FINE_LOCATION');
      addPermission('android.permission.ACCESS_COARSE_LOCATION');
    }
    
    // Add background location permission
    if (permissions.includes('LocationAlways')) {
      addPermission('android.permission.ACCESS_BACKGROUND_LOCATION');
    }
    
    return config;
  });
}

/**
 * Configure iOS Podfile for react-native-permissions
 * This adds the setup_permissions call to enable the required permission pods
 */
function withReactNativePermissionsPodfile(config, permissions) {
  // Skip if no permissions configured - don't inject setup_permissions at all
  if (!permissions || permissions.length === 0) {
    return config;
  }
  
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      
      if (!fs.existsSync(podfilePath)) {
        return config;
      }
      
      let podfileContents = fs.readFileSync(podfilePath, 'utf-8');
      
      // Check if react-native-permissions setup is already configured
      if (podfileContents.includes('react-native-permissions/scripts/setup')) {
        return config;
      }
      
      // Build the setup_permissions call
      const permissionsArray = permissions.map(p => `    '${p}'`).join(',\n');
      const setupBlock = `
# react-native-permissions setup for Mobana SDK
def node_require(script)
  require Pod::Executable.execute_command('node', ['-p',
    "require.resolve('\#{script}', {paths: [process.argv[1]]})",
    __dir__]).strip
end

node_require('react-native-permissions/scripts/setup.rb')

setup_permissions([
${permissionsArray}
])
`;
      
      // Insert after the 'platform :ios' line or at the beginning of target block
      const platformPattern = /^platform :ios.*$/m;
      const targetPattern = /^target\s+['"].*['"]\s+do$/m;
      
      if (platformPattern.test(podfileContents)) {
        podfileContents = podfileContents.replace(
          platformPattern,
          (match) => `${match}\n${setupBlock}`
        );
      } else if (targetPattern.test(podfileContents)) {
        podfileContents = podfileContents.replace(
          targetPattern,
          (match) => `${setupBlock}\n${match}`
        );
      } else {
        // Fallback: prepend to file
        podfileContents = setupBlock + '\n' + podfileContents;
      }
      
      fs.writeFileSync(podfilePath, podfileContents);
      
      return config;
    },
  ]);
}

/**
 * Add required iOS Info.plist entries for permissions
 */
function withPermissionInfoPlist(config, permissions) {
  // Skip if no permissions configured
  if (!permissions || permissions.length === 0) {
    return config;
  }
  
  return withInfoPlist(config, (config) => {
    // Add usage description strings for permissions that require them
    if (permissions.includes('Notifications')) {
      // Notifications don't require a usage description, but we can add a background mode
    }
    
    if (permissions.includes('AppTrackingTransparency')) {
      if (!config.modResults.NSUserTrackingUsageDescription) {
        config.modResults.NSUserTrackingUsageDescription = 
          'This identifier will be used to measure effectiveness of our campaigns and deliver relevant content to you.';
      }
    }
    
    if (permissions.includes('LocationWhenInUse') || permissions.includes('LocationAlways')) {
      if (!config.modResults.NSLocationWhenInUseUsageDescription) {
        config.modResults.NSLocationWhenInUseUsageDescription = 
          'This app needs access to your location.';
      }
    }
    
    if (permissions.includes('LocationAlways')) {
      if (!config.modResults.NSLocationAlwaysAndWhenInUseUsageDescription) {
        config.modResults.NSLocationAlwaysAndWhenInUseUsageDescription = 
          'This app needs access to your location in the background.';
      }
    }
    
    return config;
  });
}

/**
 * Main plugin entry point
 * @param {object} config - Expo config
 * @param {object} props - Plugin props
 * @param {string[]} props.permissions - Array of permissions to enable
 */
function withMobana(config, props = {}) {
  const permissions = props.permissions || DEFAULT_PERMISSIONS;
  
  // Android configuration
  config = withInstallReferrerDependency(config);
  config = withAndroidPermissions(config, permissions);
  // Note: For Expo SDK 50+, native modules are auto-linked
  // withMobanaPackage is kept for older versions
  
  // iOS configuration for react-native-permissions
  config = withReactNativePermissionsPodfile(config, permissions);
  config = withPermissionInfoPlist(config, permissions);
  
  return config;
}

module.exports = withMobana;
