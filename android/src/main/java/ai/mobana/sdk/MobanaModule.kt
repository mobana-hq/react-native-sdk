package ai.mobana.sdk

import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import com.facebook.react.bridge.*

/**
 * Native module for Mobana SDK
 * Provides Android Install Referrer functionality
 */
class MobanaModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "Mobana"

    /**
     * Get the Install Referrer string from Google Play Store
     * Returns the full referrer string which contains UTM params and dacid
     */
    @ReactMethod
    fun getInstallReferrer(promise: Promise) {
        val context = reactApplicationContext

        try {
            val referrerClient = InstallReferrerClient.newBuilder(context).build()

            referrerClient.startConnection(object : InstallReferrerStateListener {
                override fun onInstallReferrerSetupFinished(responseCode: Int) {
                    when (responseCode) {
                        InstallReferrerClient.InstallReferrerResponse.OK -> {
                            try {
                                val response = referrerClient.installReferrer
                                val referrer = response.installReferrer
                                referrerClient.endConnection()
                                promise.resolve(referrer)
                            } catch (e: Exception) {
                                referrerClient.endConnection()
                                promise.resolve(null)
                            }
                        }
                        InstallReferrerClient.InstallReferrerResponse.FEATURE_NOT_SUPPORTED -> {
                            // Install Referrer API not supported on this device
                            referrerClient.endConnection()
                            promise.resolve(null)
                        }
                        InstallReferrerClient.InstallReferrerResponse.SERVICE_UNAVAILABLE -> {
                            // Connection could not be established
                            referrerClient.endConnection()
                            promise.resolve(null)
                        }
                        else -> {
                            referrerClient.endConnection()
                            promise.resolve(null)
                        }
                    }
                }

                override fun onInstallReferrerServiceDisconnected() {
                    // Connection was lost, but promise may already be resolved
                    // Do nothing - don't reject as this can happen after successful read
                }
            })
        } catch (e: Exception) {
            promise.resolve(null)
        }
    }
}
