package com.citytycoon.dafuwen

import java.io.InputStream
import java.net.Socket
import java.security.MessageDigest

/**
 * 轻量级 WebSocket（RFC 6455）实现，复刻 web/ws-mini.js 的行为。
 * 仅依赖 JDK 原生 Socket / MessageDigest，无需第三方库。
 */
class WebSocket(private val socket: Socket) {

    companion object {
        private const val GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        private const val OP_CONT = 0x0
        private const val OP_TEXT = 0x1
        private const val OP_BINARY = 0x2
        private const val OP_CLOSE = 0x8
        private const val OP_PING = 0x9
        private const val OP_PONG = 0xA

        fun acceptKey(secKey: String): String {
            val md = MessageDigest.getInstance("SHA-1")
            val digest = md.digest((secKey + GUID).toByteArray(Charsets.UTF_8))
            return android.util.Base64.encodeToString(digest, android.util.Base64.NO_WRAP)
        }
    }

    @Volatile var readyState = 1 // OPEN
        private set

    var onMessage: ((String) -> Unit)? = null
    var onClose: (() -> Unit)? = null

    private val input: InputStream = socket.getInputStream()
    private val output = socket.getOutputStream()
    private val sendLock = Any()
    private var readerThread: Thread? = null

    // 分片消息累积
    private var fragOpcode = 0
    private var fragBuffer = ByteArray(0)

    fun startReading() {
        readerThread = Thread { readLoop() }.apply {
            isDaemon = true
            name = "ws-reader"
            start()
        }
    }

    private fun readLoop() {
        try {
            while (readyState == 1) {
                if (!parseFrame()) break
            }
        } catch (_: Exception) {
            // 连接中断
        } finally {
            closeInternal()
            onClose?.invoke()
        }
    }

    private fun readByte(): Int {
        val b = input.read()
        if (b == -1) throw java.io.IOException("eof")
        return b
    }

    private fun readN(n: Int): ByteArray {
        if (n <= 0) return ByteArray(0)
        val buf = ByteArray(n)
        var got = 0
        while (got < n) {
            val r = input.read(buf, got, n - got)
            if (r == -1) throw java.io.IOException("eof")
            got += r
        }
        return buf
    }

    private fun parseFrame(): Boolean {
        val firstByte = readByte()
        val secondByte = readByte()
        val fin = (firstByte and 0x80) != 0
        val opcode = firstByte and 0x0f
        val masked = (secondByte and 0x80) != 0
        var payloadLength = secondByte and 0x7f

        if (payloadLength == 126) {
            val ext = readN(2)
            payloadLength = ((ext[0].toInt() and 0xff) shl 8) or (ext[1].toInt() and 0xff)
        } else if (payloadLength == 127) {
            val ext = readN(8)
            var len = 0L
            for (i in 0 until 8) {
                len = (len shl 8) or (ext[i].toLong() and 0xff)
            }
            payloadLength = len.toInt()
        }

        val mask = if (masked) readN(4) else null
        var payload = readN(payloadLength)
        if (mask != null) {
            for (i in payload.indices) {
                payload[i] = (payload[i].toInt() xor mask[i % 4].toInt()).toByte()
            }
        }

        when (opcode) {
            OP_CLOSE -> {
                socket.close()
                return false
            }
            OP_PING -> sendFrame(OP_PONG, payload)
            OP_PONG -> { /* 忽略 */ }
            OP_CONT -> {
                fragBuffer = fragBuffer + payload
                if (fin) {
                    val full = fragBuffer
                    fragBuffer = ByteArray(0)
                    dispatch(fragOpcode, full)
                }
            }
            OP_TEXT, OP_BINARY -> {
                if (fin) {
                    dispatch(opcode, payload)
                } else {
                    fragOpcode = opcode
                    fragBuffer = payload
                }
            }
        }
        return true
    }

    private fun dispatch(opcode: Int, payload: ByteArray) {
        if (opcode == OP_TEXT) {
            val text = String(payload, Charsets.UTF_8)
            onMessage?.invoke(text)
        }
        // 本项目不使用二进制消息
    }

    private fun sendFrame(opcode: Int, data: ByteArray) {
        if (readyState != 1) return
        synchronized(sendLock) {
            try {
                val length = data.size
                val header: ByteArray = when {
                    length < 126 -> {
                        byteArrayOf((0x80 or opcode).toByte(), length.toByte())
                    }
                    length < 65536 -> {
                        byteArrayOf(
                            (0x80 or opcode).toByte(), 126.toByte(),
                            ((length shr 8) and 0xff).toByte(), (length and 0xff).toByte()
                        )
                    }
                    else -> {
                        val h = ByteArray(10)
                        h[0] = (0x80 or opcode).toByte()
                        h[1] = 127.toByte()
                        for (i in 0 until 4) h[2 + i] = 0
                        h[6] = ((length shr 24) and 0xff).toByte()
                        h[7] = ((length shr 16) and 0xff).toByte()
                        h[8] = ((length shr 8) and 0xff).toByte()
                        h[9] = (length and 0xff).toByte()
                        h
                    }
                }
                output.write(header)
                output.write(data)
                output.flush()
            } catch (_: Exception) {
                readyState = 3
            }
        }
    }

    fun send(text: String) {
        sendFrame(OP_TEXT, text.toByteArray(Charsets.UTF_8))
    }

    fun close() {
        if (readyState == 1) {
            readyState = 2
            try {
                sendFrame(OP_CLOSE, ByteArray(0))
            } catch (_: Exception) {
            }
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun closeInternal() {
        readyState = 3
        try {
            socket.close()
        } catch (_: Exception) {
        }
    }
}
