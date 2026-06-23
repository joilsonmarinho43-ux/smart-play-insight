package app.lovable._03101480d5c041dd93e7913b636c81b0.superbet

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import java.io.ByteArrayOutputStream

/**
 * Foreground service que mantém o MediaProjection vivo entre capturas.
 * É inicializado pela PermissionActivity após o usuário aceitar o consent.
 * Cada chamada a captureFrame() devolve o frame atual em PNG/base64.
 */
class CaptureService : Service() {

    companion object {
        private const val CHANNEL_ID = "superbet_capture"
        private const val NOTIF_ID = 4243
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"

        @Volatile private var instance: CaptureService? = null
        fun isReady(): Boolean = instance?.projection != null

        fun captureFrame(ctx: Context) {
            val inst = instance
            if (inst == null) {
                broadcastError(ctx, "no_projection", "Permissão de captura expirada — reautorize.")
                return
            }
            inst.doCapture()
        }

        private fun broadcastError(ctx: Context, code: String, msg: String) {
            val i = Intent(SuperbetOverlayPlugin.ACTION_ERROR)
                .putExtra(SuperbetOverlayPlugin.EXTRA_CODE, code)
                .putExtra(SuperbetOverlayPlugin.EXTRA_MESSAGE, msg)
            LocalBroadcastManager.getInstance(ctx).sendBroadcast(i)
        }
    }

    private var projection: MediaProjection? = null
    private var reader: ImageReader? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var width = 0
    private var height = 0
    private var density = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification())
        intent ?: return START_NOT_STICKY
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val resultData: Intent? = if (Build.VERSION.SDK_INT >= 33)
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_RESULT_DATA)

        if (resultCode == 0 || resultData == null) {
            broadcastError(this, "invalid_consent", "Falha ao iniciar captura.")
            stopSelf()
            return START_NOT_STICKY
        }

        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = mpm.getMediaProjection(resultCode, resultData)
        setupDisplay()
        instance = this
        return START_STICKY
    }

    private fun setupDisplay() {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        width = metrics.widthPixels
        height = metrics.heightPixels
        density = metrics.densityDpi
        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        virtualDisplay = projection?.createVirtualDisplay(
            "SuperbetCapture", width, height, density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader?.surface, null, null
        )
    }

    private fun doCapture() {
        val r = reader ?: return
        Handler(Looper.getMainLooper()).postDelayed({
            var image: Image? = null
            try {
                image = r.acquireLatestImage() ?: run {
                    broadcastError(this, "no_frame", "Nenhum frame disponível ainda.")
                    return@postDelayed
                }
                val planes = image.planes
                val buffer = planes[0].buffer
                val pixelStride = planes[0].pixelStride
                val rowStride = planes[0].rowStride
                val rowPadding = rowStride - pixelStride * width
                val bmp = Bitmap.createBitmap(
                    width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888
                )
                bmp.copyPixelsFromBuffer(buffer)
                val cropped = Bitmap.createBitmap(bmp, 0, 0, width, height)
                bmp.recycle()

                val out = ByteArrayOutputStream()
                cropped.compress(Bitmap.CompressFormat.PNG, 100, out)
                cropped.recycle()
                val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)

                val i = Intent(SuperbetOverlayPlugin.ACTION_CAPTURED)
                    .putExtra(SuperbetOverlayPlugin.EXTRA_IMAGE_BASE64, b64)
                    .putExtra(SuperbetOverlayPlugin.EXTRA_TIMESTAMP, System.currentTimeMillis())
                LocalBroadcastManager.getInstance(this).sendBroadcast(i)
            } catch (e: Exception) {
                broadcastError(this, "capture_exception", e.message ?: "Falha ao capturar.")
            } finally {
                image?.close()
            }
        }, 120)
    }

    override fun onDestroy() {
        instance = null
        virtualDisplay?.release()
        reader?.close()
        projection?.stop()
        super.onDestroy()
    }

    private fun buildNotification(): android.app.Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                mgr.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "Superbet Capture", NotificationManager.IMPORTANCE_LOW)
                )
            }
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Captura de tela autorizada")
            .setContentText("Pronto para extrair dados da Superbet")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .build()
    }
}
