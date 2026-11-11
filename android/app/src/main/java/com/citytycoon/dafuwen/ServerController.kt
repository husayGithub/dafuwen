package com.citytycoon.dafuwen

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 全局单例，负责服务器的启动/停止、日志聚合与状态回调。
 * Activity 与前台服务共享同一实例。
 */
object ServerController {

    interface Listener {
        fun onLog(line: String)
        fun onStatusChanged(running: Boolean)
    }

    @Volatile private var server: GameServer? = null
    private val listeners = mutableListOf<Listener>()
    private val logs = ArrayDeque<String>()
    private val logFmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    val isRunning: Boolean get() = server != null

    fun currentPort(): Int = server?.port ?: 0

    fun summaryText(): String = server?.summary() ?: "房间与玩家：暂无"

    fun snapshotLogs(): List<String> = logs.toList()

    fun addListener(l: Listener) {
        synchronized(listeners) { listeners.add(l) }
    }

    fun removeListener(l: Listener) {
        synchronized(listeners) { listeners.remove(l) }
    }

    private fun appendLog(line: String) {
        val entry = "[${logFmt.format(Date())}] $line"
        synchronized(logs) {
            logs.addLast(entry)
            while (logs.size > 200) logs.removeFirst()
        }
        synchronized(listeners) { listeners.toList() }.forEach { it.onLog(entry) }
    }

    fun start(context: Context, port: Int) {
        if (server != null) return
        val root = AssetExtractor.ensureExtracted(context)
        appendLog("正在启动服务器（端口 $port）…")
        val s = GameServer(
            wwwRoot = root,
            port = port,
            log = { appendLog(it) },
            onChange = {
                val runningNow = server != null
                synchronized(listeners) { listeners.toList() }.forEach { it.onStatusChanged(runningNow) }
            }
        )
        if (s.start()) {
            server = s
            notifyStatus(true)
        } else {
            server = null
            notifyStatus(false)
        }
    }

    fun stop(context: Context) {
        server?.stop()
        server = null
        notifyStatus(false)
    }

    private fun notifyStatus(running: Boolean) {
        synchronized(listeners) { listeners.toList() }.forEach { it.onStatusChanged(running) }
    }
}
