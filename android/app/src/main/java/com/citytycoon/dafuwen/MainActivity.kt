package com.citytycoon.dafuwen

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.citytycoon.dafuwen.databinding.ActivityMainBinding
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter

class MainActivity : AppCompatActivity(), ServerController.Listener {

    private lateinit var binding: ActivityMainBinding
    private val handler = Handler(Looper.getMainLooper())
    private var accessUrl: String = ""

    private val refresher = object : Runnable {
        override fun run() {
            refreshDynamic()
            handler.postDelayed(this, 1500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // 服务器运行时保持屏幕常亮
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        binding.startBtn.setOnClickListener { doStart() }
        binding.stopBtn.setOnClickListener { doStop() }
        binding.openGameBtn.setOnClickListener { openGame() }
        binding.copyBtn.setOnClickListener { copyUrl() }

        applyRunningUi(ServerController.isRunning)
        if (ServerController.isRunning) {
            updateAccessInfo()
            binding.logView.text = ServerController.snapshotLogs().joinToString("\n")
        }
    }

    override fun onStart() {
        super.onStart()
        ServerController.addListener(this)
        handler.postDelayed(refresher, 1000)
    }

    override fun onStop() {
        super.onStop()
        ServerController.removeListener(this)
        handler.removeCallbacks(refresher)
    }

    private fun doStart() {
        val port = binding.portInput.text.toString().toIntOrNull() ?: 8080
        if (port < 1 || port > 65534) {
            toast("端口无效")
            return
        }
        GameHostService.start(this, port)
        // 服务器实际启动由 ServerController 回调驱动，稍后刷新
        handler.postDelayed({ updateAccessInfo(); applyRunningUi(ServerController.isRunning) }, 400)
    }

    private fun doStop() {
        GameHostService.stop(this)
        accessUrl = ""
        applyRunningUi(false)
        binding.qrImage.setImageDrawable(null)
    }

    private fun openGame() {
        if (!ServerController.isRunning) {
            toast("请先启动服务器")
            return
        }
        startActivity(Intent(this, GameWebViewActivity::class.java))
    }

    private fun updateAccessInfo() {
        val ip = NetworkUtils.pickPrimaryIPv4()
        val port = if (ServerController.isRunning) ServerController.currentPort() else 8080
        accessUrl = "http://$ip:$port"
        binding.accessUrl.text = accessUrl
        binding.qrImage.setImageBitmap(generateQr(accessUrl, 512))
    }

    private fun refreshDynamic() {
        if (ServerController.isRunning) {
            applyRunningUi(true)
            if (accessUrl.isEmpty()) updateAccessInfo()
        }
    }

    private fun applyRunningUi(running: Boolean) {
        binding.startBtn.isEnabled = !running
        binding.stopBtn.isEnabled = running
        binding.openGameBtn.isEnabled = running
        binding.portInput.isEnabled = !running
        binding.statusText.text = if (running) {
            "服务器运行中 · 端口 ${ServerController.currentPort()}"
        } else {
            "服务器未启动"
        }
        binding.statusDot.setBackgroundColor(
            if (running) Color.parseColor("#2BB673") else Color.parseColor("#9AA3AF")
        )
    }

    private fun copyUrl() {
        if (accessUrl.isEmpty()) {
            toast("尚无地址，请先启动服务器")
            return
        }
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("game url", accessUrl))
        toast("已复制：$accessUrl")
    }

    private fun generateQr(text: String, size: Int): Bitmap? {
        return try {
            val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
            val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
            for (x in 0 until size) {
                for (y in 0 until size) {
                    bmp.setPixel(x, y, if (matrix.get(x, y)) Color.BLACK else Color.WHITE)
                }
            }
            bmp
        } catch (_: Exception) {
            null
        }
    }

    // ---- ServerController.Listener（可能来自后台线程）----

    override fun onLog(line: String) {
        runOnUiThread {
            val current = binding.logView.text?.toString() ?: ""
            binding.logView.text = if (current.isEmpty()) line else "$current\n$line"
        }
    }

    override fun onStatusChanged(running: Boolean) {
        runOnUiThread {
            applyRunningUi(running)
            binding.roomList.text = ServerController.summaryText()
        }
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }
}
