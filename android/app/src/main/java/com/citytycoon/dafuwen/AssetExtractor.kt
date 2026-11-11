package com.citytycoon.dafuwen

import android.content.Context
import android.content.pm.PackageManager
import java.io.File
import java.io.FileOutputStream

/**
 * 把打包在 assets/www 下的网页游戏资源解压到应用私有目录，
 * 供内置 HTTP 服务器读取。版本变化时重新解压。
 */
object AssetExtractor {

    private const val ASSET_ROOT = "www"
    private const val PREFS = "asset_extract"
    private const val KEY_VERSION = "extracted_version"

    fun ensureExtracted(context: Context): File {
        val targetRoot = File(context.filesDir, "www")
        val currentVersion = try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionCode ?: 0
        } catch (_: Exception) {
            0
        }

        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val savedVersion = prefs.getInt(KEY_VERSION, -1)

        if (savedVersion == currentVersion && targetRoot.exists() && hasContent(targetRoot)) {
            return targetRoot
        }

        targetRoot.deleteRecursively()
        targetRoot.mkdirs()
        copyAssetDir(context, ASSET_ROOT, targetRoot)

        prefs.edit().putInt(KEY_VERSION, currentVersion).apply()
        return targetRoot
    }

    private fun hasContent(dir: File): Boolean {
        val files = dir.walkTopDown().filter { it.isFile }.toList()
        return files.isNotEmpty()
    }

    private fun copyAssetDir(context: Context, assetPath: String, destDir: File) {
        val entries = context.assets.list(assetPath) ?: return
        if (entries.isEmpty()) return
        for (name in entries) {
            val childAsset = "$assetPath/$name"
            val childDest = File(destDir, name)
            val children = context.assets.list(childAsset)
            if (children != null && children.isNotEmpty()) {
                childDest.mkdirs()
                copyAssetDir(context, childAsset, childDest)
            } else {
                context.assets.open(childAsset).use { input ->
                    FileOutputStream(childDest).use { output ->
                        input.copyTo(output)
                    }
                }
            }
        }
    }
}
