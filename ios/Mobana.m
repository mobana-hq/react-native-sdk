#import "Mobana.h"

@implementation Mobana

RCT_EXPORT_MODULE()

/**
 * Get Install Referrer - not available on iOS, always returns nil
 * 
 * iOS does not have an equivalent to Android's Install Referrer API.
 * Attribution on iOS relies on probabilistic matching.
 */
RCT_EXPORT_METHOD(getInstallReferrer:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    // iOS doesn't have Install Referrer, return nil
    resolve(nil);
}

@end
