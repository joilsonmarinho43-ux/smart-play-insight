package app.lovable._03101480d5c041dd93e7913b636c81b0.superbet

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle

/**
 * Activity translúcida que dispara o consent do MediaProjection e, ao receber
 * o resultado, inicia o CaptureService passando o token. Fecha-se logo em
 * seguida sem mostrar UI.
 */
class PermissionActivity : Activity() {

    private val reqCode = 9911

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(mpm.createScreenCaptureIntent(), reqCode)
    }

    @Deprecated("legacy result API is fine for one-shot consent")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == reqCode && resultCode == RESULT_OK && data != null) {
            val svc = Intent(this, CaptureService::class.java).apply {
                putExtra(CaptureService.EXTRA_RESULT_CODE, resultCode)
                putExtra(CaptureService.EXTRA_RESULT_DATA, data)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(svc)
            else startService(svc)
        }
        finish()
    }
}
