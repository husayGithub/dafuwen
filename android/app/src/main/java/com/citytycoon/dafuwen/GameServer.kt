package com.citytycoon.dafuwen

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread

/**
 * 内置 HTTP + WebSocket 游戏服务器，复刻 web/server.js 协议。
 * 手机作为房主/权威服务器，其它设备用浏览器连接即可加入。
 */
class GameServer(
    private val wwwRoot: File,
    val port: Int,
    private val log: (String) -> Unit,
    private val onChange: () -> Unit
) {

    class Player(val id: String, val name: String, val ws: WebSocket) {
        @Volatile var connected = true
    }

    class Room(val id: String) {
        var name = "房间"
        val players = CopyOnWriteArrayList<Player>()
        val maxPlayers = 4
        @Volatile var status = "waiting"
        @Volatile var gameState: JSONObject? = null
        var hostId: String? = null
    }

    private val rooms = ConcurrentHashMap<String, Room>()
    @Volatile private var running = false
    private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null

    val rootPath: String get() = wwwRoot.canonicalPath

    fun summary(): String {
        if (rooms.isEmpty()) return "房间与玩家：暂无"
        val sb = StringBuilder("房间与玩家：\n")
        for (room in rooms.values) {
            val online = room.players.count { it.connected }
            sb.append("· #").append(room.id)
                .append("  [").append(room.status).append("] ")
                .append(online).append("/").append(room.maxPlayers).append(" 人\n")
            for (p in room.players) {
                sb.append("    ").append(if (p.connected) "🟢" else "⚪")
                    .append(" ").append(p.name)
                    .append(if (room.hostId == p.id) " (房主)" else "").append("\n")
            }
        }
        return sb.toString().trimEnd()
    }

    /** 同步绑定端口，成功返回 true；失败（如端口占用）返回 false 并已记录日志。 */
    fun start(): Boolean {
        val root = wwwRoot.canonicalPath
        if (!wwwRoot.exists()) {
            log("网页资源目录不存在：$root")
        }
        val ss = try {
            ServerSocket(port)
        } catch (e: Exception) {
            log("启动失败：端口 $port 无法监听（${e.message}）")
            return false
        }
        serverSocket = ss
        running = true
        log("服务器已启动，监听端口 $port")
        acceptThread = thread(isDaemon = true, name = "game-accept") {
            try {
                while (running) {
                    val socket = try {
                        ss.accept()
                    } catch (_: IOException) {
                        break
                    }
                    thread(isDaemon = true, name = "conn") { handleConnection(socket) }
                }
            } catch (e: Exception) {
                if (running) log("运行异常：${e.message}")
            } finally {
                running = false
                onChange()
            }
        }
        return true
    }

    fun stop() {
        running = false
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        for (room in rooms.values) {
            for (p in room.players) {
                try { p.ws.close() } catch (_: Exception) {}
            }
        }
        rooms.clear()
        log("服务器已停止")
        onChange()
    }

    // ---------- 连接处理 ----------

    private fun handleConnection(socket: Socket) {
        try {
            socket.tcpNoDelay = true
            val input = socket.getInputStream()
            val requestLine = readLine(input) ?: run { socket.close(); return }
            val headers = readHeaders(input)

            val parts = requestLine.split(" ")
            if (parts.size < 2) { socket.close(); return }
            val path = parts[1]

            val upgrade = headers["upgrade"]?.lowercase()
            if (upgrade == "websocket") {
                handleWebSocket(socket, headers, path)
                return // socket 交由 WebSocket 持有，不在此关闭
            }

            handleHttp(socket, path, headers)
        } catch (e: Exception) {
            // 单次请求异常，忽略
        } finally {
            // WS 分支已在内部持有 socket，不会走到这里关闭它
        }
    }

    private fun readLine(input: InputStream): String? {
        val sb = StringBuilder()
        var b = input.read()
        if (b == -1) return null
        while (b != '\n'.code) {
            if (b != '\r'.code) sb.append(b.toChar())
            b = input.read()
            if (b == -1) break
        }
        return sb.toString()
    }

    private fun readHeaders(input: InputStream): Map<String, String> {
        val map = HashMap<String, String>()
        while (true) {
            val line = readLine(input) ?: break
            if (line.isEmpty()) break
            val idx = line.indexOf(':')
            if (idx > 0) {
                val k = line.substring(0, idx).trim().lowercase()
                val v = line.substring(idx + 1).trim()
                map[k] = v
            }
        }
        return map
    }

    // ---------- HTTP 静态服务 ----------

    private val MIME = mapOf(
        ".html" to "text/html; charset=utf-8",
        ".css" to "text/css; charset=utf-8",
        ".js" to "application/javascript; charset=utf-8",
        ".json" to "application/json; charset=utf-8",
        ".png" to "image/png",
        ".jpg" to "image/jpeg",
        ".jpeg" to "image/jpeg",
        ".svg" to "image/svg+xml",
        ".ico" to "image/x-icon",
        ".webmanifest" to "application/manifest+json"
    )

    private fun handleHttp(socket: Socket, rawPath: String, headers: Map<String, String>) {
        socket.getOutputStream().use { out ->
            if (rawPath == "/api/rooms") {
                val arr = JSONArray()
                for (r in rooms.values) {
                    arr.put(JSONObject().apply {
                        put("id", r.id)
                        put("name", r.name)
                        put("playerCount", r.players.size)
                        put("maxPlayers", r.maxPlayers)
                        put("status", r.status)
                    })
                }
                val body = JSONObject().put("rooms", arr).toString().toByteArray(Charsets.UTF_8)
                writeResponse(out, 200, "application/json; charset=utf-8", body)
                return
            }

            var path = rawPath.substringBefore('?')
            if (path == "/") path = "/index.html"
            val decoded = try {
                java.net.URLDecoder.decode(path, "UTF-8")
            } catch (_: Exception) {
                path
            }
            val file = File(wwwRoot, decoded)
            val canonical = try { file.canonicalPath } catch (_: Exception) { "" }
            if (canonical.isEmpty() || !canonical.startsWith(rootPath)) {
                writeSimple(out, 403, "Forbidden")
                return
            }
            if (!file.exists() || file.isDirectory) {
                writeSimple(out, 404, "Not Found")
                return
            }
            val ext = file.extension.let { if (it.isEmpty()) it else ".$it" }
            val contentType = MIME[ext] ?: "application/octet-stream"
            val body = file.readBytes()
            writeResponse(out, 200, contentType, body)
        }
    }

    private fun writeResponse(out: OutputStream, status: Int, contentType: String, body: ByteArray) {
        val reason = when (status) {
            200 -> "OK"; 403 -> "Forbidden"; 404 -> "Not Found"; else -> "Error"
        }
        val header = "HTTP/1.1 $status $reason\r\n" +
            "Content-Type: $contentType\r\n" +
            "Content-Length: ${body.size}\r\n" +
            "Cache-Control: no-cache\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Connection: close\r\n\r\n"
        out.write(header.toByteArray(Charsets.UTF_8))
        out.write(body)
        out.flush()
    }

    private fun writeSimple(out: OutputStream, status: Int, message: String) {
        writeResponse(out, status, "text/plain; charset=utf-8", message.toByteArray(Charsets.UTF_8))
    }

    // ---------- WebSocket 握手与房间逻辑 ----------

    private fun handleWebSocket(socket: Socket, headers: Map<String, String>, path: String) {
        val secKey = headers["sec-websocket-key"]
        if (secKey == null) {
            socket.close()
            return
        }
        val accept = WebSocket.acceptKey(secKey)
        val response = "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: $accept\r\n\r\n"
        socket.getOutputStream().write(response.toByteArray(Charsets.UTF_8))
        socket.getOutputStream().flush()

        // 解析查询参数 room / name
        val query = path.substringAfter('?', "")
        val params = parseQuery(query)
        val roomId = params["room"]
        val playerName = params["name"]?.takeIf { it.isNotEmpty() } ?: "玩家"

        if (roomId.isNullOrEmpty()) {
            val ws = WebSocket(socket)
            ws.send(JSONObj("type" to "error", "message" to "缺少房间号").toString())
            ws.close()
            return
        }

        val room = rooms.getOrPut(roomId) {
            Room(roomId).apply { name = playerName + " 的房间" }
        }

        if (room.players.size >= room.maxPlayers) {
            val ws = WebSocket(socket)
            ws.send(JSONObj("type" to "error", "message" to "房间已满").toString())
            ws.close()
            return
        }

        val ws = WebSocket(socket)
        val playerId = "p" + (room.players.size + 1)
        val player = Player(playerId, playerName, ws)
        room.players.add(player)
        if (room.hostId == null) room.hostId = playerId

        log("[房间 $roomId] $playerName ($playerId) 加入，当前 ${room.players.size} 人")

        ws.send(JSONObj(
            "type" to "welcome",
            "playerId" to playerId,
            "isHost" to (room.hostId == playerId),
            "roomId" to roomId,
            "players" to playersArray(room)
        ).toString())

        broadcastToRoom(room, JSONObj(
            "type" to "players_update",
            "players" to playersArray(room)
        ), excludeId = playerId)

        if (room.status == "playing" && room.gameState != null) {
            ws.send(JSONObj("type" to "game_state", "state" to room.gameState!!).toString())
        }

        ws.onMessage = { text ->
            try {
                val msg = JSONObject(text)
                handleMessage(room, player, msg)
            } catch (_: Exception) {
            }
            onChange()
        }
        ws.onClose = {
            player.connected = false
            log("[房间 $roomId] $playerName 断开连接")
            broadcastToRoom(room, JSONObj(
                "type" to "player_disconnected",
                "playerId" to playerId
            ))
            if (room.hostId == playerId) {
                val newHost = room.players.firstOrNull { it.connected }
                if (newHost != null) {
                    room.hostId = newHost.id
                    broadcastToRoom(room, JSONObj("type" to "host_migrated", "newHostId" to newHost.id))
                    log("[房间 $roomId] 房主迁移到 ${newHost.name}")
                } else {
                    rooms.remove(roomId)
                    log("[房间 $roomId] 所有人断开，房间已删除")
                }
            }
            onChange()
        }
        ws.startReading()
        onChange()
    }

    private fun parseQuery(query: String): Map<String, String> {
        val map = HashMap<String, String>()
        if (query.isEmpty()) return map
        for (pair in query.split("&")) {
            val idx = pair.indexOf('=')
            if (idx > 0) {
                val k = pair.substring(0, idx)
                val v = try {
                    java.net.URLDecoder.decode(pair.substring(idx + 1), "UTF-8")
                } catch (_: Exception) {
                    pair.substring(idx + 1)
                }
                map[k] = v
            }
        }
        return map
    }

    private fun playersArray(room: Room): JSONArray {
        val arr = JSONArray()
        for (p in room.players) {
            arr.put(JSONObject().apply {
                put("id", p.id)
                put("name", p.name)
                put("connected", p.connected)
            })
        }
        return arr
    }

    private fun handleMessage(room: Room, player: Player, msg: JSONObject) {
        when (msg.optString("type")) {
            "start_game" -> {
                if (room.hostId != player.id) {
                    player.ws.send(JSONObj("type" to "error", "message" to "只有房主可以开始游戏").toString())
                    return
                }
                room.status = "playing"
                room.gameState = msg.optJSONObject("gameState")
                broadcastToRoom(room, JSONObj("type" to "game_started", "state" to (room.gameState ?: JSONObject())))
                log("[房间 ${room.id}] 游戏开始")
            }
            "game_state" -> {
                if (room.hostId != player.id) return
                room.gameState = msg.optJSONObject("state")
                broadcastToRoom(
                    room,
                    JSONObj("type" to "game_state", "state" to (room.gameState ?: JSONObject())),
                    excludeId = player.id
                )
            }
            "player_action" -> {
                if (room.hostId == player.id) return
                val host = room.players.firstOrNull { it.id == room.hostId && it.connected }
                if (host != null) {
                    host.ws.send(JSONObj(
                        "type" to "player_action",
                        "playerId" to player.id,
                        "action" to msg.opt("action")
                    ).toString())
                }
            }
            "chat" -> {
                broadcastToRoom(room, JSONObj(
                    "type" to "chat",
                    "playerId" to player.id,
                    "name" to player.name,
                    "message" to msg.opt("message")
                ))
            }
            else -> {
                log("未知消息类型: ${msg.optString("type")}")
            }
        }
        onChange()
    }

    private fun broadcastToRoom(room: Room, msg: JSONObject, excludeId: String? = null) {
        val data = msg.toString()
        for (p in room.players) {
            if (p.connected && p.id != excludeId) {
                try {
                    p.ws.send(data)
                } catch (_: Exception) {
                }
            }
        }
    }
}

/** 便捷构造 JSONObject。 */
private fun JSONObj(vararg pairs: Pair<String, Any?>): JSONObject {
    val o = JSONObject()
    for ((k, v) in pairs) {
        o.put(k, v ?: JSONObject.NULL)
    }
    return o
}
