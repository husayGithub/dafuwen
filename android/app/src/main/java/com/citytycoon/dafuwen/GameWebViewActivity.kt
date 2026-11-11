package com.citytycoon.dafuwen

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import com.citytycoon.dafuwen.databinding.ActivityGameWebviewBinding

/**
 * 房主本机游戏入口：以内置浏览器加载本机服务器页面，
 * 在“局域网联机”模式下创建房间并开局。
 */
class GameWebViewActivity : AppCompatActivity() {

    private lateinit var binding: ActivityGameWebviewBinding

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityGameWebviewBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val web = binding.gameWeb
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            cacheMode = WebSettings.LOAD_NO_CACHE
            useWideViewPort = true
            loadWithOverviewMode = true
        }
        web.webViewClient = WebViewClient()

        val port = if (ServerController.isRunning) ServerController.currentPort() else 8080
        web.loadUrl("http://127.0.0.1:$port/")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })
    }

    override fun onPause() {
        super.onPause()
        binding.gameWeb.onPause()
    }

    override fun onResume() {
        super.onResume()
        binding.gameWeb.onResume()
    }

    override fun onDestroy() {
        binding.gameWeb.destroy()
        super.onDestroy()
    }
}
