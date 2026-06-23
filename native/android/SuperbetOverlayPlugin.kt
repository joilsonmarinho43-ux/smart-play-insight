package app.lovable._03101480d5c041dd93e7913b636c81b0.superbet

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Bridge Capacitor entre o React e os services Android do Superbet Connect.
 *
 * Métodos expostos:
 *  - getStatus()              → { overlayPermission, projectionReady, overlayRunning }
 *  - requestOverlayPermission()
 *  - requestProjectionPermission()
 *  - startOverlay()
 *  - stopOverlay()
 *  - captureNow()
 *
 * Eventos emitidos:
 *  - overlayCaptured  { imageBase64, timestamp }
 *  - overlayError     { code, message }
 *  - overlayState     { running }
 */
@CapacitorPlugin(name = "SuperbetOverlay")
class SuperbetOverlayPlugin : Plugin() {

    companion object {
        const val ACTION_CAPTURED = "app.lovable.superbet.CAPTURED"
        const val ACTION_ERROR = "app.lovable.superbet.ERROR"
        const val ACTION_STATE = "app.lovable.superbet.STATE"
        const val EXTRA_IMAGE_BASE64 = "imageBase64"
        const val EXTRA_TIMESTAMP = "timestamp"
        const val EXTRA_CODE = "code"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_RUNNING = "running"
    }

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val data = JSObject()
            when (intent.action) {
                ACTION_CAPTURED -> {
                    data.put("imageBase64", intent.getStringExtra(EXTRA_IMAGE_BASE64))
                    data.put("timestamp", intent.getLongExtra(EXTRA_TIMESTAMP, System.currentTimeMillis()))
                    notifyListeners("overlayCaptured", data)
                }
                ACTION_ERROR -> {
                    data.put("code", intent.getStringExtra(EXTRA_CODE))
                    data.put("message", intent.getStringExtra(EXTRA_MESSAGE))
                    notifyListeners("overlayError", data)
                }
                ACTION_STATE -> {
                    data.put("running", intent.getBooleanExtra(EXTRA_RUNNING, false))
                    notifyListeners("overlayState", data)
                }
            }
        }
    }

    override fun load() {
        val filter = IntentFilter().apply {
            addAction(ACTION_CAPTURED)
            addAction(ACTION_ERROR)
            addAction(ACTION_STATE)
        }
        LocalBroadcastManager.getInstance(context).registerReceiver(receiver, filter)
    }

    override fun handleOnDestroy() {
        LocalBroadcastManager.getInstance(context).unregisterReceiver(receiver)
        super.handleOnDestroy()
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ret = JSObject()
        ret.put("overlayPermission", Settings.canDrawOverlays(context))
        ret.put("projectionReady", CaptureService.isReady())
        ret.put("overlayRunning", OverlayService.isRunning())
        ret.put("platform", "android")
        ret.put("sdk", Build.VERSION.SDK_INT)
        call.resolve(ret)
    }

    @PluginMethod
    fun requestOverlayPermission(call: PluginCall) {
        if (Settings.canDrawOverlays(context)) {
            val ret = JSObject().apply { put("granted", true) }
            call.resolve(ret)
            return
        }
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${context.packageName}")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        // Resolvemos imediatamente — o JS deve chamar getStatus() novamente
        // quando o app voltar ao foreground.
        val ret = JSObject().apply { put("granted", false); put("opened", true) }
        call.resolve(ret)
    }

    @PluginMethod
    fun requestProjectionPermission(call: PluginCall) {
        val intent = Intent(context, PermissionActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        val ret = JSObject().apply { put("opened", true) }
        call.resolve(ret)
    }

    @PluginMethod
    fun startOverlay(call: PluginCall) {
        if (!Settings.canDrawOverlays(context)) {
            call.reject("overlay_permission_missing")
            return
        }
        if (!CaptureService.isReady()) {
            call.reject("projection_permission_missing")
            return
        }
        val intent = Intent(context, OverlayService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        call.resolve()
    }

    @PluginMethod
    fun stopOverlay(call: PluginCall) {
        context.stopService(Intent(context, OverlayService::class.java))
        call.resolve()
    }

    @PluginMethod
    fun captureNow(call: PluginCall) {
        CaptureService.captureFrame(context)
        call.resolve()
    }
}
