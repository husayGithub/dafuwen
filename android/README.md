# 城市资本家 · 安卓联机房主 App

把安卓手机变成一个**局域网游戏服务器**：手机本地启动内置服务器并托管网页版《城市资本家》，
其它设备连到同一 Wi-Fi（或本机热点）后，用浏览器访问手机上显示的地址即可加入游戏。

> 设计要点：服务器是**原生 Kotlin** 实现（HTTP 静态服务 + RFC6455 WebSocket），
> 完整复刻了 `web/server.js` + `web/ws-mini.js` 的联机协议，**无需在手机上安装 Node.js**。
> 网页游戏资源（`index.html / js / css`）随 App 打包在 `assets/www`，首次运行时解压到私有目录对外服务。

---

## 一、功能

- 一键**启动 / 停止**局域网服务器，可自定义端口（默认 8080）。
- 自动探测并展示**本机局域网 IPv4 地址**与加入地址，并生成**二维码**，扫码即可进入。
- 实时显示**房间与玩家列表**（谁是房主、在线状态）与运行日志。
- **前台服务保活**：App 退到后台仍维持服务器运行，带常驻通知。
- 房主手机内置 **WebView**，可“以房主身份进入游戏”创建房间并开局。
- 服务器运行时保持**屏幕常亮**，避免息屏导致联机中断。

## 二、使用流程

1. **房主手机**安装并打开本 App，点击「启动服务器」。
2. 让其它手机/平板连到**同一个 Wi-Fi**；若现场没有路由器，房主**开启本机热点**，其它设备连该热点。
3. 其它设备用浏览器访问 App 上显示的地址（如 `http://192.168.1.100:8080`），或扫描屏幕上的二维码。
4. 网页打开后，在大厅选择「**局域网联机**」：
   - **房主**：点「创建房间」，记下 6 位房间号，进入后开局；
   - **其它玩家**：填入同一房间号与昵称，点「加入房间」。
5. 房主在手机上点「以房主身份进入游戏」即可直接本机开局，其它玩家浏览器端同步。

> 说明：网页版默认把服务器地址推导为“当前访问域名:8080”，因此只要通过房主地址打开页面，
> 联机会自动连回本机服务器，一般无需手动填写服务器地址。

## 三、开发/构建（Android Studio）

环境要求：
- Android Studio（Giraffe 及以上）
- JDK 17
- Android SDK **Platform 34**

步骤：
1. `File > Open`，选择本目录 `dafuwen/android`。
2. 首次打开 Android Studio 会提示创建 Gradle Wrapper，点确认（或本机执行 `gradle wrapper`）生成 `gradlew`。
3. 选择设备直接 Run，或 `Build > Build Bundle(s)/APK(s) > Build APK(s)`，
   产物在 `app/build/outputs/apk/debug/app-debug.apk`，分发安装即可。

关键配置（`app/build.gradle`）：`minSdk 24`、`targetSdk 34`、依赖 `com.google.zxing:core`（二维码）。

## 四、更新网页游戏内容

网页逻辑在 `dafuwen/web/`。修改后，把客户端文件同步到 App 资源目录：

```bash
cd dafuwen
cp -R web/. android/app/src/main/assets/www/
rm -f android/app/src/main/assets/www/server.js \
      android/app/src/main/assets/www/ws-mini.js
rm -rf android/app/src/main/assets/www/tests
```

（`server.js / ws-mini.js` 是 Node 版服务器，安卓端已由 Kotlin `GameServer.kt` 取代，无需打包。）

## 五、常见问题

- **别人连不上**：确认所有设备在同一网段；部分公共 Wi-Fi 开启了“AP 隔离”会禁止设备互访，
  此时改用**手机热点**。Android 低功率省电可能息屏断网，本 App 已开启息屏常亮并以前台服务保活。
- **端口被占用**：换一个端口（其它玩家重新访问新地址）。
- **二维码打不开**：直接手动输入 App 显示的 `http://IP:端口` 地址。
- **首次打开离线缓存失败**：局域网 `http://IP` 非安全上下文，Service Worker 不注册属正常，联机不受影响。
