#import <React/RCTBridgeModule.h>

/**
 * Mobana native module for iOS
 * 
 * Note: iOS does not have Install Referrer like Android.
 * This module exists for API parity but getInstallReferrer always returns nil.
 */
@interface Mobana : NSObject <RCTBridgeModule>

@end
