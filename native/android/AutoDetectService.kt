package app.lovable._03101480d5c041dd93e7913b636c81b0.superbet

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.SharedPreferences
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.localbroadcastmanager.content.LocalBroadcastManager

/**
 * Serviço de Acessibilidade que observa a Superbet em primeiro plano e dispara
 * captura automática quando reconhece a estrutura de um card de jogo.
 *
 * Heurística (Nível 1):
 *  - Pacote em foreground está na whitelist da Superbet.
 *  - Árvore de nós contém placar (regex \d+\s*[xX:-]\s*\d+) OU "minuto/min" OU
 *    duas palavras separadas por "vs"/"x" com letras maiúsculas.
 *  - Debounce 4s entre detecções para não floodear capturas.
 *  - Hash leve da assinatura textual; só dispara se mudou desde a última captura.
 *
 * O usuário pode ligar/desligar via toggle no app — armazenado em SharedPreferences
 * (`superbet_auto.enabled`). O sistema Android só roda este service depois que o
 * usuário ativa "Acessibilidade → Analista Joilson" nas configurações.
 */
class AutoDetectService : AccessibilityService() {

    companion object {
        const val PREF = "superbet_auto"
        const val KEY_ENABLED = "enabled"
        @Volatile private var connected = false
        fun isConnected(): Boolean = connected

        private val SUPERBET_PACKAGES = setOf(
            "ro.superbet.sport",
            "br.superbet.sport",
            "com.superbet.sport",
        )
        private val SCORE_REGEX = Regex("""\b\d{1,2}\s*[xX:\-–]\s*\d{1,2}\b""")
        private val MINUTE_REGEX = Regex("""\b\d{1,3}\s*('|min|min\.|m\b)""", RegexOption.IGNORE_CASE)
        private val VS_REGEX = Regex("""\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç]{2,})\s+(vs|x|×|-)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç]{2,})\b""")
        private const val DEBOUNCE_MS = 4000L
    }

    private var lastFireAt = 0L
    private var lastSignature: Int = 0
    private lateinit var prefs: SharedPreferences

    override fun onServiceConnected() {
        super.onServiceConnected()
        prefs = getSharedPreferences(PREF, MODE_PRIVATE)
        connected = true
    }

    override fun onDestroy() {
        connected = false
        super.onDestroy()
    }

    override fun onInterrupt() { /* no-op */ }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (!prefs.getBoolean(KEY_ENABLED, false)) return

        val pkg = event.packageName?.toString() ?: return
        if (pkg !in SUPERBET_PACKAGES) return

        val type = event.eventType
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            type != AccessibilityEvent.TYPE_VIEW_SCROLLED) return

        val now = System.currentTimeMillis()
        if (now - lastFireAt < DEBOUNCE_MS) return

        val root = rootInActiveWindow ?: return
        val text = collectText(root, StringBuilder(), depth = 0).toString()
        root.recycle()

        if (text.length < 20) return

        val hasScore = SCORE_REGEX.containsMatchIn(text)
        val hasMinute = MINUTE_REGEX.containsMatchIn(text)
        val vsMatch = VS_REGEX.find(text)
        if (!hasScore && !hasMinute && vsMatch == null) return

        val sig = (text.length * 31 + (vsMatch?.value?.hashCode() ?: text.hashCode()))
        if (sig == lastSignature) return
        lastSignature = sig
        lastFireAt = now

        // Pede captura ao CaptureService (que precisa estar com projection ativa)
        if (CaptureService.isReady()) {
            CaptureService.captureFrame(this)
            broadcastDetection(vsMatch?.value, hasScore, hasMinute)
        } else {
            val i = Intent(SuperbetOverlayPlugin.ACTION_ERROR)
                .putExtra(SuperbetOverlayPlugin.EXTRA_CODE, "auto_no_projection")
                .putExtra(SuperbetOverlayPlugin.EXTRA_MESSAGE, "Jogo detectado mas captura não está ativa — reautorize.")
            LocalBroadcastManager.getInstance(this).sendBroadcast(i)
        }
    }

    private fun collectText(node: AccessibilityNodeInfo?, sb: StringBuilder, depth: Int): StringBuilder {
        if (node == null || depth > 12 || sb.length > 4000) return sb
        node.text?.let { if (it.isNotBlank()) sb.append(it).append('\n') }
        node.contentDescription?.let { if (it.isNotBlank()) sb.append(it).append('\n') }
        for (i in 0 until node.childCount) {
            collectText(node.getChild(i), sb, depth + 1)
        }
        return sb
    }

    private fun broadcastDetection(matchLabel: String?, hasScore: Boolean, hasMinute: Boolean) {
        val i = Intent("app.lovable.superbet.AUTO_DETECTED")
            .putExtra("matchLabel", matchLabel)
            .putExtra("hasScore", hasScore)
            .putExtra("hasMinute", hasMinute)
            .putExtra("timestamp", System.currentTimeMillis())
        LocalBroadcastManager.getInstance(this).sendBroadcast(i)
    }
}
