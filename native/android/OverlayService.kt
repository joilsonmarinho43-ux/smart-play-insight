package app.lovable._03101480d5c041dd93e7913b636c81b0.superbet

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import kotlin.math.abs

/**
 * Foreground service que desenha a bolha flutuante sobre qualquer app.
 * Toque curto = dispara captura. Arraste = move a bolha.
 */
class OverlayService : Service() {

    companion object {
        private const val CHANNEL_ID = "superbet_overlay"
        private const val NOTIF_ID = 4242
        @Volatile private var running = false
        fun isRunning(): Boolean = running
    }

    private var windowManager: WindowManager? = null
    private var bubbleView: View? = null
    private var params: WindowManager.LayoutParams? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIF_ID, buildNotification())
        showBubble()
        running = true
        broadcastState(true)
    }

    override fun onDestroy() {
        running = false
        broadcastState(false)
        bubbleView?.let { runCatching { windowManager?.removeView(it) } }
        bubbleView = null
        super.onDestroy()
    }

    private fun showBubble() {
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val container = FrameLayout(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
        }
        val dot = TextView(this).apply {
            text = "MIP"
            textSize = 12f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(24, 24, 24, 24)
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(Color.parseColor("#F59E0B"))
                setStroke(4, Color.parseColor("#1F2937"))
            }
        }
        container.addView(dot)

        val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 24
            y = 300
        }

        attachDragAndTap(container)
        windowManager?.addView(container, params)
        bubbleView = container
    }

    private fun attachDragAndTap(view: View) {
        var initX = 0
        var initY = 0
        var touchX = 0f
        var touchY = 0f
        var moved = false
        var downTime = 0L

        view.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initX = params?.x ?: 0
                    initY = params?.y ?: 0
                    touchX = event.rawX
                    touchY = event.rawY
                    moved = false
                    downTime = System.currentTimeMillis()
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - touchX).toInt()
                    val dy = (event.rawY - touchY).toInt()
                    if (abs(dx) > 12 || abs(dy) > 12) moved = true
                    params?.x = initX + dx
                    params?.y = initY + dy
                    windowManager?.updateViewLayout(view, params)
                    true
                }
                MotionEvent.ACTION_UP -> {
                    val elapsed = System.currentTimeMillis() - downTime
                    if (!moved && elapsed < 400) {
                        // Toque curto → captura
                        CaptureService.captureFrame(this)
                    }
                    true
                }
                else -> false
            }
        }
    }

    private fun buildNotification(): android.app.Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                val ch = NotificationChannel(
                    CHANNEL_ID, "Superbet Overlay",
                    NotificationManager.IMPORTANCE_LOW
                )
                mgr.createNotificationChannel(ch)
            }
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Superbet Connect ativo")
            .setContentText("Toque na bolha para capturar a tela do jogo")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .build()
    }

    private fun broadcastState(on: Boolean) {
        val i = Intent(SuperbetOverlayPlugin.ACTION_STATE)
            .putExtra(SuperbetOverlayPlugin.EXTRA_RUNNING, on)
        LocalBroadcastManager.getInstance(this).sendBroadcast(i)
    }
}
