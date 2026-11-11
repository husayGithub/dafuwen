package com.citytycoon.dafuwen

import java.net.Inet4Address
import java.net.NetworkInterface

/** 枚举本机局域网 IPv4 地址（Wi-Fi / 热点接口）。 */
object NetworkUtils {

    fun getLocalIPv4s(): List<String> {
        val result = mutableListOf<String>()
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return result
            for (intf in interfaces) {
                if (!intf.isUp || intf.isLoopback) continue
                val addrs = intf.inetAddresses ?: continue
                for (addr in addrs) {
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        result.add(addr.hostAddress ?: continue)
                    }
                }
            }
        } catch (_: Exception) {
            // 忽略枚举异常，返回已收集结果
        }
        if (result.isEmpty()) result.add("127.0.0.1")
        return result
    }

    /** 挑选一个最适合对外展示的地址：优先 192.168 / 10. / 172. 段。 */
    fun pickPrimaryIPv4(): String {
        val all = getLocalIPv4s()
        val preferred = all.firstOrNull {
            it.startsWith("192.168.") || it.startsWith("10.") || it.startsWith("172.")
        }
        return preferred ?: all.first()
    }
}
