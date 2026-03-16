package ai.mobana.sdk

import android.view.View
import android.view.ViewTreeObserver
import androidx.core.view.ViewCompat
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import com.facebook.react.bridge.*

/**
 * Native module for Mobana SDK
 * Provides Android Install Referrer and dialog navigation bar functionality
 */
class MobanaModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "Mobana"

    // ── Dialog navigation bar override ──────────────────────────────────
    // React Native's Modal passes navigationBarTranslucent which triggers
    // enableEdgeToEdge().  That sets isAppearanceLightNavigationBars based
    // on the *system* dark mode, not the app's theme.  These methods let
    // the JS side override the dialog window's nav bar icon color using
    // the actual background color luminance, and re-apply it via a
    // ViewTreeObserver so it survives React re-renders.

    private var navBarListener: ViewTreeObserver.OnGlobalLayoutListener? = null
    private var navBarListenerView: View? = null

    /**
     * Override the dialog window's navigation bar appearance.
     * @param bgIsDark true when the background is dark (→ light nav bar icons)
     * @param bgColor  hex color string (reserved for future per-API-level use)
     */
    @ReactMethod
    fun setDialogNavigationBar(bgIsDark: Boolean, @Suppress("UNUSED_PARAMETER") bgColor: String) {
        UiThreadUtil.runOnUiThread {
            try {
                val activity = reactApplicationContext.currentActivity ?: return@runOnUiThread
                val dialogDecor = findDialogDecorView(activity.window.decorView)
                    ?: return@runOnUiThread
                setupNavBarOverride(dialogDecor, bgIsDark)
            } catch (_: Exception) {
                // Best-effort — nav bar appearance is cosmetic
            }
        }
    }

    @ReactMethod
    fun clearDialogNavigationBar() {
        UiThreadUtil.runOnUiThread { cleanupNavBarListener() }
    }

    private fun setupNavBarOverride(decorView: View, bgIsDark: Boolean) {
        cleanupNavBarListener()
        applyNavBarAppearance(decorView, bgIsDark)

        val listener = ViewTreeObserver.OnGlobalLayoutListener {
            applyNavBarAppearance(decorView, bgIsDark)
        }
        decorView.viewTreeObserver.addOnGlobalLayoutListener(listener)
        navBarListener = listener
        navBarListenerView = decorView

        decorView.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) {}
            override fun onViewDetachedFromWindow(v: View) {
                cleanupNavBarListener()
                v.removeOnAttachStateChangeListener(this)
            }
        })
    }

    private fun applyNavBarAppearance(decorView: View, bgIsDark: Boolean) {
        ViewCompat.getWindowInsetsController(decorView)?.let { controller ->
            // true = dark icons (for light backgrounds), false = light icons (for dark backgrounds)
            controller.isAppearanceLightNavigationBars = !bgIsDark
        }
    }

    /**
     * Find the topmost non-activity root view, which is the Modal's dialog window.
     * Uses WindowManagerGlobal reflection — the same technique host apps use
     * as a workaround.  Falls back gracefully if the internal API changes.
     */
    private fun findDialogDecorView(activityDecor: View): View? {
        val wmGlobal = Class.forName("android.view.WindowManagerGlobal")
        val wm = wmGlobal.getDeclaredMethod("getInstance").invoke(null)
        val field = wmGlobal.getDeclaredField("mViews").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val views = field.get(wm) as? ArrayList<*> ?: return null
        return views.lastOrNull { it !== activityDecor } as? View
    }

    private fun cleanupNavBarListener() {
        navBarListener?.let { listener ->
            navBarListenerView?.viewTreeObserver?.let { observer ->
                if (observer.isAlive) observer.removeOnGlobalLayoutListener(listener)
            }
        }
        navBarListener = null
        navBarListenerView = null
    }

    // ── Install Referrer ────────────────────────────────────────────────

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
